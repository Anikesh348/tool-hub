> **Learning goal**
> Read a second, independent ToolHub feature built on the exact same Codex/Claude gateway and provider router, and see which platform guarantees from lessons 1–7 held without change, and which the feature had to earn on its own.

## 8.1 Why a second feature, and why it stayed separate

The LeetCode tracker (`backend-python/app/routes/leetcode_routes.py`, `.../services/leetcode.py`) is a personal coding-practice tool: track problems, tag them, mark them solved, keep notes. On 2026-08-07 it gained a floating AI chat bubble that can explain a problem, produce a solution, or curate and add a batch of new problems straight into the tracker.

It could have been bolted onto the existing central AI Assistant (`ai_chats.py` / `AIChat.tsx`, 6.3). It wasn't. `leetcode_ai.py` and `LeetcodeAIBubble.tsx` are new, self-contained modules with their own Mongo collections, their own routes, and their own frontend component — deliberately duplicating the chat-persistence shape from 6.3 instead of importing it. The reasoning: the central assistant was already working in production, and coupling a new, less-proven feature to it risks regressing something that didn't need to change. Isolation here isn't about protecting LeetCode data from the assistant — it's about protecting the assistant from LeetCode.

What is *not* duplicated is the platform underneath both: `ai_gateway.py`, `ai_provider_router.py`, the Codex/Claude gateways, and the executors on `hp-codex`/`hp-claude` are exactly the same instances handling both features. That is the point of this lesson — it is evidence for the reuse claim made in 6.8, not just an assertion of it.

## 8.2 Data model

Two new collections, parallel to `ai_chats`/`ai_messages` (6.3) but namespaced:

| Collection | Purpose |
| --- | --- |
| `leetcode_ai_chats` | Owner, title, `runStatus` (`idle`/`running`), `providerConversationIds` map, timestamps |
| `leetcode_ai_messages` | `chatId`, role, content, `status` (`completed`/`failed`), `addedCollection`, timestamps |

`providerConversationIds` uses the same map-from-provider-to-thread-id shape the central assistant uses (6.3) — a chat can hold a live Codex thread and a live Claude thread if a failover happened mid-conversation. There's no legacy single-`provider` field to migrate here, since this feature was built after the dual-provider router already existed.

`ensure_leetcode_ai_indexes()` resets any chat left with `runStatus="running"` back to `idle` at startup — the same recovery behavior lesson 6.4 describes for `ai_chats`, reapplied independently rather than shared, because sharing would mean importing code from the module this feature is explicitly avoiding coupling to.

## 8.3 Request lifecycle: atomic start, then a private executor

Routes (`leetcode_ai_routes.py`) are thin — `create_chat`, `list_chats`, `get_chat`, and `POST .../messages` which returns `202`:

```text
POST   /v2/leetcode/ai/chats
GET    /v2/leetcode/ai/chats
GET    /v2/leetcode/ai/chats/{chat_id}
POST   /v2/leetcode/ai/chats/{chat_id}/messages   -> 202 Accepted
```

`begin_message` uses the same atomic pattern as 6.4: `find_one_and_update({"id": ..., "ownerId": ..., "runStatus": "idle"}, {"$set": {"runStatus": "running"}})`. If nothing matches because the chat is already running, the caller gets `409`, not a queued duplicate reply. The user's message is inserted before any AI call happens, so it's durable even if the reply never comes back.

Where this feature diverges from 6.4: `ai_chats.py` and `courses.py` hand their long-running work to FastAPI's `BackgroundTasks.add_task`, which runs on Starlette's shared thread pool. `leetcode_ai.py` instead keeps its own `ThreadPoolExecutor(max_workers=4, thread_name_prefix="leetcode-ai")` and submits directly to it. Functionally both approaches get a request off the response path; the dedicated pool is one further step of the same isolation principle from 8.1 — a slow or stuck LeetCode AI reply can't exhaust capacity that `/v2/token/refresh` or the central assistant's own background replies depend on, and vice versa.

## 8.4 The gateway call

`complete_message` builds context and calls the platform exactly the way 6.2a describes for `ai_chats`/`courses`:

```python
provider, response = routed_gateway_request(
    "POST", "/v1/responses",
    payload_for_provider=lambda target: {
        "input": clean_content,
        "conversation": {"providerConversationId": conversation_ids.get(target) or None},
        "context": context,
        "capabilityProfile": "knowledge-only",
        "metadata": {"application": "toolhub-leetcode", "chatId": chat_id},
    },
    timeout=90,
)
```

Same `routed_gateway_request` function, same router, same Redis-pinned failover behavior (1.7, 4.8) — `ai_provider_router.py` has no idea this caller is different from the central assistant. `capabilityProfile: "knowledge-only"` is the correct choice per 1.5/1.6: this feature explains algorithms and proposes problem slugs from model knowledge plus supplied context, never touches infrastructure, so it needs nothing `read-only` or `operator` provide. The `metadata.application` tag (`"toolhub-leetcode"` vs. the central assistant's or course's own tag) is what lets a gateway audit record be attributed to the right feature after the fact, without the gateway needing to understand what either feature is.

A failed gateway call (`AIGatewayError`) is handled exactly like 6.4 describes: insert a `failed` assistant message, flip the chat back to `idle`, don't leave it stuck.

## 8.5 Two response shapes from one prompt

`SYSTEM_PROMPT` asks the model to do one of two things depending on intent:

- Answer normally, in markdown prose, for anything that isn't a request for a curated list.
- For a request like *"generate 5 medium graph questions likely asked at Google"*, reply with **only** a fenced ```json block: `{"collectionTitle": "...", "questions": [{"slug": "...", "reason": "..."}]}` — no prose before or after.

`_extract_collection_payload` pulls the JSON out with a regex, falling back to treating the whole trimmed reply as JSON if it isn't fenced, and returns `None` (falling through to plain prose handling) if neither parses. Nothing about this contract lives in the gateway or executor — it's pure application-layer prompt engineering, same as the course's own context-window shaping in 6.6.

## 8.6 Turning a proposed slug into a real, non-duplicate question

A model proposing a slug is not the same as that slug being real or new. `_resolve_collection` treats every proposed slug as untrusted:

1. **Re-resolve against LeetCode itself.** `fetch_question_metadata` (`leetcode_metadata.py`) calls LeetCode's public GraphQL endpoint (`getQuestionDetail`) for title, difficulty, tags and acceptance rate — the same function the manual "add by URL" flow (`leetcode.py::add_questions`) uses, so a hallucinated or misspelled slug is dropped rather than stored with blank metadata. This function is a Python port of the old Java backend's `FetchLeetCodeMetaData` service; when the tracker was rewritten from Java/Vert.x, this GraphQL enrichment step was initially dropped, which silently degraded newly-added questions (blank titles, no tags) until it was ported back — worth knowing if older-looking rows are ever seen without tags.
2. **Dedupe against what's already tracked**, by resolved canonical URL, and cap at `MAX_QUESTIONS_PER_COLLECTION = 10` regardless of how many the model returned.
3. **Insert survivors** into the same `leetcode` collection manual adds use, tagged with a `collectionLabel` (the model's `collectionTitle`) so the frontend can show them as their own pill (8.9) instead of mixing them silently into a topic.

## 8.7 Telling the model what's already tracked

Re-resolving slugs stops hallucinated problems, but it doesn't stop the model from confidently proposing five *real, already-tracked* problems — which then dedupe to zero net adds. `_tracked_questions_context` fixes this by listing everything the user already has (`slug (title)`) as an explicit "never propose these again" context block, capped at `MAX_TRACKED_CONTEXT_CHARS = 5500` characters (truncated with a trailing `...(list truncated)` marker past that).

That cap isn't arbitrary: 6.6 established that the gateway rejects requests once combined context passes roughly 8,000 characters (`ai_chats.py`'s own `MAX_CONTEXT = 8000`). `SYSTEM_PROMPT` alone is already ~1,500 characters, so 5,500 leaves real margin rather than assuming the two budgets will never collide. Before this context block existed, testing found 5 of 5 proposed slugs for a topic were already in the tracker — the model has no other way to know what a given user has already added.

## 8.8 The public-path timeout this feature ran into

This feature was originally shipped as a synchronous request/reply — one HTTP call held open for the whole AI turn. In production it intermittently "timed out" from the browser's point of view, and reloading the page mid-request would occasionally also break the user's login session. Two real but incomplete fixes shipped first (moving the AI call off Starlette's shared executor; loosening the frontend's session-check abort timeout from 10s to 20s with a retry-once path). Neither was the root cause.

The actual path traffic takes is not `browser → nginx`, it's `browser → Caddy edge VPS → WireGuard tunnel → nginx → backend`. Every earlier test had been run from inside the WireGuard network and never crossed the Caddy edge hop — the hop that was actually closing the connection on a held-open 5–45s request. That's a restatement, from the outside, of exactly why 6.4 requires `202` + background task + poll for `ai_chats` and `courses`: **no single request in this feature's lifecycle is ever held open longer than a fast Mongo read or write.** `leetcode_ai_routes.py`'s `202` response, and `LeetcodeAIBubble.tsx`'s 1-second poll loop (8.9), are the fix — the same shape 6.4 already used, arrived at independently for this feature after the synchronous version broke in a way local testing couldn't reproduce.

## 8.9 Frontend: scoped, polling, and honest about wait time

`LeetcodeAIBubble.tsx` renders only on the LeetCode page (`Leetcode.tsx` mounts it directly), not globally like the central assistant's panel — another instance of 8.1's isolation choice, this time in the UI layer. It remembers the active chat per browser via `localStorage` (`leetcode-ai-active-chat-id`), sends the user's message, then polls `GET .../chats/{id}` once a second (mirroring `AIChat.tsx`'s `waitForAssistant`, per 6.7) until `runStatus` returns to `idle`, with a 120-second client-side giveup.

One addition beyond the course reader's polling UI: a running counter (`Thinking (Ns)`) instead of a static spinner, plus a hint after 8 seconds that longer requests can take up to a minute. This exists specifically because an indefinite-looking spinner was what tempted users to reload the page mid-request in the first place — the behavior that, before the 20s session-check fix in 8.8, could intermittently force a logout. Making wait time visible is a UX fix for a reliability problem, not a cosmetic one.

When a reply carries an `addedCollection` with `count > 0`, the message renders a "View in tracker" affordance; clicking it calls `onViewCollection(label)`, which `Leetcode.tsx` wires to `setSelectedCollection`, reusing the exact same topic-pill filtering state a manually-tracked topic uses (a collection is filtered by `collectionLabel` the same way a topic is filtered by `tags`, per `leetcode.py::get_questions`). AI-curated batches aren't a separate concept in the UI, just another pill.

## 8.10 What this proves about the platform

Nothing in `ai_gateway.py`, `ai_provider_router.py`, either gateway process, or either executor changed to support this feature. It reused:

- the signed provider-neutral request contract (3.x),
- the `routed_gateway_request` failover behavior and Redis pinning (4.8, 6.2a),
- the `knowledge-only` capability boundary (1.5–1.6),
- the `202` + background task + poll pattern for holding no request open across the public path (6.4, 8.8).

What it didn't reuse — chat persistence code, the executor pool, the frontend chat component — it deliberately rebuilt in parallel rather than shared, trading a small amount of duplication for a guarantee that a bug in one feature's background-task or polling logic can't touch the other's. That's the same trade-off 6.8 makes for gateway/application separation, applied one layer higher: between two applications, not just between an application and the gateway.

> **Reuse checkpoint**
> If a third ToolHub feature needed the same `knowledge-only` chat pattern tomorrow, list exactly what it would import versus rebuild, using this lesson's choices as the precedent. Then ask the harder question: is duplicating the chat-persistence and polling code across three features still the right trade-off, or does isolation stop paying for itself past two?
