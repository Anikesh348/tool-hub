> **Learning goal**
> Review the provider-neutral REST contract and the concrete authentication protocol used on both private hops.

## 3.1 Application contract

The gateway exposes one response route:

```http
POST /v1/responses
```

The request contains:

```json
{
  "input": "Explain NFS identity.",
  "conversation": {"providerConversationId": null},
  "context": [
    {"type": "text", "label": "Lesson context", "text": "UID and GID..."}
  ],
  "capabilityProfile": "knowledge-only",
  "metadata": {"application": "toolhub-courses"}
}
```

The successful response normalizes provider output:

```json
{
  "id": "request-uuid",
  "provider": "codex",
  "status": "completed",
  "outputText": "...",
  "conversation": {"providerConversationId": "opaque-id"}
}
```

Only text context exists in v1. Metadata is correlation data and never grants permissions.

## 3.2 HMAC authentication

Every route except private liveness requires four headers:

```text
X-AI-Client-Id
X-AI-Timestamp
X-AI-Nonce
X-AI-Signature
```

The sender computes SHA-256 over the exact body, builds a canonical message and signs it with HMAC-SHA256:

```text
METHOD
PATH_WITH_QUERY
CLIENT_ID
TIMESTAMP
NONCE
SHA256_BODY_HEX
```

Because the method, path and body digest are signed, an intermediary cannot change a knowledge request into another operation or alter context without invalidating the signature.

## 3.3 Authentication checks

The verifier checks, in order:

1. All headers are present.
2. The client ID exists in the registry.
3. The client has the required scope.
4. The source IP belongs to an optional allowed CIDR.
5. The nonce length is valid.
6. The timestamp is within the configured clock-skew window.
7. The HMAC matches using constant-time comparison.
8. The `(client_id, nonce)` pair has not already been claimed.

The nonce is stored in SQLite with an expiry. A copied, perfectly signed request therefore fails with HTTP `409` when replayed.

## 3.4 Scopes and identities

ToolHub is registered at the gateway with scopes such as:

```text
gateway:read
responses:create
```

The gateway has a separate identity at the executor:

```text
executor:read
executor:invoke
```

Each registry entry points to a secret file and may restrict source addresses. Secrets are generated during deployment, mounted read-only where needed and never committed.

## 3.5 Input limits

| Boundary | Default limit |
| --- | --- |
| Gateway HTTP body | 65,536 bytes |
| Gateway user input | 16,000 characters |
| Gateway text context | 8,000 characters |
| Executor prompt | 24,000 characters |
| Executor response | 64,000 characters |
| Gateway-to-executor timeout | 310 seconds |
| Codex CLI timeout | 300 seconds |
| Authentication clock skew | 60 seconds |

Limits prevent accidental or hostile unbounded requests and keep the composed prompt below the executor boundary.

## 3.6 Health and error contract

`GET /healthz` is an unauthenticated process-liveness check, but it exists only on a private listener. `GET /readyz` requires a read scope and confirms configuration readiness without invoking the model.

Errors have stable machine codes:

```json
{"error":{"code":"gateway_busy","message":"Codex gateway is busy"}}
```

Expected statuses include `400`, `401`, `404`, `409`, `413`, `429` and `503`. Provider stderr, prompts, secrets and hidden runtime output are not returned.

## 3.7 Threat review

| Threat | Control |
| --- | --- |
| Browser steals gateway key | Key never reaches browser |
| Request tampering | Body digest and HMAC |
| Captured request replay | Timestamp window and nonce store |
| Client calls unapproved route | Per-route scopes |
| Client originates elsewhere | Optional CIDR allowlist and private network |
| Prompt asks to bypass policy | Fixed executor configuration and disabled tools |
| Oversized payload exhausts service | Body, input, context and response limits |
| Concurrent runs exhaust small VM | Single bounded run slot |

> **Security checkpoint**
> HMAC proves which application signed a request. Why does it not replace ToolHub’s admin authorization or the executor capability sandbox?
