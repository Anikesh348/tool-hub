> **Learning goal**
> See a real, live system apply everything from Lessons 1–4: one shared AI platform, reused by four different ToolHub features, each making a different latency/guardrail trade-off for its own use case.

## 5.1 One platform, four applications

ToolHub does not have four separate "AI integrations" built independently — it has **one reusable, provider-neutral AI platform**, and four different applications built on top of it: the general admin AI Assistant, Course module Q&A, LeetCode AI (chat + question-set generation), and the MovieHub chat assistant. This lesson is the HLD view of the shared platform; Lesson 6 is the LLD view of how the four applications each use it differently.

```text
Browser (Assistant / Courses / LeetCode / MovieHub UI)
      |
      v
ToolHub FastAPI backend (ubuntu-purva)
      |
      v
Provider router  (ai_provider_router.py — in-process, Redis-backed pin)
      |
      +--> Codex gateway (ubuntu-purva:8765)  --> Codex executor on hp-codex  --> codex exec
      +--> Claude gateway (ubuntu-purva:8767) --> Claude executor on hp-claude --> claude
```

## 5.2 Why gateway and executor are separate services at all

This split exists for the reason Course 2, Lesson 5.2 argued in the abstract: a management VM capable of launching a provider's CLI is a sensitive asset, and it should never be reachable directly from application code. The **gateway** (on `ubuntu-purva`, same host as the ToolHub backend) owns the public-facing, provider-neutral REST contract, request validation, and signing. The **executor** (on a separate, dedicated, low-blast-radius host — `hp-codex` for Codex, `hp-claude` for Claude) is the *only* thing allowed to actually launch the provider CLI, and it only accepts signed requests from its own gateway. ToolHub's backend never talks to `hp-codex`/`hp-claude` directly, and never holds credentials for either — this is the "structural boundary over trust" principle from Course 2, Lesson 5.2/6.3, applied at infrastructure scale rather than just at the tool-permission level.

## 5.3 The provider router: automatic failover, not manual provider choice

An application never picks Codex or Claude directly — it only picks a **capability profile** (5.4), and `ai_provider_router.py`'s `routed_gateway_request()` decides which provider actually serves the request:

1. Try the current preferred provider first — **Claude is preferred**, Codex is the fallback (flipped from the original Codex-first design after a real usage-exhaustion incident).
2. If that provider's gateway reports usage exhaustion specifically (a distinct error code/marker, not just any failure), retry the same request against the other provider.
3. On a successful fallback, pin the choice in Redis (`ai:active-provider`) for a bounded TTL, so every backend worker routes new requests straight to the working provider instead of re-probing a dead one on every call.
4. Ordinary contention (`gateway_busy`/`executor_busy` — both gateway and executor allow only one run at a time) is deliberately **not** treated as exhaustion, so two admins asking questions at the same moment never accidentally fails the whole application over to the other provider.

Every one of the four applications in Lesson 6 calls this exact same function — none of them contain any provider-specific logic themselves.

## 5.4 Capability profiles: the actual security boundary

Course 2, Lesson 5.2 argued that a system-prompt instruction is not a security boundary, and structural denial is. ToolHub's `knowledge-only` and `read-only` capability profiles are exactly that structural denial, enforced at the executor, not requested-and-hoped-for at the model:

| Profile | Used by | Can do | Cannot do |
| --- | --- | --- | --- |
| `knowledge-only` | Course Q&A, LeetCode AI, MovieHub chat | Answer using model knowledge plus text context the application supplies | Shell, files, network, web search, any tool/write access |
| `read-only` | General AI Assistant | General answers, live public web search, bounded trusted host/system snapshots | Shell commands, file access, SSH, service control, writes |

An application cannot request a different profile's capabilities by claiming a special case — the boundary is enforced independent of what any individual request says, which is the entire point.

## 5.5 The sync-vs-async fork, playing out for real

Course 3, Lesson 1.6 raised sync-vs-async as a recurring production fork. ToolHub hit this directly: an early design held one HTTP request open for an entire AI reply (5–45+ seconds). That worked fine testing against the internal Tailscale network — but real browser traffic actually flows browser → a public Caddy edge VPS → a WireGuard tunnel → nginx → the backend, a path no internal test ever exercised, and some hop along that public path was killing long-held connections before the reply finished. Every AI feature in ToolHub now follows the same shape as a direct fix: **submit work in the background, return almost immediately (well under a second), and let the frontend poll** for the result — differing only in *what* runs the background work (Lesson 6 covers exactly that difference across the four applications). The lesson generalizes well beyond ToolHub: **test against the real production network path before trusting that a synchronous design is fine, because "works on the internal network" and "works over the actual public path" are not the same claim.**

## 5.6 Security and reliability details that make this a real platform, not a prototype

- **HMAC request signing and replay protection** on every gateway↔executor hop, with scopes and optional source-CIDR restrictions per registered application — an application can be added to the registry without either provider VM needing to change.
- **One run at a time per gateway/executor**, returning a controlled `429 gateway_busy`/`executor_busy` rather than silently queuing or overloading a single-executor host.
- **Sanitized, minimal execution environment** on each executor — a fixed CLI invocation, ignored personal config, and a locked-down permission profile, so even the executor host can't be pushed outside its intended profile by a crafted request.
- **Audit metadata without storing prompts/answers** at the gateway layer — enough to debug and monitor without the gateway becoming a second copy of every user's private conversation.

## 5.7 A third, unrelated profile — worth naming so you don't conflate it

A separate `operator` capability profile exists on the same underlying infrastructure, used only by a distinct ops-scheduler system, with write access and full shell — it has its own gateway/executor pair and its own review trade-offs, and ToolHub's application contract never requests it and cannot reach it. It's mentioned here only so "what can ToolHub's AI features do" (this lesson) and "what can this Codex/Claude deployment do anywhere on this infrastructure" (a much broader question) don't get conflated — a distinction directly relevant to Course 2, Lesson 5.5's point about scoping "full agentic control" precisely rather than treating it as one universal capability level.

> **Review question**
> The provider router treats `gateway_busy` and usage-exhaustion as two different failure categories, with different responses (retry-same-provider-later vs. fail-over-and-pin). Using 5.3, explain why conflating these two into one "just fail over" policy would be a real production bug, and describe the concrete bad outcome it would cause under ordinary concurrent usage.
