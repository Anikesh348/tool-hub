> **Learning goal**
> Design a distributed, cron-like job scheduler that reliably triggers jobs at scale, and be able to explain leader election for scheduling, exactly-once-ish execution, and handling worker failure and retries.

## 16.1 Requirements and scope

**Functional requirements**

- Let users/services register a job with a schedule (e.g., "run every 5 minutes," "run daily at 2 AM UTC," or a one-off future timestamp).
- Trigger each job's execution at (approximately) the scheduled time, dispatching it to a worker to actually run.
- Track job execution history and status (succeeded, failed, running, missed).
- Support automatic retry of failed job executions with a configurable policy.
- Support job cancellation/pause.

**Out of scope**: the actual business logic each job runs (this service triggers and tracks execution, it doesn't know what a job "does"), a full workflow/DAG engine (jobs depending on other jobs' outputs), a UI for managing schedules. This is infrastructure that other systems register jobs against, similar in spirit to how the Notification Service lesson is infrastructure other systems call into.

**Non-functional requirements**

- **Correctness over speed** — a job firing a few seconds late is fine; a job firing zero times or a thousand times when it should have fired once is not. This is the opposite priority ordering from, say, the WhatsApp lesson, where speed mattered enormously.
- **No missed jobs even under failure** — if the component responsible for triggering a job crashes at the exact moment it should fire, some other component must pick it up; a scheduler that silently drops a run because of a crash is not trustworthy enough to be relied upon by other systems.
- **"Exactly-once-ish" execution** — in a distributed system, true exactly-once execution against an arbitrary job action is not achievable in general (the classic problem: you cannot atomically "trigger side effect X" and "record that X was triggered" as one operation across a network). The realistic, defensible target is **at-least-once triggering with strong deduplication support**, so that in practice jobs run once under normal conditions and rarely-but-possibly more than once under failure, with tools (idempotency keys) to make that safe for callers.
- **Horizontally scalable** — millions of registered jobs, many due to fire in overlapping windows.

## 16.2 Scale estimation

Assumptions:

- 10 million registered jobs across the platform (a large internal platform serving many teams' scheduled tasks: cache warmers, report generators, cleanup jobs, reminders).
- Average job frequency: many jobs run hourly or daily; blend to an average of one execution per job per hour → 10 million executions/hour.

**Traffic (trigger rate)**

- 10,000,000 executions/hour ÷ 3,600 ≈ 2,800 triggers/second average.
- Job schedules cluster at "nice" boundaries — a huge fraction of cron jobs are scheduled for the top of the hour, midnight, etc. — so peak trigger rate at, say, the top of every hour can be 10-50x the average momentarily. This clustering effect is a real and important number: a naive design that assumes traffic is smooth will fall over exactly at :00 every hour.

**Storage**

- 10 million job definitions × ~1 KB (schedule, target, retry policy, metadata) ≈ 10 GB — small, easily fits a normal database.
- Execution history: 10M executions/hour × 24 × ~500 bytes/record ≈ 120 GB/day if every execution is logged in full — meaningful volume that argues for time-partitioned storage with a retention policy (e.g., keep detailed history 30 days, aggregate/roll up older data), similar to the delivery-log reasoning in the Notification Service lesson.

**Scan cost**

- The core scheduling operation is "find all jobs due to fire in the next N seconds." Scanning 10 million job rows every few seconds to find due ones is the naive approach and does not scale — this number is the direct justification for the time-bucketed index structure covered in 16.5.

## 16.3 API and data model

**API**

| Endpoint | Description | Request | Response |
| --- | --- | --- | --- |
| `POST /jobs` | Register a new scheduled job | `{schedule (cron expr or interval), target (queue/webhook), payload, retryPolicy}` | `{jobId}` |
| `PUT /jobs/{id}/pause` | Pause a job | — | `{success}` |
| `DELETE /jobs/{id}` | Cancel/delete a job | — | `{success}` |
| `GET /jobs/{id}/executions?limit=50` | Get recent execution history | — | `{executions: [...]}` |
| `POST /internal/executions/{id}/ack` | Worker reports execution result | `{status: success\|failure, output?}` | `{}` |

**Core entities**

- `Job { jobId, schedule, target, payload, retryPolicy, nextRunAt, status: active\|paused }`
- `Execution { executionId, jobId, scheduledFor, startedAt, finishedAt, status: pending\|running\|success\|failed\|missed, attemptNumber }`
- `ScheduleBucket { bucketTimeWindow -> [jobIds due in this window] }` — the time-indexed structure that makes "what's due now" fast; detailed in 16.5.
- `Lease { jobId or bucketId, ownerId (which scheduler instance), expiresAt }` — used for leader/ownership coordination so two scheduler instances don't both trigger the same job.

**SQL vs. NoSQL.** `Job` definitions are moderate volume (10M rows), read and written far less often than they're scanned for "what's due," and benefit from being simply and reliably updatable (pause/cancel must reliably take effect) — a relational store works fine here and its size is nowhere near forcing a different choice. `Execution` history is the higher-volume, append-heavy, time-partitioned data (similar reasoning to `PlayEvent` in the Spotify lesson and `DeliveryAttempt` in the Notification Service lesson) and fits a wide-column/time-series-oriented store better, partitioned by time window so old data can be dropped/archived cheaply and recent data (which is what "is this job currently running" queries need) stays fast to access. The `ScheduleBucket` structure is really an index, not a general-purpose table, and is often implemented directly in a sorted/priority-queue-like structure (e.g., a sorted set keyed by due-time) in a fast store, because its entire job is to answer "what's due between time A and B" as cheaply as possible, over and over.

## 16.4 High-level architecture

```text
Job Registration API  --- writes ---> Job Store (SQL)
                                            |
                                            v
                                  ScheduleBucket Index (sorted by nextRunAt)
                                            ^
                                            |
                          -----------------------------------
                          |         Scheduler Cluster        |
                          |  (one elected leader per shard,  |
                          |   or per-shard active/standby)   |
                          -----------------------------------
                                            |
                                            v
                                     Dispatch Queue
                                            |
                                            v
                                     Worker Pool  ---> executes job (calls target queue/webhook)
                                            |
                                            v
                                Execution Store (status, retries)
                                            |
                                (on failure, per retryPolicy)
                                            v
                                  Requeue with backoff, up to max attempts
```

**Trigger path.** Scheduler instances continuously poll the `ScheduleBucket` index for jobs whose `nextRunAt` has passed. On finding due jobs, a scheduler instance (having established, via leader election/leasing, that it — and only it — owns responsibility for this job right now) creates an `Execution` record with status `pending`, computes the job's *next* `nextRunAt` (so recurring jobs reschedule themselves), and places the execution on a dispatch queue.

**Dispatch/execution path.** Worker processes pull from the dispatch queue, mark the execution `running`, actually perform the trigger (call a webhook, push to a target queue, whatever the job's `target` specifies), and report back success or failure. This mirrors the pattern from the Notification Service lesson: the scheduler's job is done once it has reliably handed off "this should run now" — the actual work happens in a decoupled worker layer so a slow or failing job target doesn't block the scheduler from evaluating other due jobs.

**Retry path.** On a reported failure, the retry policy (e.g., exponential backoff, max 3 attempts) determines whether to requeue with a delay or mark the execution permanently `failed` and surface it for visibility.

## 16.5 Deep dive: leader election for scheduling, exactly-once-ish execution, and worker/job failure handling

**Why leader election matters here specifically.** If every scheduler instance independently scanned the job store and fired any job it saw was due, a job would fire once *per running scheduler instance* — with, say, 5 scheduler instances for availability, every job would fire 5 times. This is a strictly worse failure mode than under-firing, so the design needs a mechanism that guarantees only one instance acts on a given job at a given moment, while still allowing multiple instances to run for availability. Two common shapes, both with the same underlying idea:

1. **Single elected leader for the whole scheduling decision.** All scheduler instances participate in a leader election (via a coordination service that supports consensus-backed leases — the same category of tool used for distributed locks generally). Only the current leader evaluates the `ScheduleBucket` index and issues triggers; the other instances stay hot as standbys, watching for the leader to fail (missed heartbeat/lease renewal) so one of them can take over quickly. This is simple to reason about but makes the leader a throughput ceiling — all 2,800 triggers/second (and the :00-boundary bursts) flow through one logical decision-maker.
2. **Sharded ownership (leases per job or per bucket, not one global leader).** Jobs (or time buckets) are partitioned across scheduler instances, and each instance holds a time-bound lease over its shard rather than there being one global leader for everything. This scales trigger throughput horizontally (more shards, more instances) at the cost of slightly more coordination overhead, since leases need to be acquired/renewed per shard rather than once. Given the peak-burst number from 16.2 (10-50x at hour boundaries), sharded ownership is the more realistic choice at this problem's scale — a single global leader evaluating all 10 million jobs' due-status at a burst moment is a plausible bottleneck, whereas sharding by, say, a hash of jobId across N scheduler instances lets the burst be absorbed in parallel.

Either way, the mechanism underneath is the same: a **lease** — "I am responsible for this shard/job until time T, and I must renew before T or someone else may take over." If a scheduler instance crashes, it simply stops renewing its leases, and after the lease expiry window, another instance safely picks up that shard, having a guarantee (from the coordination service) that the old owner cannot still be acting on it (or if it somehow is, due to a pause/GC delay, that's the exact edge case exactly-once-ish semantics below are designed to tolerate).

**The time-bucketed index.** Rather than scanning all 10 million jobs to find due ones, jobs are indexed by their `nextRunAt`, conceptually like a sorted structure (a min-heap or a sorted set) or, in coarser practice, bucketed into fixed time windows (e.g., one bucket per minute). A scheduler shard simply asks "give me everything in buckets whose time has now passed for my shard" — a cheap range query instead of a full scan, which is what makes the 2,800/second (and much higher at bursts) trigger rate tractable against a 10-million-job dataset.

**Exactly-once-ish execution, honestly.** As stated in 16.1, true exactly-once triggering of an arbitrary external side effect is not achievable — the fundamental issue is that "trigger the job" and "record that it was triggered" are two separate operations, and a crash between them (after triggering, before recording) means a naive retry-on-recovery would trigger it again. The practical target, and what real systems actually build, is:

- **At-least-once triggering**: under failure, a job might fire more than once, but it will not silently fail to fire (this is enforced by the lease mechanism above — ownership is always eventually reclaimed and re-evaluated, never permanently lost).
- **Idempotency at the consumer.** Every `Execution` is created with a unique `executionId` *before* dispatch, and that id is passed to the job's target as an idempotency key — this mirrors the `dedupKey` pattern from the Notification Service lesson. A well-behaved job target can then recognize "I've already processed executionId X" and no-op on a duplicate trigger, turning "at least once delivery of the trigger" into "effectively exactly once processing," but only if the target cooperates. The scheduler cannot force this on a target it doesn't control — it can only make the tool (a stable, unique id per scheduled execution) available, and this is worth stating plainly in an interview: the scheduler provides at-least-once *triggering* guarantees; true exactly-once *processing* is a joint responsibility with the job target.
- **Recording before or after triggering — pick the safer failure mode.** If the scheduler records "triggered" *before* actually calling the target and then crashes before the call happens, the job silently never runs (a miss — the worse failure mode per 16.1's stated priorities). If it calls the target *first* and records after, a crash mid-way risks a duplicate trigger on retry, but never a silent miss. Given that this design explicitly prioritizes "no missed jobs" over "no duplicate jobs," triggering-then-recording (and relying on idempotency keys to absorb the resulting occasional duplicate) is the correct choice.

**Worker failure and retries.** A worker can fail in two distinct ways that need different handling: it can crash *before* reporting any result (the execution is stuck at `running` with no ack), or it can report an explicit `failure`. For the first case, executions carry a timeout — if a `running` execution hasn't been acked within some multiple of the job's expected runtime, the scheduler treats it as failed-by-timeout and applies the retry policy, rather than waiting forever; this is necessary because a crashed worker cannot itself report anything. For the second case, the retry policy (attempt count, backoff) from the job's definition governs whether to requeue with a delay or give up and mark the execution `failed`, surfacing it for whoever owns that job to investigate — the same backoff-then-give-up shape used for delivery retries in the Notification Service lesson.

## 16.6 Bottlenecks and trade-offs

- **Single points of failure.** A single global leader (option 1 in 16.5) is the clearest SPOF risk if not carefully built — mitigated by fast failover via lease expiry, but there's an unavoidable window (the lease timeout) during which no scheduling happens if the leader dies. Sharded ownership reduces blast radius: losing one shard's owner only stalls that shard's jobs, not all 10 million.
- **Hot spots.** The clustering of schedules at round time boundaries (16.2) is the most predictable hot spot in this whole system — mitigated by deliberately jittering trigger times slightly (e.g., a job "due at :00" is dispatched with a small random offset of a few hundred milliseconds to a few seconds) so the dispatch queue and worker pool see a smoothed burst instead of an instantaneous spike, a technique that trades a small amount of timing precision (acceptable per the stated non-functional requirements) for a large reduction in peak load.
- **Consistency vs. availability.** This design leans towards availability for the scheduling decision (leases expire and get reclaimed automatically rather than requiring manual intervention) while explicitly accepting weaker delivery consistency (at-least-once, not exactly-once) as a deliberate, stated trade-off rather than an oversight — which is exactly the kind of honest trade-off call this lesson's non-functional requirements section set up front.
- **What breaks first at 10x scale.** The dispatch queue and worker pool feel it first — 10x the executions/hour means 10x the burst at time boundaries too, so worker pool auto-scaling and queue partitioning (by job type or target) become necessary to keep up without the smoothing/jitter technique alone being enough.
- **What breaks at 100x.** The `ScheduleBucket` index itself becomes the constraint — at 100x scale (1 billion jobs), even bucketed range queries across enough shards need the index structure itself to be distributed and sharded (not just the scheduler instances reading it), which pushes towards partitioning the index by a hash of jobId in addition to time, so no single shard's index holds the full burst for a given time window.

## 16.7 Summary

The core of this design is turning "run this job on schedule, reliably, at scale" into three separable mechanisms: a **time-indexed structure** so finding due jobs is cheap instead of a full scan; **leasing/leader election** so exactly one owner acts on a job at a time despite running multiple scheduler instances for availability; and an honest **at-least-once-plus-idempotency-key** model instead of promising true exactly-once execution, which is not achievable against an arbitrary external side effect. Worker failures are handled with execution timeouts (for silent crashes) and policy-driven retries with backoff (for explicit failures), mirroring the same backoff-and-give-up pattern used in the Notification Service lesson.

Natural follow-ups: how would you extend this to support job dependencies (a DAG where job B only runs after job A succeeds, which turns this into something closer to a workflow orchestration engine), and how would you handle daylight-saving-time or timezone-aware schedules ("run at 9 AM local time") without breaking the simple time-bucketed index that assumes a single, unambiguous timeline.
