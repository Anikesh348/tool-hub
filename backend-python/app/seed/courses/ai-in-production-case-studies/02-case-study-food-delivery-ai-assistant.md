> **Learning goal**
> Design a plausible, defensible architecture for a food-delivery AI assistant (in the style of Zomato's "Zomato AI"/support bots or Swiggy's assistant features), applying the five-question framework from Lesson 1.

> **A note on sourcing:** this lesson is an educational system-design exercise, not a leaked or confirmed internal architecture diagram of any specific company. It's built from publicly discussed product capabilities and the same engineering constraints from Lesson 1, to teach the *pattern* — which is genuinely how systems in this space are commonly built — rather than to claim insider knowledge of one company's actual stack.

## 2.1 What the capability actually is

A food-delivery AI assistant typically spans a few distinct jobs, each with a very different risk and freshness profile:

- **Order support** — "where's my order," "the order arrived cold," "I was charged twice" — needs live, per-user, per-order data.
- **Discovery/recommendations** — "find me a good biryani place near me," "something spicy under ₹300" — needs live catalog, pricing, and availability data, personalized to the user.
- **General FAQ** — refund policy, how delivery fees are calculated — mostly static, slowly-changing content.

Treating these as one monolithic "AI chatbot" is a common early mistake — they have different data-freshness needs, different guardrail requirements, and different tolerances for a wrong answer, so a well-designed system routes between them rather than handling all three with one undifferentiated prompt.

## 2.2 High-level architecture

```text
User (app/web chat)
     |
     v
API Gateway / BFF  --------------------------------------------+
     |                                                          |
     v                                                          v
Intent Router (small/fast model or classifier)          Live order/account service
     |                                                    (source of truth, NOT the LLM)
     +--> Order-support flow  --> tool: get_order_status(orderId) --> live backend
     |
     +--> Discovery flow --> RAG over restaurant/menu index (Course 2, Lesson 4)
     |                        + live inventory/availability check
     |
     +--> FAQ flow --> RAG over policy documents (slow-changing, cached aggressively)
```

The **intent router** up front (a cheap, fast classification step — often a smaller model or even non-LLM classifier) exists directly because of Lesson 1.2/1.3's latency and cost pressure: it's wasteful and slow to run a full agentic RAG pipeline for "what's your refund policy" when a much cheaper path exists, and it lets each downstream flow have a narrower, more reliable, purpose-built prompt (Course 2, Lesson 6.2's specialization argument).

## 2.3 Why order status must never be "answered" by the LLM directly

This is the most important design decision in the whole system: a question like "where's my order" must be answered by **calling the real order-tracking system as a tool** (Course 2, Lesson 1.2) and having the model *summarize that real data in natural language* — never by letting the model guess or infer a status from conversational context. Order status is exactly the kind of fast-changing, must-be-correct fact that hallucination (Course 1, Lesson 7.5) makes unacceptably risky to leave to model "knowledge." This is the RAG/tool-calling principle from Course 2 applied concretely: ground every fact-sensitive answer in a live system call, and use the LLM purely for the language layer on top.

## 2.4 Discovery and recommendations: RAG plus real-time constraints

"Find me something spicy under ₹300 that's open right now" is a RAG problem (Course 2, Lesson 4) layered with a hard real-time filter: retrieval over an embedded catalog of restaurants/dishes returns semantically relevant matches, but those candidates then need to be filtered against live constraints (is it currently open, is it deliverable to this address, is the price actually under budget *right now* including current surge/delivery fees) before ever reaching the model for final ranking and natural-language presentation. This two-stage pattern — semantic retrieval for relevance, then a hard business-logic filter for correctness — mirrors the reranking stage from Course 2, Lesson 4.5, except the second-stage filter here is deterministic business rules, not another ML model.

## 2.5 Sync vs. async, applied

Order-status and FAQ answers are typically fast enough (one tool call or one RAG lookup) to serve synchronously, matching a user's expectation of an instant chat reply (Lesson 1.6). A more elaborate request — "plan a meal for a dinner party of 8 with these dietary restrictions across 3 restaurants" — genuinely needs multiple tool calls and more model reasoning, and a well-designed system would use the background-task-plus-poll or streaming pattern from Lesson 1.2/1.6 rather than holding a request open and risking exactly the kind of edge-timeout failure covered in Lesson 6 of this course.

## 2.6 Guardrails specific to this domain

- **Never let the model fabricate order data, pricing, or ETAs** — always tool-call into the real system (2.3); this is the single highest-value guardrail here.
- **Refund/compensation caps** — if the assistant is empowered to *issue* goodwill credits (not just answer questions), that action needs a hard-coded dollar/rupee ceiling and audit logging, independent of what the model "decides" is fair — the same structural-boundary principle from Course 2, Lesson 6.3's guardrail table, not a prompt instruction alone.
- **Allergy and dietary claims** — a wrong "yes this is nut-free" answer is a safety incident, not a UX bug; production systems in this space are typically conservative here, deferring to restaurant-provided structured data over model inference from a free-text menu description, and refusing to guess when that structured data is missing.
- **Scope boundary** — the assistant should decline (and hand off to a human agent) requests it has no reliable tool or data for, rather than answering from general model knowledge — e.g., disputes requiring judgment calls, complaints implying safety/health issues, or anything the model has learned to recognize as needing escalation.

## 2.7 Why this is a genuinely hard system, not just "add a chatbot"

The interesting engineering here isn't the LLM call itself — it's the surrounding system: an intent router keeping cost and latency down, a hard separation between "facts the model is allowed to state" (must come from a tool call) and "language the model is allowed to generate" (summarization/phrasing), real-time business-rule filtering layered on top of semantic retrieval, and guardrails calibrated to what actually goes wrong in food delivery specifically (wrong order info, wrong allergy claims, uncapped refunds) rather than generic AI safety boilerplate.

> **Review question**
> Using 2.3's principle, explain concretely why a food-delivery assistant answering "is this restaurant's chicken tikka nut-free?" purely from the LLM's general knowledge of what chicken tikka usually contains — instead of checking the specific restaurant's structured allergen data — is a design flaw, not just an occasional wrong answer. What's the worst-case consequence, and which guardrail from 2.6 exists specifically to prevent it?
