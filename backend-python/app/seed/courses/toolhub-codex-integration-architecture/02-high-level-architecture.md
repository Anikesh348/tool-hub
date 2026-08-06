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
  | signed REST request over private network
  v
Codex gateway (ubuntu-purva, Tailscale listener)
  | separately signed executor request
  v
Codex executor (hp-codex, Tailscale listener)
  | fixed subprocess contract
  v
Codex CLI and authenticated Codex runtime
```

MongoDB sits beside the ToolHub backend and stores application state. SQLite beside the gateway stores request audit metadata and used nonces. A separate SQLite nonce store exists beside the executor. Codex itself owns its provider thread state under the authenticated Codex home.

## 2.2 Why gateway and executor are separate

The gateway is a reusable application boundary. It knows approved clients and the provider-neutral `/v1/responses` contract, but it does not launch a CLI. The executor is a provider-host boundary. It knows how to start Codex securely, but it does not know ToolHub users, courses or routes.

This gives two useful isolation properties:

1. A new ToolHub-like application can receive its own gateway identity without receiving access to the Codex VM.
2. A future Claude gateway/executor can implement the same application contract without moving ToolHub persistence or provider secrets into the browser.

## 2.3 Responsibility and ownership

| Layer | Owns | Does not own |
| --- | --- | --- |
| Browser UI | Interaction state, rendering, polling | Provider secrets, model execution, durable authority |
| ToolHub backend | Admin authorization, chats, messages, questions, progress, context selection | Codex CLI flags or provider credentials |
| MongoDB | ToolHub application records | Gateway security state |
| Codex gateway | Client authentication, validation, audit status, provider adaptation | ToolHub users, full chat history, course domain logic |
| Codex executor | CLI invocation, capability enforcement, timeout and event parsing | ToolHub REST API or application persistence |
| Codex runtime | Model response and opaque thread state | ToolHub authorization |

The opaque `providerConversationId` crosses boundaries, but its meaning remains provider-specific. ToolHub stores it only as a continuation pointer.

## 2.4 General assistant flow

1. An authenticated admin creates a ToolHub chat.
2. ToolHub stores the chat with `runStatus=idle`.
3. The admin sends a message. ToolHub atomically changes the chat to `running` and saves the user message as `pending`.
4. FastAPI returns HTTP `202 Accepted`; the browser is no longer tied to the long model request.
5. A background task sends a signed `read-only` request to the gateway.
6. The gateway adds the `ubuntu-purva` runtime snapshot.
7. The executor adds the `hp-codex` snapshot and starts or resumes `codex exec`.
8. The final response and provider thread ID return through the gateway.
9. ToolHub saves the assistant message, marks the user message complete and returns the chat to `idle`.
10. The UI polls the chat and renders the saved answer.

## 2.5 Course question flow

Course questions follow the same gateway, but application behavior differs:

- ToolHub stores the course/module identity, question, optional selection, surrounding text, full module snapshot and content hash.
- A relevance selector fits the module outline and question-relevant blocks into the gateway’s context budget.
- The capability is `knowledge-only`.
- Each question is independently persisted as `pending`, `completed` or `failed`.
- The UI polls a question-specific endpoint and shows history in the module’s right panel.

Course progress never reaches the gateway. It is ordinary ToolHub state.

## 2.6 Trust boundaries

There are four authentication decisions:

1. ToolHub authenticates the browser through HTTP-only session cookies.
2. `admin_user` requires the ToolHub role to be `ADMIN`.
3. The gateway authenticates ToolHub as an application client using HMAC, scopes and replay controls.
4. The executor independently authenticates the gateway using a different identity and secret.

Compromising one application client secret does not directly reveal the executor secret. Compromising a browser session does not reveal either secret because they never enter frontend code.

## 2.7 Deployment topology

`ubuntu-purva` is production compute and hosts ToolHub plus the reusable gateway. `hp-codex` is the low-blast-radius management VM and hosts the private executor and Codex CLI. The services bind to Tailscale addresses, not public VPS/Caddy ingress. The Proxmox host does not run Codex.

> **HLD checkpoint**
> If MongoDB disappears temporarily, model execution and application persistence fail differently. Which component should report each failure, and which state must be recoverable after restart?
