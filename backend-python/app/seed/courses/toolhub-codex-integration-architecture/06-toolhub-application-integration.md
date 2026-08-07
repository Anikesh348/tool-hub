> **Learning goal**
> Review ToolHub’s backend/frontend design, durable state and contextual course integration.

## 6.1 Browser boundary

The React frontend calls only ToolHub routes under `/api`. It knows nothing about Tailscale addresses, gateway client IDs, HMAC signing, which provider VM answered, or that a provider router exists at all. HTTP-only cookies carry the ToolHub session.

Routes under `/v2/admin/ai/*` and `/v2/admin/courses/*` depend on `admin_user`. Missing authentication returns `401`; an authenticated non-admin receives `403`.

## 6.2 Gateway client inside FastAPI

`ai_gateway.py` now models a provider as a `GatewayEndpoint`, and every gateway call goes through `_endpoint(provider)` to pick the right one:

```text
# Codex
AI_CODEX_GATEWAY_URL
AI_GATEWAY_CLIENT_ID
AI_GATEWAY_SECRET_FILE            (defaults to /run/secrets/ai_gateway_client_secret)

# Claude
AI_CLAUDE_GATEWAY_URL
AI_CLAUDE_GATEWAY_CLIENT_ID       (defaults to AI_GATEWAY_CLIENT_ID if unset)
AI_CLAUDE_GATEWAY_SECRET_FILE     (defaults to /run/secrets/ai_claude_gateway_client_secret)
```

`provider_configured(provider)` reports whether a provider is actually usable — URL and client id present, and the mounted secret file at least 32 characters — so a deployment that hasn't rolled out Claude yet degrades to Codex-only rather than the router trying and failing against an empty configuration on every request.

For each request `gateway_request(method, path, payload, provider=...)` serializes compact JSON, creates a timestamp and random nonce, signs the canonical request against that provider's endpoint, adds a correlation ID and calls that provider's gateway. The secret is read from that provider's mounted file and never returned through an API.

Gateway errors are converted to application-safe `AIGatewayError` values with selected statuses, still carrying which `provider` raised them. An invalid/non-JSON response becomes a controlled gateway-unavailable error. Nothing in this module decides *which* provider to call, or reacts to usage exhaustion — that is `ai_provider_router.py`'s job, one layer up (4.8, 6.2a).

### 6.2a Provider routing from the application's point of view

`ai_chats.py` (central assistant) and `courses.py` (course questions) never call `gateway_request` directly — they call `routed_gateway_request` from `ai_provider_router.py`, which returns `(provider, response)` instead of just `response`. That returned `provider` is what gets persisted (6.3) and what a caller of `/v2/admin/ai/health` sees under `routing.active`. The router itself is described in full in 1.7 and 4.8; the two things worth repeating in an application context are:

- a chat's or question's stored conversation state must be looked up **per provider it has actually used**, not assumed to be Codex, because `payload_for_provider` needs to hand the router the *right* thread ID for whichever provider it is about to try;
- `GET /v2/admin/ai/health` checks `SUPPORTED_PROVIDERS` individually (calling each configured gateway's `/readyz`), then reports the active provider, a per-provider status map, and the router's own state (`routing`: active/preferred/fallback/pinnedForSeconds/configured) — so an admin can see *both* “is Claude currently reachable” and “is ToolHub currently routing to it” as separate facts.

## 6.3 Chat persistence model

MongoDB uses `ai_chats` and `ai_messages`.

An AI chat stores owner, title, status, run status and timestamps. Where a chat used to store one `providerConversationId`, it now stores **`providerConversationIds`, a map from provider name to that provider's opaque thread id** — because a single chat can legitimately hold a live Codex thread and a live Claude thread at once if it failed over partway through. `_conversation_ids(chat)` reads this map and transparently upgrades any chat still holding the old single-field shape (reading `chat["provider"]`, defaulting to Codex, and treating the legacy value as that provider's entry) — existing chats created before 2026-08-05 keep working without a migration script. Messages store chat ID, role, content, optional context, status and timestamps. Assistant messages also store the gateway request ID and now a **`provider`** field recording which provider actually produced that specific answer — two assistant messages in the same chat can legitimately show different providers if a failover happened between them.

The owner ID appears in every chat lookup. Knowing another chat UUID is insufficient to retrieve it.

## 6.4 Atomic message start

To start work, ToolHub uses `find_one_and_update` with the condition `runStatus=idle`. The winner changes it to `running`; another simultaneous request receives `409`. ToolHub then inserts the user message as `pending`.

FastAPI returns `202 Accepted` and schedules the long operation as a background task. This is the crucial stability behavior: Nginx/browser timeouts do not hold every ToolHub API request open while a provider thinks — and it matters even more now, since a failover attempt means the background task may make two full gateway round trips (a failed Codex attempt, then a successful Claude one) before it resolves.

On success, ToolHub inserts the assistant message (tagged with whichever `provider` answered), completes the user message, saves that provider's thread id into `providerConversationIds` and returns the chat to idle. On failure it marks the user message failed and also unlocks the chat.

At backend startup, any chat left with `runStatus=running` is reset to idle. Persisted messages remain available after container restart.

## 6.5 Course data model

The course feature uses:

| Collection | Records |
| --- | --- |
| `courses` | Published course metadata |
| `course_modules` | Ordered Markdown lessons and content hashes |
| `course_progress` | Owner-scoped reading percentage and completion |
| `course_questions` | Question, optional selection, module snapshot, answer and status |

Seed Markdown is loaded at backend startup. Upserts preserve stable course/module IDs and existing user progress.

## 6.6 Course context retrieval

A course question persists the complete module snapshot and its hash. The gateway accepts only about 8,000 context characters, while a module may exceed 25,000. ToolHub therefore builds a bounded context rather than sending a random truncation.

The selector:

1. Splits Markdown into blocks.
2. Extracts meaningful terms from the question.
3. Builds the module outline from headings.
4. Scores blocks by term occurrence, with headings retained as navigational context.
5. Adds the best blocks until the budget is full.
6. Reserves additional budget for highlighted text and its surrounding passage.

The AI request uses `knowledge-only`, labels the context clearly and asks for a beginner-friendly answer. Highlighting is optional; without it, the open module still supplies context.

Course questions route through `routed_gateway_request` the same as central-chat messages (6.2a), so a course explanation can also fail over from Codex to Claude. Unlike chat messages, a course question always starts a fresh `providerConversationId: null` thread regardless of provider (3.1) — course Q&A is stateless per question, so there is no provider-scoped thread map to maintain here.

## 6.7 Course reader frontend

The reader provides module navigation, rendered GitHub-flavored Markdown, reading progress, completion controls and a collapsible right AI panel.

When text is highlighted, the browser verifies that the selection belongs to the lesson element, captures up to 4,000 characters and derives bounded before/after context. Without selection, the same textarea asks about the module generally.

The UI immediately displays the persisted pending question and polls its ID every two seconds. Completed answers render as Markdown. Reopening the module loads question history from MongoDB.

## 6.8 Why application context stays in ToolHub

The gateway should not understand course IDs, scroll progress or ToolHub roles. Keeping domain context in ToolHub means:

- another application can use the same gateway contract;
- course access control stays with the owner of the course data;
- provider migration does not rewrite the course UI;
- gateway audit storage remains small and less sensitive.

The same principle now extends to provider choice: the failover decision (1.7, 4.8) lives entirely inside the ToolHub backend's `ai_provider_router`, reading a Redis key it owns. Neither gateway, neither executor, nor the course UI needs to know a fallback policy exists — only that "call the gateway, get an answer" can now, transparently, mean two attempts against two different services.

> **Application checkpoint**
> Compare the durable status transitions for a central-chat message and a course question. What recovery behavior is possible because ToolHub writes `pending` before invoking a provider? Now extend the comparison: if Codex fails over to Claude midway through a chat message's background task, which MongoDB fields change, and which stay exactly as they would have without a failover?
