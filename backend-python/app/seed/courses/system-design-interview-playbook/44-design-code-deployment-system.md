> **Learning goal**
> Design an internal CI/CD deployment platform that rolls out code to production safely at scale, and be able to explain how blue-green, canary, and rolling deployment strategies differ, how automatic rollback triggers work, and how build artifacts are stored and versioned.

## 44.1 Requirements and scope

**Functional requirements**

- A developer can trigger a build from a code commit, producing a versioned, immutable build artifact.
- A deployment can roll that artifact out to a target environment (e.g., production) using a configurable strategy (rolling, blue-green, or canary).
- The system continuously monitors key health signals (error rate, latency, custom metrics) during a rollout and automatically halts/rolls back if they degrade beyond a threshold.
- A developer can view deployment history and manually trigger a rollback to any previous artifact version.
- Deployments to different services can happen independently and concurrently without interfering with each other.

**Non-functional requirements**

- **Safety over speed**: a deployment platform's worst failure mode is shipping a broken build to all of production at once — every design decision should bias toward limiting blast radius, even at the cost of a slower full rollout.
- **Fast detection and rollback**: the window between "a bad build starts receiving real traffic" and "it's fully rolled back" should be minutes, not hours — this is what actually limits how much damage a bad deploy can do.
- **High availability of the deployment system itself**: ironically, the deployment platform is infrastructure that other infrastructure depends on — if it's down, teams can't ship fixes, including fixes for outages the platform itself might be implicated in.
- **Auditability**: every deployment (who, what artifact, when, what happened) needs to be durably recorded — this matters for both debugging and compliance.
- **Scale**: potentially thousands of independent services, each deploying multiple times a day, across many independent teams.

**Out of scope**: the CI build/test pipeline's internals (compiling code, running unit tests — assume this produces a versioned artifact as an input to this system), infrastructure provisioning (standing up new servers/clusters from scratch), secrets management.

## 44.2 Scale estimation

Stated, round assumptions:

- **Services and deploy frequency**: assume 5,000 independent services across an organization, each deployed on average 3 times/day (a healthy, modern continuous-deployment cadence) → 15,000 deployments/day ≈ 15,000 / 86,400 ≈ **~0.17 deployments/sec** average — a genuinely low number in absolute request-rate terms; this system's difficulty isn't raw throughput.
- **Instances per service during rollout**: assume an average service runs 50 instances in production (varying widely by service) — a rollout needs to coordinate updating up to 50 individual instances per deployment while continuously evaluating health signals, not a single atomic "flip a switch" operation.
- **Build artifact size**: a typical compiled service artifact (container image, or a packaged binary/bundle) is commonly in the 100 MB - 1 GB range → at 15,000 deployments/day, that's on the order of a few TB/day of new artifact data — a manageable, conventional storage-and-versioning problem (similar in shape to the distributed-cloud-storage lesson) layered with a retention/garbage-collection policy (old, unused artifact versions shouldn't be kept forever).
- **Health-check evaluation frequency**: during an active rollout, the platform needs to evaluate health metrics (error rate, latency percentiles) frequently enough to catch a regression quickly — say every 10-30 seconds per rollout stage — which, even across many concurrent rollouts organization-wide, is a modest, steady monitoring-query workload, not a bursty one.
- **Blast radius, not throughput, is the number that matters most**: the truly important "scale" question for this system isn't requests/sec on the deployment platform itself — it's how many end-user requests could hit a bad build before the platform detects and reacts, which is a function of rollout strategy (Section 44.5), not raw system capacity.

The dominant insight: this is a **low-throughput, high-stakes coordination and monitoring problem** — the deployment platform itself handles modest request volume, but it's responsible for safely orchestrating changes to systems that themselves serve enormous production traffic, so its core value is entirely about *safety and blast-radius control*, not raw scale.

## 44.3 API and data model

**API**

| Method & Path | Request | Response |
| --- | --- | --- |
| `POST /builds` | `{ "serviceId", "commitSha" }` | `{ "buildId", "artifactVersion" }` |
| `POST /deployments` | `{ "serviceId", "artifactVersion", "environment", "strategy": "rolling"/"blue-green"/"canary" }` | `{ "deploymentId", "status": "in_progress" }` |
| `GET /deployments/{id}` | — | `{ "status", "currentStage", "healthMetrics" }` |
| `POST /deployments/{id}/rollback` | — | `202 Accepted` (manual rollback trigger) |
| `GET /services/{id}/deployments/history` | — | List of past deployments with outcomes |

**Data model**

Core entities:

- `Artifact { version (PK), serviceId, commitSha, storageLocation, buildTimestamp }` — an immutable record; once built, an artifact version's content never changes.
- `Deployment { id, serviceId, artifactVersion, environment, strategy, status, currentStage, startedAt, completedAt }`
- `DeploymentEvent { deploymentId, timestamp, eventType, details }` — an append-only log of everything that happened during a rollout (stage advanced, health check evaluated, rollback triggered), which is what powers both live status and post-incident review.

Artifacts themselves (the actual build output — a container image or packaged bundle) belong in **object/blob storage**, referenced by a content-addressed or explicitly versioned key, following the same reasoning as chunk/blob storage in earlier lessons: large, immutable binary content with a simple point-lookup access pattern (fetch by version) is a poor fit for a relational database's row storage and a natural fit for object storage. The `Deployment` and `DeploymentEvent` records, by contrast, are exactly the kind of structured, relationship-bearing, moderate-volume data (a deployment belongs to a service, has many events, has a current status that must be updated consistently) that a relational database handles well — and given the low absolute write rate from Stage 2, there's no scale-driven reason to reach for anything else. The append-only `DeploymentEvent` log specifically is valuable as a genuine audit trail — deployment history and post-incident debugging depend on being able to reconstruct exactly what the platform observed and did, in order, which argues for treating it as an immutable log rather than a table of mutable rows that get overwritten.

## 44.4 High-level architecture

```text
Developer / CI trigger
      -> Build Service -> Artifact Store (versioned, immutable)
      -> Deployment Service (owns rollout state machine per deployment)
             -> Orchestrator (talks to the actual infrastructure: updates instances per strategy)
             -> Health Monitor (continuously evaluates metrics during rollout)
                      -> [healthy]  -> advance to next stage
                      -> [unhealthy] -> trigger automatic rollback
             -> Deployment DB (durable state + event log)
```

**Build path**: a commit triggers a build (assumed produced upstream, out of scope), which is stored as an immutable, versioned artifact in the Artifact Store. Immutability matters here for the same reason it matters in the file-sync and distributed-storage lessons: a rollback needs to be able to reliably re-deploy an exact, unmodified previous artifact — if artifacts could be overwritten in place, "roll back to version N" would no longer be a reliable, well-defined operation.

**Deployment path**: a deployment request specifies a target artifact version, environment, and strategy. The Deployment Service creates a deployment record and hands control to the Orchestrator, which begins executing the chosen rollout strategy (Section 44.5) against the actual running infrastructure — updating some subset of instances at a time, never all at once by default. Throughout the rollout, the Health Monitor continuously evaluates the service's key metrics (error rate, latency, any custom application-defined health signal) scoped specifically to the newly deployed instances where possible (not just the service's aggregate metrics, which could mask a problem isolated to the new version if old-version instances are still serving most traffic) and feeds that signal back to the Orchestrator, which decides whether to proceed to the next stage, pause, or automatically roll back.

**Rollback path**: whether triggered automatically by the Health Monitor or manually by a developer, a rollback re-runs essentially the same orchestration machinery in reverse — routing traffic back to (or redeploying) the last known-good artifact version, using the same staged, monitored approach rather than an instantaneous, unmonitored full switch, since a rollback can itself go wrong and deserves the same safety treatment as a forward deployment.

## 44.5 Deep dive: rollout strategies with automatic rollback, and artifact versioning

### Rolling deployment

Instances running the old version are replaced with the new version incrementally, a batch at a time (e.g., 10% of instances at once), with the Health Monitor checking signals between batches before proceeding to the next. This is the simplest strategy and uses infrastructure efficiently (no need to run two full parallel environments), but has a real limitation: during the rollout, both old and new versions are simultaneously serving live production traffic, which requires the new version to be backward-compatible with whatever the old version expects from shared dependencies (a database schema, a downstream service's API) — a rolling deployment implicitly assumes this compatibility holds, and if a change genuinely isn't safe to run in a mixed-version state, rolling deployment isn't a safe strategy choice regardless of how careful the health monitoring is.

### Blue-green deployment

Two complete, independent environments exist: "blue" (currently serving all production traffic) and "green" (a full parallel environment, not receiving traffic yet). The new version is deployed entirely to green, validated there (automated checks, sometimes a period of synthetic or shadow traffic), and then traffic is switched from blue to green — commonly all at once at the routing/load-balancer level, though even blue-green deployments increasingly layer a gradual traffic shift on top rather than an instantaneous full cutover, blurring the line with canary below. The key advantage is that rollback is extremely fast and simple: if green shows a problem after the switch, traffic is simply pointed back at blue, which was never touched and is still fully intact and warm. The cost is running double the infrastructure capacity during the transition (two full production-sized environments simultaneously), which is a real resource cost compared to rolling deployment's incremental approach.

### Canary deployment

A small fraction of traffic (e.g., 1-5%) is routed to the new version while the vast majority continues to the old version, and that small canary slice is closely monitored before gradually increasing the new version's traffic share (5% → 25% → 50% → 100%, typically with a health check gate between each step). This strategy is specifically optimized for **limiting blast radius** — the non-functional requirement stated as the top priority in Stage 1 — because a genuinely bad build only ever affects a small percentage of real users before the automatic rollback trigger (below) reverts it, rather than a rolling deployment's larger batches or blue-green's all-at-once cutover. The trade-off is that a full canary rollout takes longer to reach 100% (multiple monitored stages, each requiring a dwell time to gather enough signal) and requires the routing layer to support fine-grained traffic-percentage splitting, not just binary instance replacement.

| Strategy | Blast radius if bad | Infra cost during rollout | Rollback speed | Requires version-compatibility during transition |
| --- | --- | --- | --- | --- |
| Rolling | Grows with each batch | Low (no duplicate capacity) | Moderate (reverse the batches) | Yes — old and new coexist |
| Blue-green | Contained until cutover, then large if undetected | High (2x capacity briefly) | Very fast (switch back) | No — green is fully isolated until cutover |
| Canary | Smallest — capped at current traffic percentage | Low-moderate | Fast (shift traffic back) | Yes, but a much smaller exposed fraction |

Canary is the strongest default answer for the stated non-functional priority (safety/blast-radius over speed), and production deployment platforms commonly combine canary's gradual traffic-percentage approach with rolling deployment's incremental instance replacement underneath it — canary controls *how much traffic* the new version sees at each stage, while the actual instance-level mechanics of getting new-version capacity online can look like a rolling deployment.

### Automatic rollback triggers

The Health Monitor's job is to answer, continuously during a rollout, "is the new version measurably worse than the old one, right now?" — and to trigger a rollback the moment the answer is confidently yes, without waiting for a human to notice a dashboard.

Key design points:

- **Compare against a baseline, not an absolute threshold alone.** A pure absolute threshold ("roll back if error rate exceeds 2%") can either fire on a service that's *always* had a 2% baseline error rate (a false alarm) or fail to fire on a service whose normal baseline is 0.01% but the new version pushed it to 1% (a real regression that an absolute 2% threshold would miss). The more robust approach compares the new version's metrics against the *old version's concurrently observed metrics* (meaningful specifically during a canary or rolling deployment, where both versions are genuinely serving live traffic side by side at the same time, under the same real-world conditions) — a relative comparison is far more sensitive and far less prone to false alarms than a fixed absolute threshold.
- **Require sustained signal, not a single bad data point.** A momentary blip (one slow request, one transient error) shouldn't trigger a full rollback — the monitor typically requires the degradation to persist across multiple consecutive evaluation windows (tying back to the ~10-30 second evaluation cadence from Stage 2) before acting, trading a small amount of added detection latency for meaningfully fewer false-positive rollbacks, which themselves have a real cost (interrupting a legitimate deployment, eroding trust in the automation).
- **Multiple signal types, not just error rate.** Latency percentiles (p95/p99, not just average, since averages can hide a meaningful tail regression), custom application-level health signals (a queue depth, a business metric), and infrastructure-level signals (CPU, memory, restart/crash-loop counts) all feed into the same evaluation — a build can be "healthy" by error rate alone while quietly degrading latency or leaking memory, so relying on a single metric leaves real classes of regressions undetected.
- **The rollback action itself must be fast and well-tested.** An automatic rollback trigger only limits blast radius if the actual rollback mechanism executes quickly and reliably — this is why blue-green's near-instantaneous traffic-switch rollback is attractive from a pure safety standpoint, and why canary/rolling deployments need their own traffic-shifting and instance-replacement machinery to be similarly fast and dependable, not just the forward-deployment path.

### Build artifact storage and versioning

Every build produces an **immutable** artifact tagged with a unique, monotonically meaningful version (commonly derived from the source commit and/or a build counter). Immutability is the load-bearing property here: a deployment or rollback operation always refers to a specific, exact version, and if that version's content could silently change after the fact, "roll back to the last known-good version" would no longer be a reliable guarantee — this is the same principle as the immutable chunk/version model in the file-sync lesson, applied to build artifacts instead of file content. Artifacts are stored in object storage (Section 44.3) with metadata linking each version back to its source commit, build parameters, and which deployments have used it — this traceability is what makes "what exactly is running in production right now, and where did it come from" an answerable question, which matters enormously during incident response. Old, unused artifact versions are eventually garbage-collected on a retention policy (e.g., keep the last N versions per service, or everything referenced by any deployment within the last 90 days) to bound storage growth, since keeping every artifact ever built forever is unnecessary given that only recent versions are ever realistically rolled back to.

## 44.6 Bottlenecks and trade-offs

- **Single points of failure**: the Deployment Service and its orchestration logic are a SPOF for the platform's ability to ship *any* code, which is a serious organizational risk given the non-functional requirement that the deployment platform itself needs high availability — mitigated with standard service redundancy/failover, and critically, by designing the system so an outage in the deployment platform does not affect *already-running* production services (a paused or failed deployment platform should leave existing traffic serving normally, not take down services that aren't currently mid-deployment).
- **Hot spots**: an organization-wide incident response scenario (many teams simultaneously trying to deploy hotfixes at once) can create an unusual concentrated burst of deployment activity against the platform — a very different profile from its normal, low, steady request rate (Stage 2) — mitigated by ensuring the orchestration and health-monitoring components scale horizontally per-deployment (each deployment's rollout is independent of every other's) rather than sharing a bottlenecked, centrally-serialized execution path.
- **Consistency vs. availability**: the deployment state machine (what stage a rollout is in, whether it's healthy) needs strong consistency — two orchestrator instances disagreeing about a deployment's current stage could lead to a dangerous double-action (e.g., both advancing to the next stage independently, effectively skipping the intended gradual rollout). This is a case where correctness in the coordination logic matters more than raw throughput, similar in spirit to the ticket-booking system's seat-locking problem, just applied to deployment stage transitions instead of seat rows.
- **What breaks first at 10x/100x scale**: at 10x deployment frequency (organization-wide continuous deployment maturing further), the platform's orchestration and monitoring tiers scale by handling more concurrent, independent rollouts in parallel — a largely horizontal scaling story since deployments are naturally independent of each other. At 100x, the harder problem shifts to the *shared infrastructure* each rollout depends on (load balancers/routing layers that need to support fine-grained traffic splitting for many concurrent canaries, and metrics/observability pipelines that need to ingest and evaluate health signals for a much larger number of simultaneous rollouts) rather than the deployment platform's own core logic.

## 44.7 Summary

A deployment platform's core value is entirely about limiting blast radius and reacting quickly when something goes wrong, not raw throughput — canary deployment (small, gradually increasing traffic exposure) is generally the strongest default for that goal, blue-green trades extra infrastructure cost for the fastest possible rollback, and rolling deployment is the leanest option when version-compatibility during the transition is safe to assume. Automatic rollback triggers work best comparing the new version against the old version's concurrently observed baseline (not a fixed absolute threshold) across multiple metric types, requiring sustained rather than momentary signal before acting — and none of this works without immutable, versioned build artifacts that make "roll back to exactly this" a reliable, well-defined operation.

Natural follow-ups an interviewer might raise: coordinating deployments across services with real runtime dependencies on each other (where deploying service A safely might require service B to already be at a compatible version), and progressive delivery based on feature flags layered independently on top of deployment (decoupling "this code is running in production" from "this feature is turned on for users," which changes rollback into a much cheaper flag-flip rather than a full redeploy).
