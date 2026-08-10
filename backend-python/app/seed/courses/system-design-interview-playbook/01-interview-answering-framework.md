> **Learning goal**
> Build one repeatable method for answering *any* "design X" interview question, so every lesson that follows in this course is an application of the same framework rather than a new thing to memorize.

## 1.1 Why a framework matters more than knowing the "answer"

A system design interview is not a trivia test. There is no single correct architecture for "design Twitter" — there are dozens of reasonable ones, and the interviewer already knows several of them. What they are actually evaluating is whether you can turn a vague, open-ended prompt into a structured investigation: ask the right questions, make defensible assumptions, size the problem, propose a design, and then reason honestly about its weaknesses.

Beginners tend to fail this in one of two ways: they either jump straight to drawing boxes and arrows without ever pinning down what the system needs to do, or they recite memorized architecture patterns ("obviously we need a load balancer, a cache, and a message queue") without connecting each piece back to a requirement that demands it. Both looks like knowledge but reads as guessing. The fix is the same in every problem: work through a fixed sequence of stages, and let each stage's output become the input to the next one.

This lesson lays out that sequence once. Every later module in this course (each "Design X" lesson) follows these same seven stages in the same order, so once this lesson is internalized, the rest of the course is about *applying* it to progressively harder problems rather than learning a new process every time.

## 1.2 Stage 1 — Clarify the requirements

Never start designing before you know what you are designing. In a real interview this stage is a conversation; in this course, each lesson opens by stating the requirements explicitly so you can see what "clarifying" produces.

Split requirements into two buckets:

- **Functional requirements** — the actions a user (or another system) can take. For a URL shortener: create a short link, resolve a short link back to the original URL. Keep this list short — 3 to 5 core actions. A common beginner mistake is trying to design every feature a real product has; the interview wants depth on a small, well-chosen scope, not a shallow pass over everything.
- **Non-functional requirements** — the qualities the system must have while doing those actions: how available it must be, how consistent, how it should behave under partial failure, and roughly how fast responses need to be. These matter because they are what actually drive architectural decisions. "Must be highly available even if that costs some consistency" is what justifies replication and eventual consistency later; "must never lose a write" is what justifies synchronous replication or a durable log instead.

Explicitly decide what is **out of scope**. Saying "I will not design the analytics dashboard for this feature" is a sign of maturity, not a gap — it shows you can bound a problem instead of drowning in it.

## 1.3 Stage 2 — Estimate scale (back-of-the-envelope math)

Numbers change designs. A system serving 1,000 users a day and one serving 100 million users a day are not the same system even if the feature list is identical — the second one cannot live on a single database, cannot serve every request from the same region, and cannot recompute expensive results on every read.

Work through four numbers, in this order, using round figures and stating assumptions out loud:

1. **Traffic** — daily active users, requests per user per day, and the read:write ratio. Convert daily totals to an average requests-per-second figure, and separately note the peak (commonly 2-3x average for consumer traffic).
2. **Storage** — size of one record, multiplied by how many records accumulate per day/year. This tells you whether a single database node is plausible or whether you need sharding from day one.
3. **Bandwidth** — request/response payload size multiplied by request rate. This matters most for media-heavy systems (video, images) and is often the real bottleneck, not CPU.
4. **Memory (for caching)** — if a cache is part of the design, estimate what fraction of "hot" data must stay in memory to hit a target cache-hit rate, using something like the 80/20 rule as a starting assumption.

Precision is not the point — a number that is off by 2x rarely changes the architecture, but a number that is off by 1,000x does. The skill being tested is *knowing which numbers matter* and using them to justify later decisions ("at this write rate a single Postgres primary is fine, so I will not shard yet").

## 1.4 Stage 3 — Define the API and data model

Before drawing any boxes, pin down the contract and the shape of the data, because both constrain everything drawn afterward.

**API design.** For each functional requirement, write one endpoint: method, path, request body, response body. This is not about REST purity — it is about forcing yourself to be concrete. "The system creates short URLs" is vague; `POST /urls {"longUrl": "..."} -> {"shortCode": "..."}` is a decision you can defend and that an interviewer can push back on.

**Data model.** Identify the core entities (e.g., `User`, `Url`, `ClickEvent`) and their key fields and relationships. Then make the single most consequential decision in this stage: **SQL or NoSQL, and why.** The honest answer is almost always "it depends on the access pattern," so state the access pattern: if the workload is point lookups by a single key at massive scale with a simple schema, a key-value or wide-column store is a strong fit; if the workload needs multi-record transactions, joins, or flexible ad-hoc queries, a relational database earns its cost. This decision should trace back directly to Stage 1's non-functional requirements and Stage 2's scale numbers — not to a preference stated without justification.

## 1.5 Stage 4 — Draw the high-level architecture

Only now do the boxes and arrows appear, and every box should be traceable to something decided in Stages 1-3. A useful discipline: before adding a component, be able to finish the sentence "I am adding this because requirement/number ___ demands it." If you cannot finish that sentence, leave it out.

A typical high-level flow, present in some form in most large-scale designs:

```text
Client
  -> DNS -> Load Balancer
       -> API Gateway (auth, rate limiting, routing)
            -> Application/service layer (stateless, horizontally scaled)
                 -> Cache (hot reads)
                 -> Primary datastore (source of truth)
                 -> Message queue -> async workers (for slow/non-critical work)
                 -> Object storage / CDN (for large or static assets)
```

Not every design needs every layer — a system with modest traffic and no media assets does not need a CDN, and saying so explicitly ("I am skipping a CDN because our numbers from Stage 2 don't justify one yet") demonstrates judgment. Describe the request path in words as well as boxes: what happens on a write, what happens on a read, and where each one touches the components above. This narration is usually more valuable to an interviewer than the diagram itself, because it proves you understand the data flow rather than having memorized a picture.

## 1.6 Stage 5 — Deep dive into the hard parts

A high-level diagram treats every component as a black box; the deep dive stage is where you open the one or two boxes that are actually interesting for *this* problem and explain how they work internally. Not every component deserves this — pick the parts that are specific to the problem, not generic infrastructure. For a URL shortener, the interesting part is the short-code generation strategy (counter + base62 vs. hashing vs. pre-generated pool) and how it stays unique under concurrent writes. For a chat app, it is how messages are delivered in near-real-time and ordered per conversation. For a rate limiter, it is the actual algorithm (token bucket, sliding window, etc.) and where its state lives.

Every lesson in this course has a "Deep dive" section that does exactly this for its problem — treat those sections as the payoff of the whole exercise, since the earlier stages exist mainly to earn the context needed to make the deep dive concrete instead of hand-wavy.

## 1.7 Stage 6 — Identify bottlenecks and trade-offs

No design is free of weaknesses, and pretending otherwise is a bigger red flag than having them. For the design just proposed, walk through:

- **Single points of failure** — which component, if it goes down, takes the whole system down? What is the mitigation (replication, failover, redundancy)?
- **Hot spots** — is there a component or shard key that could receive disproportionate load (a celebrity account, a viral post, a popular key)? How would the design detect and absorb that?
- **Consistency vs. availability** — where does this design sit on that spectrum, and is that the right place given Stage 1's non-functional requirements?
- **What breaks first as scale grows 10x or 100x** — this is usually the most revealing question to ask yourself, because it shows whether the design was built for the stated scale or accidentally over- or under-engineered.

## 1.8 Stage 7 — Summarize and leave room for follow-ups

Close with a short recap: the core requirements, the key design decisions, and the trade-offs accepted. This is also the moment to proactively name one or two extensions an interviewer is likely to ask about next ("if we needed to support X, I would change Y") — it signals that the design was not treated as finished-and-final, but as one defensible point in a larger space of options.

## 1.9 The checklist, condensed

For quick reference before every lesson in this course:

| Stage | Question you are answering |
| --- | --- |
| 1. Requirements | What must this system do, and under what qualities? |
| 2. Estimation | How big is "big" here — traffic, storage, bandwidth, memory? |
| 3. API & data model | What is the contract, and what does the data look like? |
| 4. High-level design | What are the components, and why does each one exist? |
| 5. Deep dive | How does the one or two hardest parts actually work? |
| 6. Bottlenecks & trade-offs | Where does this design break, and what did it give up? |
| 7. Summary | What's the recap, and what would change next? |

Every remaining lesson in this course — from the Easy tier through the Hard tier — is this same table, filled in for a different problem. As the problems get harder, Stage 5 (the deep dive) grows and the number of interacting components in Stage 4 grows, but the method never changes. That repetition is deliberate: by the time you reach the Hard tier, the framework itself should feel automatic, leaving all your attention for the parts of each problem that are genuinely new.
