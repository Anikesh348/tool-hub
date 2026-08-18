> **Learning goal**
> Look at a third product shape — coding copilots and productivity assistants (GitHub Copilot, Notion AI style) — and consolidate the guardrail patterns seen across all three case studies into one reusable checklist.

> **A note on sourcing:** as with Lessons 2–3, this is an educational system-design exercise built from publicly discussed product capabilities and general engineering patterns in this space, not a confirmed internal architecture of any specific company.

## 4.1 A different risk profile: the user *is* the domain expert

Lessons 2 and 3 both involved an AI assistant helping a consumer who often can't independently verify the answer (most users can't verify a restaurant's allergen data or a laptop's real-world video-editing performance). Coding copilots and productivity tools like Notion AI are different: the user is frequently the domain expert — a developer reviewing a code suggestion, a writer reviewing a drafted paragraph — which changes the guardrail calculus. The primary risk isn't "the user believes a wrong fact with no way to check"; it's **the user accepting a subtly wrong suggestion faster than they'd have caught it writing from scratch**, plus, for coding tools specifically, the direct-action risks from Course 2, Lesson 5.2 once the tool moves from *suggesting* code to *executing* commands.

## 4.2 Two shapes: inline suggestion vs. agentic execution

This is the same spectrum from Course 2, Lesson 1.6, concretely instantiated:

| Shape | Example | What it can do | Primary guardrail need |
| --- | --- | --- | --- |
| Inline suggestion | Classic autocomplete-style Copilot, Notion AI's "continue writing" | Proposes text/code inline; nothing happens until the human explicitly accepts it | Low — the human is an inherent approval gate on every single suggestion |
| Agentic execution | Claude Code, Codex-style agents (Course 2, Lesson 5) | Reads/writes files, runs commands, iterates autonomously across many steps | High — Course 2 Lesson 5.2's permission/sandboxing layer becomes mandatory, not optional |

A huge amount of real product design work in this space is choosing *where* on this spectrum a given feature sits, and matching the guardrail investment to that choice — an inline suggestion tool that never executes anything genuinely needs less infrastructure-level guardrail investment than an agent with real shell access, precisely because the human-in-the-loop-by-construction property of "nothing happens until I accept this line" is itself a strong, structural guardrail (echoing Course 2 Lesson 3.4's human-in-the-loop interrupt pattern, just implemented as a UI convention rather than a graph checkpoint).

## 4.3 Context is the product: what these tools actually retrieve

A generic LLM call with no context produces generic code/text. What makes a coding or writing copilot *useful* is almost entirely about context assembly — the same RAG/context-management discipline from Course 2 Lessons 4–5, applied to a workspace instead of a document store: the currently open file, recently edited files, the project's existing conventions (so generated code matches the codebase's actual style rather than a generic default), and for agentic tools, the ability to actively search the codebase rather than relying on whatever fits in one context window (Course 2, Lesson 5.3). Notion AI's equivalent is retrieving the relevant workspace pages/database entries the request should be grounded in, rather than treating each request as knowing nothing about the workspace it lives in.

## 4.4 Verification loops as the core reliability mechanism

Course 2, Lesson 5.4 already established this for coding agents specifically: running the real test suite/build/type-checker and reading real output is what separates a genuinely reliable coding agent from one that just produces plausible-looking diffs. The productivity-AI equivalent is weaker but still present — Notion AI-style tools that can check generated content against a template or existing data (e.g., "does this generated table's data match the linked database") are applying the same principle: **verify against ground truth where any ground truth exists, rather than trusting the model's first output.**

## 4.5 Consolidated guardrail checklist across all three case studies

Pulling Lessons 2, 3, and 4 together, the same handful of guardrail patterns recur regardless of domain — worth treating as a reusable checklist for designing (or evaluating) any production AI feature:

1. **Ground every fact-sensitive claim in a real system, not model knowledge** (Lesson 2.3's order status, Lesson 3.3's product specs, this lesson's context retrieval) — the single most repeated pattern across all three case studies.
2. **Keep risky actions behind a structural boundary, not a prompt instruction** (Course 2, Lesson 5.2's permission layer; Lesson 2.6's refund cap) — a system prompt telling the model to "be careful" is not a security boundary.
3. **Match the human-approval gate to the actual risk** — inline-suggestion tools get an implicit gate for free (4.2); autonomous agents need an explicit one (approval steps, sandboxing, dollar/action caps).
4. **Treat retrieval corpora as a trust boundary** — first-party curated content (Lesson 2's own restaurant data) is safer than open/adversarial content (Lesson 3's third-party listings; a codebase with attacker-influenced comments) — the more open the corpus, the more seriously prompt injection (Course 2, Lesson 6.4) needs to be taken.
5. **Verify against ground truth wherever it exists** (this lesson's 4.4; Course 2 Lesson 5.4) — tests, type checkers, structured data, existing records — rather than trusting a single model pass.
6. **Design for graceful handoff, not just refusal** — every case study includes a "hand off to a human" boundary (Lesson 1.7's fifth question) rather than either blindly answering or bluntly refusing.

## 4.6 Why this checklist, not a specific framework, is the transferable skill

Notice that none of these six points name a specific product, model, or vendor — they're architectural principles that show up whether the underlying stack is LangGraph (Course 2, Lesson 3), a custom agent loop, or a completely different framework. This is deliberate: frameworks and specific products change every few months in this field, but "ground facts in real systems," "structural over prompt-based guardrails," and "verify before trusting" are durable enough to apply to whatever the next new tool turns out to be — including ToolHub's own AI features, which Lessons 5 and 6 walk through as a real, concrete instance of this same checklist.

> **Review question**
> Using the spectrum in 4.2, where would you place a hypothetical "AI code review bot" that reads a pull request and posts comments, but cannot itself modify code or merge anything? Walk through the six-point checklist in 4.5 and identify which points matter most for this specific tool, and which matter least given its restricted capability.
