> **Learning goal**
> Understand the major components, trust boundaries, data ownership and end-to-end request flows.

## 2.1 Component map

```text
Admin browser
  | HTTPS/cookie session
  v
ToolHub frontend (React/Vite served by Nginx)
  | /api/v2/admin/...
  v
ToolHub backend (FastAPI, ubuntu-purva)
  | ai_provider_router: pick attempt order (Redis pin, default Codex first)
  | signed REST request over private network
  v
Codex gateway (ubuntu-purva:8765)        Claude gateway (ubuntu-purva:8767)
  | separately signed executor request     | separately signed executor request
  v                                        v
Codex executor (hp-codex:8766)           Claude executor (hp-claude:8773)
  | fixed subprocess contract               | fixed subprocess contract
  v                                        v
Codex CLI and authenticated Codex runtime  Claude CLI and authenticated Claude runtime
```

MongoDB sits beside the ToolHub backend and stores application state. Redis sits beside the ToolHub backend too, and since 2026-08-05 it is a required dependency (`docker-compose.yml` gates backend startup on the Redis healthcheck): it holds the cross-worker active-provider pin the router reads on every request, plus unrelated per-feature caches (e.g. BuzzWatch) that reuse the same generic `redis_cache` module. SQLite beside each gateway stores that gateway's own request audit metadata and used nonces; a separate SQLite nonce store exists beside each executor. Each provider runtime owns its own thread state under its own authenticated home directory — Codex's and Claude's thread IDs are never interchangeable.

## 2.2 Why gateway and executor are separate

The gateway is a reusable application boundary. It knows approved clients and the provider-neutral `/v1/responses` contract, but it does not launch a CLI. The executor is a provider-host boundary. It knows how to start its provider's CLI securely, but it does not know ToolHub users, courses or routes.

This gives two useful isolation properties, and both are now demonstrated in production rather than hypothetical:

1. **A new application can receive its own gateway identity without receiving access to either provider VM — and, in this case, without even sharing the same executor.** The unrelated ops-scheduler system (`opsched`) was added exactly this way: `codex-operator-gateway` and `claude-operator-gateway` run as separate systemd services on `ubuntu-purva` (ports 8772 and a Claude equivalent), with their own client registries (`scheduler`, not `toolhub-admin`), much larger limits (32,000-char input, up to 3,600s timeout), and — this is the part worth not glossing over — a **third capability profile, `operator`**, that neither ToolHub gateway will accept. `operator` runs Codex/Claude with `sandbox_mode="danger-full-access"`, full shell/filesystem/network access and explicit permission to SSH to named hosts, with developer instructions telling the model no human is available to approve anything. It executes on its own dedicated `codex-operator-executor` / `claude-operator-executor` processes — separate systemd units, separate ReadWritePaths, separate resource limits — not the same executor ToolHub's chat and course features call. Full detail, including how these runs are still audited, is in 7.6a; the architectural point here is narrower: reusing the gateway *contract* did not require reusing the gateway's *capability ceiling* — a much more permissive client could be added without touching a single line of ToolHub's own gateway, executor, or secrets.
2. **A Claude gateway/executor pair implements the same application contract without moving ToolHub persistence or provider secrets into the browser.** `claude-gateway.service` (ubuntu-purva, port 8767, user `claudegateway`) and its executor on `hp-claude` (100.109.98.8:8773) were deployed on 2026-08-05. The gateway process is structurally the same server as the Codex gateway — same `ThreadingHTTPServer`, one-slot semaphore, SQLite audit/nonce stores, executor-adapter pattern — and it imports its HMAC/nonce/replay logic and its runtime-snapshot generator from the *same* `ai_gateway_protocol.py` / `runtime_snapshot.py` modules the Codex gateway uses (vendored into each service's own `shared/` directory rather than a single shared install). The only genuinely provider-specific code is the executor adapter that knows how to reach that provider's executor and the `provider` field it stamps on responses.

## 2.3 Responsibility and ownership

| Layer | Owns | Does not own |
| --- | --- | --- |
| Browser UI | Interaction state, rendering, polling | Provider secrets, model execution, durable authority, which provider answered |
| ToolHub backend | Admin authorization, chats, messages, questions, progress, context selection, provider attempt order | Either provider's CLI flags or credentials |
| Provider router (in ToolHub backend) | Attempt order, usage-exhaustion detection, the Redis pin and its TTL | The request/response contract itself, or either provider's execution |
| MongoDB | ToolHub application records | Gateway security state |
| Redis | The active-provider pin (cross-worker, TTL-bound), unrelated feature caches | Any durable record of what was asked or answered |
| Codex / Claude gateway | Client authentication, validation, audit status, provider adaptation | ToolHub users, full chat history, course domain logic, the other provider's gateway |
| Codex / Claude executor | CLI invocation, capability enforcement, timeout and event parsing | ToolHub REST API, application persistence, or the other provider's executor |
| Codex / Claude runtime | Model response and opaque thread state | ToolHub authorization |

The opaque `providerConversationId` crosses boundaries, but its meaning remains provider-specific — a Codex thread ID means nothing to Claude and vice versa. ToolHub stores it only as a continuation pointer, one per provider it has actually talked to for a given chat (6.3).

## 2.4 General assistant flow

1. An authenticated admin creates a ToolHub chat.
2. ToolHub stores the chat with `runStatus=idle`.
3. The admin sends a message. ToolHub atomically changes the chat to `running` and saves the user message as `pending`.
4. FastAPI returns HTTP `202 Accepted`; the browser is no longer tied to the long model request.
5. A background task asks the provider router for the attempt order (active pin, else Codex first) and sends a signed `read-only` request to the first provider's gateway, using that chat's stored thread ID for that specific provider if one exists.
6. The gateway adds the `ubuntu-purva` runtime snapshot.
7. The executor adds its host's snapshot (`hp-codex` or `hp-claude`) and starts or resumes the CLI session.
8. If that provider reports its usage allowance is exhausted, the router pins the app to the other provider (1.7) and retries the same request there instead of failing the message.
9. The final response, the provider that answered, and its thread ID return through the gateway.
10. ToolHub saves the assistant message (tagged with `provider`), stores the thread ID under that provider's key, marks the user message complete and returns the chat to `idle`.
11. The UI polls the chat and renders the saved answer.

## 2.5 Course question flow

Course questions go through the same router and the same per-provider gateways, but application behavior differs:

- ToolHub stores the course/module identity, question, optional selection, surrounding text, full module snapshot and content hash.
- A relevance selector fits the module outline and question-relevant blocks into the gateway’s context budget.
- The capability is `knowledge-only`.
- Each question is independently persisted as `pending`, `completed` or `failed`.
- The UI polls a question-specific endpoint and shows history in the module’s right panel.

Course progress never reaches the gateway. It is ordinary ToolHub state.

## 2.6 Trust boundaries

There are four authentication decisions, repeated independently for whichever provider is in play:

1. ToolHub authenticates the browser through HTTP-only session cookies.
2. `admin_user` requires the ToolHub role to be `ADMIN`.
3. The relevant gateway (Codex or Claude) authenticates ToolHub as an application client using HMAC, scopes and replay controls — via its own client registry and its own secret file, distinct from the other provider's.
4. The relevant executor independently authenticates its gateway using a different identity and secret again.

Compromising one application client secret does not directly reveal any executor secret, and does not reveal the equivalent secret for the other provider — the two provider stacks share a contract and a deployment pattern, not credentials. Compromising a browser session does not reveal any of these secrets because they never enter frontend code, and the browser never learns which provider is currently active beyond what the chat/message record shows after the fact.

## 2.7 Deployment topology

`ubuntu-purva` is production compute and hosts ToolHub, the Codex gateway, the Claude gateway and Redis. `hp-codex` and `hp-claude` are separate low-blast-radius management VMs, each hosting one provider's private executor and CLI — a compromise of one executor VM does not put the other provider's runtime at risk. The services bind to Tailscale addresses, not public VPS/Caddy ingress. The Proxmox host (`hp-purva`) does not run either provider.

> **HLD checkpoint**
> If MongoDB disappears temporarily, model execution and application persistence fail differently. Which component should report each failure, and which state must be recoverable after restart?
