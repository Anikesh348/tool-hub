> **Learning goal**
> Design an online code editor / judge platform, able to explain how untrusted user code is executed safely and efficiently under resource limits, and how a submission queue keeps the system responsive under bursty load.

## 31.1 Requirements and scope

**Functional requirements**

- A user writes code in a browser-based editor and submits it to run against a problem (with predefined test inputs and expected outputs) or simply to execute freely (a scratch-pad "run" mode).
- The system executes the submitted code and returns output, errors, and (for judged problems) a pass/fail verdict per test case.
- Support multiple languages (e.g., Python, Java, C++, JavaScript).
- Enforce time and memory limits per execution, and report clear errors when they're exceeded (timeout, memory exceeded, runtime error).
- A user can view their submission history and past results.

**Non-functional requirements**

- **Isolation is non-negotiable.** This system runs arbitrary, untrusted code supplied by anyone with an account — a malicious or buggy submission must never be able to access other users' data, other running submissions, the host machine, or the network beyond what's explicitly allowed. This single requirement dominates the whole design more than any other in this lesson.
- **Bounded resource usage per submission.** Every execution needs hard limits on CPU time, memory, and wall-clock time, enforced by the platform, not trusted to the submitted code's own behavior (an infinite loop or fork bomb must be stopped by the platform, not politely avoided by the user).
- **Reasonable turnaround time.** Users expect a "run" or "submit" action to return a verdict within a few seconds under normal load; the design should degrade gracefully (queue with visible position) rather than fail outright under bursts (e.g., a popular contest starting at a fixed time).
- Editor responsiveness (typing, syntax highlighting) is a client-side concern and is explicitly separate from the execution backend — typing must never be blocked waiting on a network round-trip to a sandbox.

**Out of scope**

- Real-time collaborative multi-cursor editing (a genuinely different problem — conflict-free merging of concurrent edits — noted briefly at the end but not designed in depth here, since sandboxed execution is the more central "online code editor" problem and the one with the most interesting infrastructure).
- IDE features like autocomplete/IntelliSense.
- Grading/plagiarism-detection for coding interviews or classrooms.

## 31.2 Scale estimation

Assumptions for a coding-practice/judge platform with meaningful but not massive scale:

- 2 million monthly active users; 200,000 daily active users (DAU).
- Average DAU submits 5 times per session (mix of "run" for quick feedback and "submit" for final judged evaluation) → 1 million executions/day.
- Peak behavior is highly bursty rather than smooth: a scheduled contest or a popular new problem can concentrate a large fraction of daily volume into a short window — assume peak load is 20x the average rate for short periods (contest start), a far more extreme peak-to-average ratio than most systems in this course, because usage is driven by scheduled events, not organic browsing.

**Throughput:**

- Average: 1,000,000 / 86,400 ≈ 12 executions/sec.
- Peak (contest start): 12 × 20 ≈ 240 executions/sec for the burst window — this is the number that actually sizes the execution infrastructure, not the average, because the whole point of the system is staying responsive exactly when everyone submits at once.

**Compute sizing:** assume an average execution takes 2 seconds of wall-clock time (compiling, running against several test cases, tearing down the sandbox) and needs a dedicated, isolated slice of CPU/memory (e.g., 1 CPU core, 256 MB, for the sandbox's duration). At 240 concurrent executions during a burst, that's 240 sandboxed environments running simultaneously — a moderate number of machines (e.g., a few dozen mid-size hosts each running several sandboxes), not a huge cluster, but it must be able to scale elastically for burst windows rather than being provisioned at peak size permanently, which would waste resources the other 23 hours of the day.

**Storage:** submission code and results are small (a submission is typically a few KB of source code plus a similarly small result summary) — 1M/day × ~5 KB ≈ 5 GB/day, trivial. This is not a storage-bound problem at all; it's a compute-isolation and scheduling problem, which is why the deep dive focuses there rather than on data modeling.

**Read:write ratio:** submissions (writes, in the sense of "new execution requested") and viewing submission history (reads) are both modest in absolute volume compared to earlier lessons in this course — the defining characteristic of this system isn't a read/write skew, it's the *burstiness* of demand and the *cost per unit of work* (a sandboxed execution is far more expensive per request than a typical read or write elsewhere in this course).

## 31.3 API and data model

**Core endpoints:**

| Method & Path | Purpose | Request | Response |
| --- | --- | --- | --- |
| `POST /submissions` | Submit code for execution | `{problemId, language, sourceCode, mode: run\|submit}` | `{submissionId, status: "queued"}` |
| `GET /submissions/{id}` | Poll for result | — | `{status, verdict, output, runtimeMs, memoryKb}` |
| `GET /users/{id}/submissions` | Submission history | — | list of past submissions |
| `GET /problems/{id}` | Problem statement + test structure | — | problem details |

Because execution takes seconds, not milliseconds, submission is asynchronous by design: `POST /submissions` returns immediately with a `queued` status and an ID, and the client polls (or holds a WebSocket/long-poll connection) for the result — this mirrors the video-transcoding upload pattern from the TikTok lesson (decouple "accepted" from "done") for the same underlying reason: the work is too slow to do inline in the request/response cycle.

**Core entities:**

- `Submission { id, userId, problemId, language, sourceCode, status, verdict, createdAt }`
- `Problem { id, title, statement, testCases: [{input, expectedOutput, isHidden}], timeLimitMs, memoryLimitKb }`
- `ExecutionResult { submissionId, testCaseId, passed, actualOutput, runtimeMs, memoryKb, errorType }`

**SQL vs. NoSQL, by access pattern:**

- Submissions and their results are a moderate-volume, simple-schema, mostly point-lookup-by-ID workload (fetch a submission, list a user's submissions, look up a problem's test cases) with no need for complex joins beyond "submission belongs to a user and a problem" — a relational database is a comfortable, unremarkable fit here, and there's no strong pressure toward NoSQL the way there was for TikTok's engagement events or Kafka's message log, because this system's volume (12-240 req/sec) is nowhere near the range where relational databases stop being the simplest correct choice.
- The one piece that deliberately does *not* live in a persistent database is the execution queue itself (described below) — that's transient, in-flight work state, better suited to a message queue (as covered in the distributed message queue lesson) than a database table, since it's written once, read once by a worker, and then done.

## 31.4 High-level architecture

```text
Client (browser editor)
  -> API Gateway
       -> Submission Service -> Submission DB (status: queued)
                              -> Execution Queue
                                   -> Sandbox Worker Pool (auto-scaling)
                                        -> Sandbox (isolated container/VM per execution)
                                             runs code against test cases
                                        -> writes result back
                              <- Submission DB (status: completed, verdict)
       -> Client polls/subscribes for result
```

**Write/submit path:** a user's code submission is accepted immediately, persisted with `queued` status, and placed on the Execution Queue — the Submission Service's job ends there; it does not wait for execution to finish. This decoupling is what keeps the user-facing API responsive even when the execution backend is fully saturated during a burst: the worst case under load is a longer queue wait, communicated honestly to the user, rather than the API itself timing out or rejecting requests.

**Execution path:** a pool of Sandbox Workers continuously pulls queued submissions, and for each one, spins up an isolated sandbox (details in the deep dive), runs the submitted code against the problem's test cases within strict resource limits, tears the sandbox down, and writes the result back to the Submission DB, flipping status to `completed` with a verdict.

**Read path:** the client polls (or maintains a live connection) for the submission's status; once `completed`, it renders the verdict, output, and any error details. Submission history is a straightforward query against the Submission DB filtered by user.

## 31.5 Deep dive: sandboxed execution and the submission queue

The two genuinely hard problems here are running arbitrary untrusted code safely without letting it damage anything else on the platform, and keeping the system responsive when demand spikes far beyond the steady-state average — both stem from the same root cause (execution is expensive and the code being executed cannot be trusted), so it's worth treating them together.

### Sandboxed execution: isolation and resource limits

The fundamental risk is that submitted code is attacker-controlled input being *executed*, not just *read* — this is categorically more dangerous than almost anything else in this course, because a malicious submission isn't limited to sending bad data through an API, it can run arbitrary instructions on a real machine. The design needs layered defenses, not a single mechanism:

- **Process/container isolation.** Each execution runs inside its own isolated environment (a lightweight container or, for stronger isolation, a microVM) with its own filesystem view, process namespace, and no visibility into the host or other sandboxes' processes and files. This stops a submission from reading another user's code, tampering with the host, or interfering with a concurrently running sandbox.
- **Network isolation.** Sandboxes run with no outbound network access by default (or a tightly restricted allowlist, if a specific problem genuinely needs it) — this prevents a submission from exfiltrating data, calling out to attacker infrastructure, or using the platform's compute to attack other systems (a real and historically common abuse pattern for any "run my code" service).
- **Resource limits, enforced by the platform, not the code.** CPU time, memory, process count, and file-descriptor limits are set at the container/OS level (e.g., cgroups-style limits) before the code ever runs, so an infinite loop is killed by a wall-clock timeout regardless of what the code does, a memory-bomb is killed when it crosses the memory ceiling, and a fork-bomb (a program that recursively spawns processes to exhaust the system) is stopped by a hard cap on process count — none of these depend on the submitted code behaving reasonably, which is the whole point, since it's explicitly untrusted.
- **Filesystem restrictions.** The sandbox's writable filesystem is minimal and ephemeral — thrown away after execution — and read-only where possible (e.g., the language runtime itself), so nothing persists between executions and nothing can be planted for a future execution to pick up.
- **Least-privilege execution.** Code runs as an unprivileged user inside the sandbox, never as root/admin, further limiting what damage is possible even if a sandbox-escape vulnerability were somehow found in the isolation layer itself — this is defense in depth, not reliance on any single control being perfect.

The practical trade-off across these controls is startup latency versus isolation strength: a full virtual machine per execution gives the strongest isolation (a completely separate kernel) but is slower to start and heavier per execution; a lightweight container shares the host kernel and starts much faster but has a larger shared attack surface (a kernel vulnerability could theoretically be exploited to escape a container in a way a full VM wouldn't be exposed to). Many real systems land on lightweight, hardened microVMs specifically because they get container-like startup speed with much closer-to-VM isolation — a reasonable answer in an interview is naming this trade-off explicitly rather than asserting one option is simply "the" answer.

### The submission queue and worker pool

Because peak demand (a contest start) can be 20x average, provisioning enough sandbox workers to handle peak load permanently would mean the fleet sits mostly idle 23 hours a day — an expensive, wasteful design. The queue-based architecture from 31.4 exists precisely to absorb this burstiness: submissions pile up in the Execution Queue during a spike, and a worker pool that **auto-scales** based on queue depth (add more workers when the queue grows past a threshold, scale back down as it drains) handles the average case efficiently while still being able to grow to handle bursts, at the cost of a longer wait during the very peak of a spike rather than an outright failure.

A few refinements make this queue genuinely production-worthy rather than a naive FIFO:

- **Priority by mode.** A "run" request (quick, interactive feedback while writing code) should generally be prioritized over a "submit" request for a batch/background evaluation context, or the two might use entirely separate queues with different worker pools, since their latency expectations differ — a user actively iterating on code cares about seconds, while a final judged submission during a contest, though still time-sensitive, can tolerate a bit more queueing without harming the experience as much.
- **Fair scheduling across users.** Without any fairness mechanism, one user submitting a rapid burst of executions (intentionally or via a buggy client retry loop) could starve everyone else's queue position — per-user submission rate limiting (using the same rate-limiting techniques from the earlier lesson) in front of the queue keeps this from happening.
- **Dead-letter handling.** A submission whose sandbox crashes unexpectedly (worker host failure, infrastructure hiccup unrelated to the code itself) shouldn't be silently lost — it should be retried a bounded number of times or surfaced to the user as an infrastructure error distinct from a code error, so users aren't told their correct code "failed" due to a platform issue.

## 31.6 Bottlenecks and trade-offs

- **Single points of failure.** The Execution Queue is the connective tissue of the whole system — if it's down, submissions can still be accepted (written to the Submission DB as queued) but nothing executes, which is a degraded-but-not-fully-down state, generally the right failure mode here (accept and delay, rather than reject outright).
- **Hot spots.** A single viral or contest-driving problem can direct a disproportionate share of the queue's traffic at once, but because the queue and worker pool are already built around this exact bursty access pattern (unlike most systems in this course, where bursts are the exception), this is closer to "the expected case working as designed" than a true anomaly — the main risk is under-provisioned auto-scaling limits or ceilings that were sized for a smaller historical peak.
- **Consistency vs. availability.** This system leans toward availability: a delayed verdict (longer queue wait) is a far better failure mode than rejecting submissions outright, and there's little in this domain that resembles the strict, immediate consistency requirements seen in inventory/booking-style lessons — a submission's result doesn't need to be visible to anyone but the submitting user, and there's no shared, contended resource analogous to "the last seat" or "the last unit of stock."
- **What breaks first at 10x/100x scale:** at 10x, the auto-scaling policy's reaction speed becomes the limiting factor — if new sandbox worker capacity takes a couple of minutes to spin up, a sudden 10x spike still causes a real queueing delay before the fleet catches up, pushing toward keeping a modest pool of "warm" pre-initialized sandboxes ready to absorb the first wave of a spike instantly. At 100x, isolation infrastructure itself (how many isolated sandboxes a single physical host can run simultaneously without cross-contamination or noisy-neighbor resource contention between sandboxes) becomes the real ceiling, along with the operational cost of running a fleet large enough for rare, extreme peaks — which is exactly the kind of number that would push a real system toward tighter per-problem/per-contest capacity planning rather than pure reactive auto-scaling.

## 31.7 Summary

An online code editor's central challenge is not the editor UI, it's safely and efficiently running untrusted code: layered isolation (container/microVM, network restrictions, enforced resource limits, minimal filesystem, least privilege) so a malicious or broken submission can never affect anything beyond its own sandbox, combined with an asynchronous queue-and-worker-pool architecture specifically built to absorb the extreme, event-driven burstiness (contest starts, popular new problems) that's much more pronounced here than in most other systems in this course.

Natural follow-ups: how would you add real-time collaborative editing on top of this (a genuinely different problem, typically solved with operational transform or CRDTs to merge concurrent edits from multiple cursors without conflicts, layered on top of — not replacing — the sandboxed execution backend described here), and how would you support languages/frameworks with heavy dependencies (pre-baked sandbox images per language/version, refreshed and cached rather than installed fresh per execution, to keep sandbox startup time low).
