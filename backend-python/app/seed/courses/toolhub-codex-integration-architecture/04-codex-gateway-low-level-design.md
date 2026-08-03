> **Learning goal**
> Walk through the reusable gateway’s internal request lifecycle and persistence model.

## 4.1 Process structure

The gateway is a small Python HTTP service built on `ThreadingHTTPServer`. It runs as the dedicated `codexgateway` system user on `ubuntu-purva`. Threads allow health/auth work to proceed independently, while a bounded semaphore intentionally permits only one provider run.

At startup the server constructs:

- immutable environment-derived settings;
- a client registry loaded from secret-file references;
- a SQLite-backed nonce store;
- a SQLite-backed audit store;
- an executor HTTP client;
- a one-slot run semaphore.

It then binds to the private Tailscale address and serves requests until systemd stops it.

## 4.2 Request lifecycle

For each request, the handler:

1. Accepts or creates an `X-Request-Id`.
2. Reads `Content-Length` and rejects bodies above the configured limit.
3. Matches the method and route.
4. Verifies HMAC authentication and claims the nonce.
5. Parses a JSON object.
6. Validates input, capability, conversation and text context.
7. Adds the `ubuntu-purva` snapshot for `read-only` requests.
8. Assembles labeled context sections followed by `[User request]`.
9. Attempts to acquire the single run slot; otherwise returns `429 gateway_busy`.
10. Writes an audit record with status `running`.
11. Calls the executor through a separately signed request.
12. Validates that both final output and provider conversation ID exist.
13. Marks the audit record completed or failed.
14. Releases the run slot in `finally`, including error paths.

## 4.3 Prompt assembly

The gateway treats context as data with labels:

```text
[Course]
ToolHub–Codex Integration Architecture

[Relevant module lesson context]
...

[User request]
Why is the executor separate?
```

This is not a security boundary by itself—the executor’s fixed policy is—but clear labeling reduces ambiguity and makes application-supplied context understandable to the model.

For `read-only`, the gateway appends:

```text
[Trusted live read-only snapshot: ubuntu-purva]
captured_at_utc=...
cpu_usage_percent=...
...
```

The snapshot generator reads `/proc`, filesystem usage, uptime/load and `systemctl --failed`. It has no generic command parameter supplied by the user.

## 4.4 Executor adapter

The gateway translates `/v1/responses` into the private executor contract:

```json
{
  "input": "assembled prompt",
  "providerConversationId": "optional-thread",
  "capabilityProfile": "read-only"
}
```

It signs `/v1/execute` with the gateway’s executor identity, a fresh nonce and the same correlation request ID. HTTP/provider failures become controlled `ExecutorError` values. Only safe status codes and messages cross back to clients.

## 4.5 Audit storage

The `gateway_requests` SQLite table stores:

```text
request_id
client_id
provider
capability_profile
status
error_code
started_at
completed_at
```

It deliberately does not store prompts, context, answers or ToolHub user IDs. Application history belongs in ToolHub. The gateway audit answers operational questions such as “did client X receive a provider timeout?” without becoming a second sensitive chat database.

SQLite uses WAL mode, an in-process lock and a busy timeout. The nonce table similarly stores only client, nonce and expiry.

## 4.6 Concurrency and backpressure

There is one run slot in both gateway and executor. This matches `hp-codex`’s small resource envelope and prevents several heavyweight CLI processes from competing for 2 vCPU and limited memory.

The trade-off is explicit: concurrent callers receive `429` rather than queueing. ToolHub persists a pending application record before the request, so it can show a clear failure or retry path instead of losing the user’s submission.

## 4.7 Provider-neutral versus provider-specific code

HMAC, scopes, request schema and application response shape are provider-neutral. `ExecutorClient` and the returned `provider="codex"` are Codex-specific. A Claude gateway can reuse the contract and protocol while adapting to a separate Claude executor.

The current architecture chooses one gateway per provider rather than one large gateway loading every provider credential. That keeps failures, secrets and runtime behavior isolated.

> **LLD exercise**
> Trace where a reused nonce, oversized context, busy executor and missing provider thread ID each fail. Note which failures create or update a gateway audit record.
