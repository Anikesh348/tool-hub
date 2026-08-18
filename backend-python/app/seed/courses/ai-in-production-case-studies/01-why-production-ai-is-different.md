> **Learning goal**
> Understand the specific constraints — latency, cost, reliability, and guardrails — that separate "an AI demo" from "an AI feature millions of people depend on," before looking at real company case studies.

## 1.1 A demo has to work once; a product has to work every time

A weekend prototype of an AI chatbot needs to produce one good-looking answer for a screenshot or a demo video. A production feature at a company like Zomato, Amazon, or Notion needs to work correctly (or fail gracefully) for millions of unpredictable, sometimes adversarial, sometimes just confused users, every day, indefinitely, while staying within a cost budget. That gap is where most of the engineering in this course's remaining lessons lives.

## 1.2 Latency: users won't wait for a "thoughtful" answer

Course 1 (Lesson 6.3) showed that generating a response is a token-by-token loop — and a genuinely agentic response (Course 2, Lesson 1.3) might involve several tool calls and several LLM round-trips chained together, each adding latency. A user asking a food-delivery app "where's my order" expects an answer in a second or two, not the 10–30+ seconds a multi-step agentic RAG pipeline might realistically take end-to-end. Production systems manage this with patterns you'll see repeatedly in the case studies:

- **Streaming** partial output token-by-token (Course 1, Lesson 6.3) so the user sees progress immediately instead of staring at a blank screen.
- **Model routing** — sending simple, common questions to a smaller/faster/cheaper model, and only routing genuinely hard questions to a larger, slower model (mentioned briefly in Course 1, Lesson 6.5).
- **Background execution + polling or websockets** instead of holding one HTTP request open for a slow multi-step answer — the exact pattern ToolHub itself had to adopt (Lesson 6 of this course) after discovering a synchronous design broke across a real multi-hop network path.
- **Pre-computation** — answering extremely common questions (e.g., "what's your return policy?") from a cache or a pre-generated FAQ rather than invoking an LLM at all.

## 1.3 Cost: every token has a price, at scale

A single chat message might cost a fraction of a cent, but multiplied across millions of daily active users, LLM inference is a genuine, board-level line item for large consumer products — and RAG (Course 2, Lesson 4) and agentic tool loops (Course 2, Lesson 1.3) multiply token usage further, since every retrieved chunk and every tool round-trip adds tokens to the bill. This is *why* model routing (1.2), aggressive context trimming (Course 1, Lesson 7.1), and caching common answers aren't just performance optimizations — they're direct cost controls, and the case studies in this course were all designed under real cost pressure, not just latency pressure.

## 1.4 Reliability: LLMs fail differently than normal software

A normal backend bug throws an exception or returns a wrong status code — loud, visible, easy to alert on. An LLM's "failure" mode is often silent and fluent: a wrong-but-confident answer (hallucination, Course 1 Lesson 7.5), an unhelpful non-answer, or — worse for a company — an answer that's technically true but says something the company never intended to promise (a well-publicized real incident: a car dealership's chatbot was tricked into "agreeing" to sell a car for $1, and an airline's chatbot invented a refund policy that a court later held the airline to). Production systems need monitoring and evals (Course 2, Lesson 6.5) specifically because "it returned 200 OK" doesn't mean "it said something acceptable."

## 1.5 Guardrails aren't optional once money, safety, or brand risk is involved

Course 2 (Lesson 6.3) laid out layered guardrails in the abstract. In production, the stakes behind those layers are concrete: a shopping assistant that can be talked into recommending a competitor's product, a support bot that promises a refund the company can't actually honor, an agent that leaks another customer's order details. Every case study in Lessons 2–4 includes a "what guardrails does this need" discussion, because in a real company, the guardrail design is treated as seriously as the AI capability itself — arguably more seriously, since a capability gap is a missed feature, but a guardrail gap is an incident.

## 1.6 Sync vs. async: a recurring architectural fork

Because of 1.2's latency reality, nearly every production AI feature makes an early, consequential decision: does this user-facing request hold a connection open and wait for the full AI response synchronously, or does it kick off background work and let the client poll or subscribe for the result? This isn't a stylistic preference — Lesson 6 of this course covers a real, concrete case (ToolHub's own AI features) where the synchronous version was silently broken in production by an infrastructure hop nobody had tested against, and only discovered once traffic crossed that exact path. Watch for this same fork reappearing in the Lesson 2–4 case studies.

## 1.7 A framework for reading the case studies ahead

For each company case study in Lessons 2–4, this course will consistently ask the same five questions — worth internalizing now, since they're the actual skeleton of an AI system design interview or a real design review:

1. **What's the user-facing capability**, precisely — not "AI chatbot," but the specific tasks it must and must not do?
2. **What's the data it needs**, and how fresh does that data need to be (live inventory vs. a slowly-updated policy document)?
3. **Sync or async**, and why, given the latency/cost trade-offs above?
4. **What guardrails** does it need, specific to what could go wrong for *this* product (a food app's risk profile differs from a bank's)?
5. **What's deliberately out of scope** — what will it refuse or hand off to a human, and why was that boundary drawn there?

> **Review question**
> A team is building an AI assistant for a hospital appointment-booking app. Using the five questions in 1.7, what's one guardrail this system would need that a food-delivery bot (Lesson 2) likely wouldn't, and why does the difference in domain — not the underlying AI technology — drive that difference?
