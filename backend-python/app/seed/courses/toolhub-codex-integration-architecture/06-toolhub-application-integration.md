> **Learning goal**
> Review ToolHub’s backend/frontend design, durable state and contextual course integration.

## 6.1 Browser boundary

The React frontend calls only ToolHub routes under `/api`. It knows nothing about Tailscale addresses, gateway client IDs, HMAC signing or the Codex VM. HTTP-only cookies carry the ToolHub session.

Routes under `/v2/admin/ai/*` and `/v2/admin/courses/*` depend on `admin_user`. Missing authentication returns `401`; an authenticated non-admin receives `403`.

## 6.2 Gateway client inside FastAPI

The backend loads three private configuration inputs:

```text
AI_CODEX_GATEWAY_URL
AI_GATEWAY_CLIENT_ID
AI_GATEWAY_SECRET_FILE
```

For each request it serializes compact JSON, creates a timestamp and random nonce, signs the canonical request, adds a correlation ID and calls the gateway. The secret is read from a mounted file and never returned through an API.

Gateway errors are converted to application-safe errors with selected statuses. An invalid/non-JSON response becomes a controlled gateway-unavailable error.

## 6.3 Chat persistence model

MongoDB uses `ai_chats` and `ai_messages`.

An AI chat stores owner, title, provider, status, run status, provider conversation ID and timestamps. Messages store chat ID, role, content, optional context, status and timestamps. Assistant messages also store the gateway request ID.

The owner ID appears in every chat lookup. Knowing another chat UUID is insufficient to retrieve it.

## 6.4 Atomic message start

To start work, ToolHub uses `find_one_and_update` with the condition `runStatus=idle`. The winner changes it to `running`; another simultaneous request receives `409`. ToolHub then inserts the user message as `pending`.

FastAPI returns `202 Accepted` and schedules the long operation as a background task. This is the crucial stability behavior: Nginx/browser timeouts do not hold every ToolHub API request open while Codex thinks.

On success, ToolHub inserts the assistant message, completes the user message, saves the provider thread ID and returns the chat to idle. On failure it marks the user message failed and also unlocks the chat.

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

> **Application checkpoint**
> Compare the durable status transitions for a central-chat message and a course question. What recovery behavior is possible because ToolHub writes `pending` before invoking Codex?
