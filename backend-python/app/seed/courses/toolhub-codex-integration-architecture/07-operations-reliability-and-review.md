> **Learning goal**
> Evaluate deployment hardening, observability, common failures, design trade-offs, and the now-implemented multi-provider architecture.

## 7.1 Production placement

| Service | Host | Listener | Runtime identity |
| --- | --- | --- | --- |
| ToolHub frontend/backend | `ubuntu-purva` | Existing ToolHub ports/proxy | Docker services |
| Redis | `ubuntu-purva` | Docker service `redis` (container `toolhub-redis`), internal `redis:6379` | Docker container, `allkeys-lru` at 256MB |
| Codex gateway | `ubuntu-purva` | Private Tailscale address, port 8765 | `codexgateway` system user |
| Codex executor | `hp-codex` | Private Tailscale address, port 8766 | `anikesh348` |
| Codex CLI | Child of executor | No application listener | Sanitized executor environment |
| Claude gateway | `ubuntu-purva` | Private Tailscale address, port 8767 | `claudegateway` system user |
| Claude executor | `hp-claude` (Tailscale `100.109.98.8`) | Private Tailscale address, port 8773 | Dedicated low-blast-radius guest, separate from `hp-codex` |
| Claude CLI | Child of Claude executor | No application listener | Sanitized executor environment |
| Codex/Claude operator gateways | `ubuntu-purva` | Private Tailscale addresses, ports 8772/8770-range | Scheduler-only clients (ops scheduler), separate registries from ToolHub |

Redis became a required dependency on 2026-08-05: `docker-compose.yml` now has the `backend` service `depends_on: redis: condition: service_healthy`, so the ToolHub backend will not start without it. Nothing in the gateway or executor tier depends on Redis — the pin lives entirely in the ToolHub backend's own routing layer (1.7, 4.8).

None of the six gateway/executor services is exposed through public VPS/Caddy ingress. Tailscale/private networking limits reachability, while HMAC still authenticates every meaningful operation, independently, on every hop.

## 7.2 Service durability

All four gateway/executor services (Codex and Claude, application and operator variants) run as systemd services with `Restart=on-failure`. They wait for network/Tailscale readiness and apply hardening such as `NoNewPrivileges`, protected system paths, empty capability sets, private temporary directories and memory/task limits — the Claude services were deployed against the same hardening template as the Codex ones, not a looser one.

ToolHub runs through Docker Compose. The backend health check gates frontend recreation so the login/UI path does not start against an unavailable backend; Redis's own healthcheck (`redis-cli ping`) now sits in that same startup gate.

## 7.3 Observability model

Useful evidence exists at several layers:

- ToolHub Mongo records show pending/completed/failed user-visible work.
- ToolHub logs show route status and background-task failures.
- Gateway logs include request ID, client ID and source without prompts.
- Gateway SQLite records status, capability and safe error code.
- Executor logs include request ID and safe HTTP outcome.
- systemd and container health show process availability.
- `/healthz` checks liveness; signed `/readyz` checks configured readiness.

The same request ID travels from ToolHub to gateway to executor, making correlation possible without logging the sensitive prompt. Since failover means a single ToolHub background task can generate a Codex request ID and then a separate Claude request ID for what the user experiences as one message, correlating the two now depends on ToolHub's own logs (which see both attempts) rather than either gateway's logs alone (which each see only their own attempt).

`GET /v2/admin/ai/health` (6.2a) is the fastest way to see current routing state without reading logs at all: it reports each configured provider's live readiness and the router's active/preferred/fallback/pinned-seconds state in one response.

## 7.4 Failure-mode review

| Failure | Observable behavior | Recovery |
| --- | --- | --- |
| Unsigned gateway request | `401 authentication_failed` | Fix client identity/signature; do not weaken auth |
| Reused nonce | `409 replayed_request` | Generate a new nonce |
| Gateway/executor already running work | `429` busy | Retry later or design an explicit queue |
| Context exceeds limit | `400 invalid_context` | Select/retrieve bounded context |
| Codex exceeds 300 seconds | provider timeout | Process group terminated; persisted app record can show failure |
| Codex authentication invalid | safe provider-auth failure | Reauthenticate on hp-codex through controlled administration |
| Executor unavailable | gateway returns normalized `503` | Restore private service/network; ToolHub remains responsive (if the *other* provider is configured and not exhausted, the router fails over instead of surfacing the `503`) |
| Backend restarts during a chat | Mongo message remains; run lock resets at startup | Retry from persisted state |
| MongoDB unavailable | course/chat persistence fails | Restore DB before accepting durable application work |
| Preferred provider (Codex) reports usage exhausted | Request is retried against Claude in the same call; Redis pin set for up to `AI_PROVIDER_ACTIVE_TTL_SECONDS` (default 86400s) | No operator action needed; pin clears itself, or clears early once Codex is retried after the TTL |
| Both configured providers report usage exhausted | `429 provider_usage_exhausted`, Redis pin cleared | Wait for allowance to reset on either provider, or add a third; next request tries Codex first again |
| Redis unavailable | Backend fails to start (`depends_on: service_healthy`); if Redis drops after startup, `cache_get`/`cache_add` calls catch their own exceptions and return `None`/`False`, so the router silently falls back to “always try Codex first” | Restore Redis; until then, failover still works per-request, it just isn’t remembered across requests |

## 7.5 Current trade-offs

Single concurrency is simple and safe for each small executor VM, but it means contention returns `429`. Background tasks avoid web timeouts but are not a durable external job queue; a hard backend crash can leave a pending course question until a retry/reconciliation mechanism is added.

SQLite is appropriate for low-volume audit and nonce data, but it is local to each service and not a distributed event system. Polling is reliable and simple, but less immediate than Server-Sent Events or WebSockets.

Relevant-block retrieval is deterministic and cheap, but it is lexical rather than semantic. An embedding index could improve retrieval later, provided course authorization and content-version traceability remain intact.

The provider pin is a fixed-TTL guess, not a live probe: once Claude is pinned, ToolHub does not re-check whether Codex has recovered until the TTL expires (or until Claude also exhausts, which clears the pin early). A shorter TTL would recover from a transient Codex outage faster but would re-attempt a genuinely exhausted Codex account more often for no benefit; a longer TTL does the opposite. `AI_PROVIDER_ACTIVE_TTL_SECONDS` exists specifically so this can be tuned per deployment without a code change. Redis being a hard dependency of the backend (7.1) is itself a trade-off accepted for this feature: cross-worker consistency for the pin was judged worth adding a new required service, rather than accepting that different backend workers might guess differently about which provider is active.

## 7.6 Multi-provider failover: Codex + Claude (implemented 2026-08-05)

What was described in earlier drafts of this course as a future extension is now the running system. The deployed topology is:

```text
ToolHub backend (ai_provider_router)
  -> Codex gateway on ubuntu-purva:8765  -> Codex executor on hp-codex:8766   -> codex exec
  -> Claude gateway on ubuntu-purva:8767 -> Claude executor on hp-claude:8773 -> claude
```

ToolHub's `SUPPORTED_PROVIDERS` constant is `("codex", "claude")`; the application request/response schema, Mongo models (aside from the provider-scoped fields in 6.3) and course UI stayed stable through the change, exactly as the earlier plan intended. Each provider keeps separate secrets, its own executor VM, its own errors and its own audit data — Claude does not share so much as a client registry entry with Codex, even though both are labeled `toolhub-admin` (3.4).

Provider-neutral did not mean pretending the runtimes are identical. The gateway adapters are the only Codex-specific and Claude-specific code (4.7); everything upstream of `ExecutorClient` — HMAC, nonce handling, audit schema, capability profile enforcement, runtime snapshot format — is the exact same code, vendored once per service.

The design also validated itself in a second, unplanned way: the same gateway/executor pattern was independently reused by an unrelated system (the ops scheduler, via `codex-operator-gateway` and `claude-operator-gateway`) with its own client identity and its own limits, without any change to either provider's executor and without ToolHub's deployment being touched at all. That is precisely the isolation property 2.2 predicted before either operator gateway existed — and, as 7.6a explains, that same reuse is also how a genuinely write-capable profile entered this infrastructure without ever touching ToolHub.

## 7.6a Operator mode: the scheduler's full-access sibling (2026-08-05)

This subsection exists because the reusability story in 2.2/7.6 undersells what actually got reused if it stops at "same contract, bigger limits." The full picture: `codex-operator-gateway` and `claude-operator-gateway` accept a third capability profile that neither ToolHub gateway recognizes — `operator` — and it is not a bigger `read-only`.

**What `operator` grants.** On the executor side (`codex_executor`'s `runner.py`, `hp-codex`), the config overrides for `operator` are categorically different from `knowledge-only`/`read-only`:

```text
sandbox_mode="danger-full-access"
model="gpt-5.6-sol"
model_reasoning_effort="medium"
```

with developer instructions that read, in part: *"You have full shell, filesystem, and network access, including SSH to explicitly named hosts... There is no human available to approve actions or answer questions: make the safest reasonable decision yourself."* There is no `permissions.*` allowlist, no `features.shell_tool=false`, no `web_search` restriction — the permission-profile mechanism that makes `knowledge-only`/`read-only` enforceable (1.3, 5.5–5.7) is simply not applied here. The common overrides (`approval_policy="never"`, disabled plugins/hooks/memories/multi-agent) still apply, but "never approve" means something very different when the sandbox is wide open than when it's `deny`-by-default.

**Where it runs, and why that isolation matters more here than anywhere else in this course.** `operator` requests never reach `codex-executor` or `claude-executor` — the same processes that serve ToolHub. They reach dedicated `codex-operator-executor` / `claude-operator-executor` processes: separate systemd units, separate `ReadWritePaths` (`/home/anikesh348/.codex`, `/home/anikesh348/docker-update-framework`), a much larger `TasksMax`/`MemoryMax`. If this profile were reachable from ToolHub's executor, every hardening argument in Lesson 5 about "the model is instructed to be read-only, but the sandbox is what actually enforces it" would need re-litigating for the chat and course paths too. It isn't reachable — the separation is exactly what keeps 1.3/5.5–5.7's guarantees true for ToolHub while `operator` exists at all.

**Who calls it, and how failover works there too.** Only `opsched`, a scheduled-job runner on `ubuntu-purva` (systemd timers, not ToolHub), calls `operator`. Its `ai_client.py` independently reimplements Codex-first/Claude-fallback logic — same usage-exhaustion codes and markers as `ai_provider_router.py` (1.7, 3.6), explicitly documented in its own docstring as mirroring that module — but *without* a Redis pin: each job run just tries Codex, then Claude, fresh. That's a reasonable simplification here because operator jobs are infrequent (a 2-minute connectivity check, a daily log digest, a maintenance scan that only actually executes every 10 days) and don't share the cross-worker-consistency problem a multi-worker web backend has.

Three scheduled jobs currently use it: `docker_update` (an AI-driven scan-and-update pass over the homelab's Docker fleet, replacing an older direct-`codex exec` script; supports a `CODEX_DOCKER_UPDATE_DRY_RUN` mode), `log_digest`, and `connectivity_alert`.

**The audit trail — this is what makes the tradeoff legible, not what prevents it.** `operator` has no live human approval by design, so accountability is after-the-fact: `opsched/history.py` reports every job run (job name, host, start/finish time, status, summary, *which provider answered*) to ToolHub over a trusted local `docker exec -i backend` call into `POST /v2/scheduler/runs`, which an admin reviews via `GET /v2/admin/scheduler/runs` and the `/admin/scheduler` UI page. The `docker_update` job additionally pushes its own conclusion as a ToolHub admin notification (retrying via a pending-alert file if delivery fails). None of this is preventive — nothing here can block or roll back what the model already did — but it means "what did the operator profile do and which provider did it" is always answerable from ToolHub's own admin surface, not just from a log file on a management VM.

## 7.7 Before adding write capabilities — and how `operator` actually measures up

A write-capable design should add, at minimum:

- explicit operation/tool schemas instead of arbitrary shell;
- target allowlists and per-operation scopes;
- preview and human approval for material changes;
- idempotency keys and rollback metadata;
- stronger durable job orchestration;
- output redaction and sensitive-data handling;
- complete action audit records;
- tests proving denial of operations outside the policy.

It should be a new capability profile, not a relaxation of `read-only`. The `operator` profile (7.6a) followed that last rule to the letter — it is its own profile, its own gateway pair, its own executor pair. Measured against the rest of this list, honestly: it has complete-enough *run-level* audit records (job, host, timing, status, provider — after the fact, via `/v2/admin/scheduler/runs`), but no operation-level tool schema, no target allowlist enforced in code (host naming is instruction-level, not sandboxed), no preview/approval step, and no idempotency or rollback metadata beyond whatever the model narrates in its conclusion text. That gap is a deliberate bet, not an oversight: `operator` is reachable only by a fixed set of scheduled jobs on infrastructure with a single trusted operator, not by any multi-tenant or browser-facing surface — the same isolation argument from 7.6a is what makes that bet legible rather than silent. It would not be an acceptable design for a second write-capable profile added to ToolHub itself, where the caller is an admin through a browser rather than a fixed cron job.

## 7.8 Final architecture review checklist

- Does the browser call only the application backend?
- Does ToolHub authorize the human and own application persistence?
- Does every private hop authenticate its immediate caller independently?
- Are `knowledge-only`/`read-only` execution arguments fixed and shell-free? (`operator` is deliberately the one documented exception — confirm it stays unreachable from ToolHub's own gateway and executor, not just unused by them.)
- Are capability restrictions enforced through tools/configuration as well as instructions, for every profile that claims to be restricted?
- Can all long operations fail without taking down unrelated ToolHub APIs?
- Are request sizes, timeouts and concurrency bounded?
- Can operators correlate failures without logging prompts or secrets?
- Does each provider keep an isolated gateway/executor boundary — verified now against two real providers, not just Codex?
- Does a provider failover ever get triggered by ordinary busy/contention errors instead of genuine usage exhaustion?
- If Redis is unreachable, does the system degrade to “no memory of the pin” rather than fail closed?
- Is every capability profile's blast radius proportionate to who can actually invoke it — a browser-facing admin chat versus a fixed set of scheduled jobs?

> **Final exercise**
> Draw the complete flow for a course question and for “what is my CPU usage?”, including the provider router's attempt-order decision. Mark the database writes, authentication decisions, runtime snapshots, capability profile and failure boundaries on each diagram. Then redraw the “what is my CPU usage?” flow for the case where Codex has just reported its usage allowance exhausted — mark exactly where the Redis pin is written and which host's snapshot ends up in the final prompt. Finally, draw the `docker_update` operator job as a fourth diagram next to the other three: same HMAC/nonce/audit machinery at the gateway, same Codex-first/Claude-fallback shape — but trace exactly where the diagram has to stop looking like the other three, and where "no live approval" gets compensated for by something that happens after the fact instead of before it.
