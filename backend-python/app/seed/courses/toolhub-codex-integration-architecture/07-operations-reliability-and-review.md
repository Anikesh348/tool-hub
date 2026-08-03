> **Learning goal**
> Evaluate deployment hardening, observability, common failures, design trade-offs and the path to future providers.

## 7.1 Production placement

| Service | Host | Listener | Runtime identity |
| --- | --- | --- | --- |
| ToolHub frontend/backend | `ubuntu-purva` | Existing ToolHub ports/proxy | Docker services |
| Codex gateway | `ubuntu-purva` | Private Tailscale address, port 8765 | `codexgateway` system user |
| Codex executor | `hp-codex` | Private Tailscale address, port 8766 | `anikesh348` |
| Codex CLI | Child of executor | No application listener | Sanitized executor environment |

Neither gateway nor executor is exposed through public VPS/Caddy ingress. Tailscale/private networking limits reachability, while HMAC still authenticates every meaningful operation.

## 7.2 Service durability

Both gateway and executor run as systemd services with `Restart=on-failure`. They wait for network/Tailscale readiness and apply hardening such as `NoNewPrivileges`, protected system paths, empty capability sets, private temporary directories and memory/task limits.

ToolHub runs through Docker Compose. The backend health check gates frontend recreation so the login/UI path does not start against an unavailable backend.

## 7.3 Observability model

Useful evidence exists at several layers:

- ToolHub Mongo records show pending/completed/failed user-visible work.
- ToolHub logs show route status and background-task failures.
- Gateway logs include request ID, client ID and source without prompts.
- Gateway SQLite records status, capability and safe error code.
- Executor logs include request ID and safe HTTP outcome.
- systemd and container health show process availability.
- `/healthz` checks liveness; signed `/readyz` checks configured readiness.

The same request ID travels from ToolHub to gateway to executor, making correlation possible without logging the sensitive prompt.

## 7.4 Failure-mode review

| Failure | Observable behavior | Recovery |
| --- | --- | --- |
| Unsigned gateway request | `401 authentication_failed` | Fix client identity/signature; do not weaken auth |
| Reused nonce | `409 replayed_request` | Generate a new nonce |
| Gateway/executor already running work | `429` busy | Retry later or design an explicit queue |
| Context exceeds limit | `400 invalid_context` | Select/retrieve bounded context |
| Codex exceeds 300 seconds | provider timeout | Process group terminated; persisted app record can show failure |
| Codex authentication invalid | safe provider-auth failure | Reauthenticate on hp-codex through controlled administration |
| Executor unavailable | gateway returns normalized `503` | Restore private service/network; ToolHub remains responsive |
| Backend restarts during a chat | Mongo message remains; run lock resets at startup | Retry from persisted state |
| MongoDB unavailable | course/chat persistence fails | Restore DB before accepting durable application work |

## 7.5 Current trade-offs

Single concurrency is simple and safe for the small executor VM, but it means contention returns `429`. Background tasks avoid web timeouts but are not a durable external job queue; a hard backend crash can leave a pending course question until a retry/reconciliation mechanism is added.

SQLite is appropriate for low-volume audit and nonce data, but it is local to each service and not a distributed event system. Polling is reliable and simple, but less immediate than Server-Sent Events or WebSockets.

Relevant-block retrieval is deterministic and cheap, but it is lexical rather than semantic. An embedding index could improve retrieval later, provided course authorization and content-version traceability remain intact.

## 7.6 Future Claude integration

The intended extension is:

```text
ToolHub backend
  -> Claude gateway on ubuntu-purva
  -> private Claude executor VM
  -> Claude Code runtime
```

ToolHub’s provider configuration would choose Codex or Claude. The application request/response schema, Mongo models and course UI can remain stable. Each provider keeps separate secrets, executor state, errors and audit data.

Provider-neutral does not mean pretending all runtimes are identical. Each gateway adapter must translate the shared capability meaning into enforceable provider-specific configuration.

## 7.7 Before adding write capabilities

A write-capable design should add, at minimum:

- explicit operation/tool schemas instead of arbitrary shell;
- target allowlists and per-operation scopes;
- preview and human approval for material changes;
- idempotency keys and rollback metadata;
- stronger durable job orchestration;
- output redaction and sensitive-data handling;
- complete action audit records;
- tests proving denial of operations outside the policy.

It should be a new capability profile, not a relaxation of `read-only`.

## 7.8 Final architecture review checklist

- Does the browser call only the application backend?
- Does ToolHub authorize the human and own application persistence?
- Does every private hop authenticate its immediate caller independently?
- Are provider execution arguments fixed and shell-free?
- Are capability restrictions enforced through tools/configuration as well as instructions?
- Can all long operations fail without taking down unrelated ToolHub APIs?
- Are request sizes, timeouts and concurrency bounded?
- Can operators correlate failures without logging prompts or secrets?
- Does each future provider keep an isolated gateway/executor boundary?

> **Final exercise**
> Draw the complete flow for a course question and for “what is my CPU usage?”. Mark the database writes, authentication decisions, runtime snapshots, capability profile and failure boundaries on each diagram.
