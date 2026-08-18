> **Learning goal**
> See every live ToolHub feature that calls a private AI gateway, which capability profile it uses, and how a new feature is added without a plugin registry.

Lesson 6 showed the first ToolHub applications (assistant and course Q&A). Lesson 8 showed a second product (LeetCode AI) reusing the same gateway. This lesson is the inventory as of **19 August 2026**: what actually calls `routed_gateway_request`, what uses the separate operator pair, and what is deliberately *not* registered as a gateway application.

## 9.1 There is no plugin registry

Nothing in ToolHub looks up “AI features” from a table of plugins. A feature is “registered” when all of the following exist:

1. A dedicated Python service module (own Mongo collections, own request lifecycle).
2. FastAPI routes under `/v2/...` that the browser may call.
3. One call to `routed_gateway_request` (or, for confirmed smart jobs, `run_operator_prompt`) with an explicit `capabilityProfile`.
4. `metadata.application` on the gateway payload so audit and debugging can name the caller.
5. A frontend that submits work, then **polls** — it never holds an HTTP request open across the public Caddy/WireGuard path (6.4, 8.8).

The gateway client identity stays `toolhub-admin` for every `knowledge-only` / `read-only` call. Adding a feature does not add a new HMAC client. Adding **operator** work uses a different client (`scheduler`) and different ports; that is the exception, not the pattern.

## 9.2 Who calls which profile

All of the following go through `ai_provider_router.routed_gateway_request` → Codex/Claude **application** gateways (`:8765` / `:8767`), unless noted.

| Feature | Module | Routes (representative) | Profile | Why this profile |
| --- | --- | --- | --- | --- |
| AI Assistant | `ai_chats.py` | `/v2/admin/ai/*` | `read-only` | General questions, public web search, trusted host snapshots |
| Course Q&A | `courses.py` | `/v2/admin/courses/.../questions` | `knowledge-only` | Lesson text is supplied as context; tools would not help |
| LeetCode chat | `leetcode_ai.py` | `/v2/leetcode/ai/chats` | `knowledge-only` | Propose/discuss problems from model knowledge + tracker context |
| LeetCode set wizard | `leetcode_set_wizard.py` | `/v2/leetcode/ai/sets/generate` | `knowledge-only` | One-shot set generation, isolated from the chat collections |
| MovieHub chat | `moviehub_chat_routes.py` | MovieHub chat routes | `knowledge-only` | LLM is a **fallback**, not the default catalog path |
| Scheduler AI bubble | `scheduler_ai.py` | `/v2/admin/scheduler-ai/chats` | `read-only` | May need live/web context to **draft** a job spec; must not fire the job |
| Smart scheduled job **run** | `user_scheduler.py` → `operator_gateway.py` | job tick after **explicit confirm** | `operator` | Unattended shell on the **operator** gateway pair (`:8770` / `:8772`), not the chat gateways |

Two profiles still never appear on the assistant or course paths: the chat contract cannot request `operator`. Creating a “smart” job is a separate confirm step in `user_scheduler.create_job` precisely because the later tick uses full operator access.

## 9.3 How each feature shapes the same `/v1/responses` call

The wire format is shared (Lesson 3). The **application** decides:

- **`capabilityProfile`** — security ceiling for that turn.
- **`context`** — extra labeled text (module excerpts, tracked LeetCode slugs, scheduler instructions).
- **`conversation.providerConversationId`** — looked up **per provider**, because failover must not send a Codex thread id to Claude (6.3). Features that are one-shot (course questions, set wizard) pass `null` and start a fresh thread.
- **`metadata.application`** — `toolhub`, `toolhub-courses`, `toolhub-leetcode`, `toolhub-scheduler`, and so on.
- **Timeout** — assistant/courses use ~330s on the background task; LeetCode and scheduler chats use ~90s. The HTTP route still returns `202` immediately.

MovieHub is the odd one pedagogically: most questions never reach a model. The LLM path is the fallback when deterministic catalog logic cannot answer. That is still a first-class gateway application; it is just not “chat-first.”

## 9.4 Scheduler AI versus operator jobs — do not collapse these

`scheduler_ai.py` and `user_scheduler.py` sit on the same admin page and are easy to confuse.

- The **bubble** is a `read-only` chat. It can propose JSON for a job. It cannot create the job by talking. Confirm is a distinct API call.
- A **script** job (`price_check`, `flight_check`, `http_ping`, …) runs an allowlisted Python handler inside ToolHub. No gateway.
- A **smart** job stores a prompt. When the cron fires, `run_operator_prompt` sends that prompt with `capabilityProfile: "operator"` to the operator gateways. That is the same privileged pair opsched uses (7.6a), now also reachable from ToolHub **after** an admin confirmed the job.

Lesson 1.5’s original wording — “ToolHub’s application contract never requests `operator`” — remains true for **chat**. It is no longer true for **confirmed smart jobs**. The boundary moved from “ToolHub cannot reach operator” to “chat cannot reach operator; a confirmed job can.”

## 9.5 Provider routing these features all share

`PREFERRED_PROVIDER` in live `ai_provider_router.py` is **Claude**; **Codex** is the fallback. Usage exhaustion pins `ai:active-provider` in Redis (default one day). `gateway_busy` / `executor_busy` do not pin (1.7).

Every row in 9.2 that uses `routed_gateway_request` therefore follows that pin. Operator jobs use `operator_gateway.py` and a separate attempt order; they must not be mixed into `/v2/admin/ai/health`’s `SUPPORTED_PROVIDERS` list (`ai_gateway.py` keeps operator providers out of that tuple on purpose).

## 9.6 What this course still does not claim

Home Assistant’s Alexa “Safeguard / Shield” switches are **not** a gateway application. They call ToolHub’s `/v2/alexa/actions` ingest to arm a helper; they do not send utterances to Codex or Claude. A spoken Q&A skill remains a future adapter on this same router, not a new provider gateway.

> **Review question**
> A new ToolHub page wants “ask the homelab a question.” Which profile do you pick, which module do you *not* import, and which existing feature is the closest template? Justify why you would copy `leetcode_ai.py`’s isolation rather than adding a flag to `ai_chats.py`.
