> **Learning goal**
> Walk through the reusable gateway’s internal request lifecycle and persistence model, then trace how the ToolHub backend chooses which gateway to call.

Everything in 4.1–4.6 describes the Codex gateway process by name, but since 2026-08-05 it is one of two live instances of the same design: the Claude gateway (`claude-gateway.service`, `ubuntu-purva:8767`, user `claudegateway`) is built from the same server class, the same request lifecycle, the same SQLite audit/nonce schema and the same shared protocol modules — only its executor adapter and startup settings differ. Read this lesson as “how a provider gateway works,” with Codex as the concrete example, and see 4.8 for the router that decides which one gets called.

## 4.1 Process structure

The gateway is a small Python HTTP service built on `ThreadingHTTPServer`. It runs as the dedicated `codexgateway` system user on `ubuntu-purva` (the Claude gateway runs the identical server class as `claudegateway`). Threads allow health/auth work to proceed independently, while a bounded semaphore intentionally permits only one provider run.

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

HMAC, scopes, request schema and application response shape are provider-neutral — literally so, not just by convention: both gateways import `verify_request`, `NonceStore` and `runtime_snapshot` from the same `ai_gateway_protocol.py` / `runtime_snapshot.py` files, each vendored byte-for-byte into that gateway's own `shared/` directory rather than loaded from one central install. `ExecutorClient` and the returned `provider` field (`"codex"` or `"claude"`) are the only genuinely provider-specific pieces — each gateway's adapter knows its own executor's URL, its own executor secret, and stamps its own provider name on the response.

The current architecture chooses one gateway per provider rather than one large gateway loading every provider credential. That keeps failures, secrets and runtime behavior isolated: an outage or a compromised secret on the Codex side cannot touch the Claude gateway process, its SQLite files, or its executor.

## 4.8 Provider router: choosing which gateway to call

The gateway itself has no opinion about failover — it only knows how to serve `/v1/responses` for its one provider. The decision of *which* gateway to call for a given ToolHub request lives one layer up, in the ToolHub backend's `ai_provider_router.py`, and it wraps `gateway_request` (4.4's client-side counterpart) with `routed_gateway_request`:

```text
routed_gateway_request(method, path, payload_for_provider, timeout):
  order = attempt_order()          # [active-or-preferred, ...configured others]
  for provider in order:
      try:
          result = gateway_request(method, path, payload_for_provider(provider), provider=provider)
      except AIGatewayError as exc:
          if not is_usage_exhausted(exc):
              raise                # genuine outages stay visible, no silent fallback
          continue                 # try the next provider
      pin_provider(provider)       # remember the winner in Redis for DEFAULT_ACTIVE_TTL_SECONDS (1 day)
      return provider, result
  release_provider()               # everything exhausted: stop pinning a dead provider
  raise last_error
```

`attempt_order()` reads the Redis-stored pin (falling back to Codex, the `PREFERRED_PROVIDER`, if unset or unrecognized) and appends whichever configured providers aren't already first, filtered through `provider_configured()` so an unconfigured Claude deployment is simply skipped rather than attempted and failed. `pin_provider()` uses Redis `SET ... NX` (`cache_add`) so it only *sets* a pin when releasing back to the preferred provider isn't the case, and never silently extends an existing pin on every request — a pin lasts its original TTL, not a TTL that resets on each successful Claude call, so the system periodically re-tries Codex rather than staying on the fallback forever.

Two things make this safe against surprises: `payload_for_provider` is a callable, not a fixed payload, because a request that fails over needs a *different* conversation ID (the target provider's own thread, not the one that just failed) — see 6.3. And `is_usage_exhausted` is a narrow classifier (3.6), so a busy gateway or a genuine network outage propagates as a normal error instead of quietly rerouting traffic.

> **LLD exercise**
> Trace where a reused nonce, oversized context, busy executor and missing provider thread ID each fail. Note which failures create or update a gateway audit record. Then trace a Codex usage-exhaustion error through `routed_gateway_request`: which Redis key changes, and what does the *next* unrelated request from a different admin see?
