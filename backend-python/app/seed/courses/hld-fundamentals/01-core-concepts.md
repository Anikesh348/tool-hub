> **Learning goal**
> Understand the core vocabulary system designers use to describe how well a system handles growth and failure — scalability, availability, reliability, SPOF, latency/throughput/bandwidth, consistent hashing, the CAP theorem, failover, and fault tolerance — so later lessons can use these terms precisely instead of loosely.

## 1.1 Overview

Every "design X" problem eventually asks the same underlying question: what happens when this system gets bigger, or when a piece of it breaks? The nine topics in this module are the vocabulary for answering that question precisely. They split into three rough clusters that build on each other.

The first cluster — scalability, availability, and reliability — describes the *qualities* we want a system to have. These three words get used interchangeably in casual conversation, but they measure different things, and mixing them up leads to designing the wrong fix for the wrong problem. The second cluster — SPOF, failover, and fault tolerance — describes the *mechanics* of failure: what makes a system fragile, and what specific techniques make it resilient instead. The third cluster — latency/throughput/bandwidth, consistent hashing, and the CAP theorem — gives you the *measurement and distribution tools* needed to reason about performance and correctness once a system is spread across many machines.

None of these ideas are useful in isolation. A system can be perfectly scalable and still be unreliable. A system can eliminate every SPOF and still violate the CAP theorem's guarantees during a network split. Treat this module as building one connected mental model, not nine flashcards.

## 1.2 Scalability

**Scalability** is a system's ability to handle more work — more users, more requests, more data — by adding resources, without having to redesign the system from scratch every time load grows. A scalable system might get slower under 10x load, but it shouldn't fall over; an unscalable one hits a wall where no amount of extra hardware helps because the architecture itself is the bottleneck.

The motivating example is almost always the same story: a startup launches with a single server running the app and the database side by side. It works fine for a thousand users. Then the product takes off, traffic jumps to a million users, and that one server maxes out its CPU, memory, and disk I/O simultaneously. Buying a bigger server helps for a while, but eventually you hit the largest machine money can buy — and you're stuck.

There are two fundamentally different ways to respond to that wall:

- **Vertical scaling ("scale up")** means giving the existing machine more CPU, RAM, or faster disks. It's simple — no code changes, no new failure modes — but it has a hard ceiling (there's a biggest machine available), it usually requires downtime to upgrade, and the single beefed-up machine is still one machine that can fail.
- **Horizontal scaling ("scale out")** means adding *more* machines and spreading the load across them, typically behind a load balancer. It has no real ceiling — need more capacity, add another box — and as a side effect it also improves fault tolerance, since losing one of ten machines is a 10% capacity hit, not a total outage. The cost is complexity: the machines now need to coordinate, share or partition data, and behave consistently even though they're not the same physical box.

A typical growth path looks like: one server → split the database onto its own server → add a cache in front of the database → add more application servers behind a load balancer → add read replicas for the database → shard the database once writes outgrow a single primary. Each step is a response to a specific bottleneck, not a step taken just because it sounds like "best practice."

The practical gotcha: horizontal scaling only works cleanly if your application servers are **stateless** — if any server can handle any request because nothing important is stored in that server's local memory or disk. If a server holds session data locally, requests from the same user need to keep landing on the same machine, which defeats much of the purpose of scaling out. This is why "make the app layer stateless, push state into a shared store" is one of the most repeated pieces of advice in system design.

## 1.3 Availability

**Availability** is the percentage of time a system is up and able to respond, out of the total time it's supposed to be running. The formula is simple: uptime divided by (uptime + downtime). What makes availability tricky isn't the definition — it's how unforgiving the percentages are once you look closely.

Availability is usually expressed in "nines": 99% availability sounds impressive until you do the math and realize it allows about 3.65 days of downtime per year. 99.9% ("three nines") allows about 8.7 hours a year. 99.99% ("four nines") allows about 52 minutes a year. 99.999% ("five nines," the standard often quoted for telecom-grade systems) allows only about 5 minutes a year. Each additional nine is roughly a 10x tighter budget, which means each additional nine is dramatically more expensive to achieve.

Here's the part that trips up beginners: availability of a whole system depends on how its components are arranged, not just each component's individual availability.

- If components are **in series** — a request has to pass through component A *and then* component B *and then* component C to succeed — the failure probabilities stack up. Three components each at 99.9% availability, chained in series, give you roughly 99.7% overall, not 99.9%. Every additional component in the critical path drags availability down.
- If components are **in parallel** — a backup can take over the instant the primary fails — availability compounds *upward*. Two components each at 99.9%, arranged so either one alone can serve the request, gives you roughly 99.9999% combined, because both would have to fail at the same moment for the system to go down.

This is the mathematical reason redundancy is the standard answer to low availability: putting a backup component in parallel with a critical one is one of the few moves that improves the number rather than dragging it down.

There are two common redundancy patterns. **Active-passive**: one instance handles traffic while a standby sits idle, ready to take over if the primary fails; how fast that takeover happens depends on whether the standby is "cold" (needs to be started up), "warm" (running but not receiving traffic), or "hot" (already receiving traffic, ready instantly). **Active-active**: multiple instances handle traffic simultaneously, so if one fails, the others simply absorb its share with no failover pause at all — at the cost of needing those instances to coordinate shared state.

The gotcha to remember: redundancy only helps if it's applied at *every* layer a request touches. Ten redundant application servers sitting in front of one single database server haven't actually fixed your availability problem — you've just moved the weakest link.

## 1.4 Reliability

**Reliability** is easy to confuse with availability, but they measure different failure modes. Availability asks "is the system responding right now?" Reliability asks "when the system responds, is the answer *correct*?" A system can be up 100% of the time and still be unreliable — imagine a payment service that always returns a response instantly, but which occasionally double-charges a customer due to a race condition. It never goes down, so its availability number looks perfect, yet nobody would call it trustworthy.

This distinction matters in practice because it changes what you optimize for. Users tend to forgive occasional downtime — a "try again in a minute" message is annoying but understandable. Users do not forgive silent incorrectness: money vanishing from an account, a message delivered twice, an order placed but not recorded. Incorrect behavior erodes trust faster than unavailability does, because the user often doesn't even realize something went wrong until much later.

Reliability is usually tracked with a different set of metrics than availability:

| Metric | What it measures |
| --- | --- |
| MTBF (Mean Time Between Failures) | How often something breaks — higher is better |
| MTTR (Mean Time To Recovery) | How fast you recover once something breaks — lower is better |
| Error rate | Percentage of requests that fail or return errors |
| Correctness rate | Percentage of responses that are actually accurate, not just "successful" |

A subtle but important point: in real systems, investing in a lower MTTR (recovering fast) is often more cost-effective than chasing a slightly higher MTBF (trying to prevent every possible failure). You cannot eliminate all failures — hardware degrades, bugs slip through review, humans mistype a config value — but you can absolutely control how quickly the system notices and recovers.

Concrete techniques for improving reliability include: making operations **idempotent** (so retrying a failed request — like "charge $10" — doesn't accidentally repeat the effect, usually by attaching a unique idempotency key to the request so duplicates are recognized and ignored); using **circuit breakers** to stop calling a dependency that's returning bad or slow data, rather than hammering it and making things worse; and building **graceful degradation** paths, where a non-critical feature (like "recommended for you") quietly turns itself off under stress rather than taking down checkout with it.

The gotcha: teams sometimes chase five-nines availability while ignoring correctness bugs, because uptime dashboards are easy to build and "was this answer right" is much harder to measure automatically. Reliability requires deliberately testing for correctness, not just watching whether the server is still responding.

## 1.5 Single Point of Failure (SPOF)

A **single point of failure**, or SPOF, is any single component whose failure takes down the whole system, or a critical piece of it, with nothing else able to pick up the slack. The term applies far more broadly than "a server crashed" — a SPOF can be a database with no replica, a load balancer with no backup, a DNS provider with a single account, a message queue with one broker, or even a deployment process that only one engineer on the team knows how to run.

A useful way to check whether something is actually a SPOF, rather than just a scary-sounding single box on a diagram, is to ask three questions: Does a critical user flow genuinely depend on it? Is there no working alternative if it fails? And would its failure cause real, unacceptable damage (not just a minor cosmetic glitch)? If all three are true, it's a SPOF worth fixing. If a component only affects some optional, non-critical feature, treating it with the same urgency as your primary database is wasted effort.

A classic example: an e-commerce site puts a single load balancer in front of a fleet of ten application servers. The app servers are beautifully redundant — but the load balancer in front of them isn't. If that one load balancer instance goes down, all ten app servers become unreachable even though every one of them is healthy. The redundancy at one layer was undone by a SPOF one layer up.

```text
        [ Load Balancer ]   <-- SPOF: only one instance
         /   |    |    \
      [App][App][App][App]  <-- redundant, but doesn't matter now
```

Common places SPOFs hide: the entry point to the system (a single load balancer or DNS record), a single availability zone or data center hosting everything, an unreplicated primary database, a shared network resource like a single NAT gateway that every server routes through, and "process" SPOFs — a deploy pipeline that only works if one specific person is available.

Fixing a SPOF generally means applying the same redundancy ideas from the availability section: run two load balancers instead of one, replicate the database, spread instances across multiple availability zones or regions, and add health checks so traffic automatically avoids a component the moment it stops responding. For non-critical dependencies, sometimes the fix isn't redundancy but graceful degradation — if the recommendation service is down, show the page without recommendations rather than failing the whole request.

The gotcha: eliminating every SPOF is not free — it costs money, adds operational complexity, and adds more moving parts that can themselves fail in new ways. Good system design isn't "remove every SPOF unconditionally," it's "know where your SPOFs are, and deliberately decide which ones are worth the cost to fix given the actual business impact of them failing."

## 1.6 Latency vs Throughput vs Bandwidth

These three terms get thrown around interchangeably in everyday speech ("the connection is slow"), but in system design they measure genuinely different things, and confusing them leads to fixing the wrong problem.

- **Latency** is how long a single request takes, from the moment it's sent to the moment the response comes back — usually measured in milliseconds.
- **Throughput** is how much work the system completes per unit of time — usually measured in requests per second or transactions per second.
- **Bandwidth** is the maximum theoretical capacity of a link or pipe — usually measured in bits per second.

A highway analogy makes the difference concrete: bandwidth is the number of lanes on the highway. Throughput is how many cars actually pass a given point per hour. Latency is how long it takes one specific car to drive from the on-ramp to the off-ramp. You can have a ten-lane highway (high bandwidth) that's jammed with traffic, so throughput is low and every individual driver's latency is high, even though the road itself was never the limiting factor.

An important, easy-to-miss point: throughput is limited by whichever part of the system is slowest, not by the theoretical maximum of any one piece. If your network link can handle 10 Gbps but your database can only process 5,000 writes per second before it saturates, your real throughput ceiling is the database, not the network.

When measuring latency, never trust a single "average" number. Averages hide outliers. The standard practice is to look at percentiles — p50 (median), p95, p99 — because a system where the average latency is 50ms but the p99 is 4 seconds means 1% of your users are having a genuinely bad time, and that 1% can be a lot of people at scale. "Optimize the p99, not just the average" is a recurring theme in performance work.

There's also a real mathematical relationship connecting these ideas, known as **Little's Law**: the number of requests being handled concurrently roughly equals throughput multiplied by latency. This is why, when a system needs to handle more concurrent load without adding more latency, you generally need to add throughput capacity (more servers, more parallelism) — you can't just wish concurrency away.

A very common trade-off: **batching** requests together (e.g., writing 100 database rows in one batch instead of 100 separate calls) increases overall throughput, because you save on per-request overhead — but it increases the latency each individual request experiences, since it now has to wait for the batch to fill up before being processed. Whether that trade is worth it depends entirely on whether your use case cares more about how fast one specific action feels (checkout button) or how much total volume the system can push through (a nightly batch analytics job).

## 1.7 Consistent Hashing

Distributed caches and databases need a rule for deciding *which* server owns a given piece of data. The naive approach is `hash(key) % number_of_servers` — hash the key to a number, and take the remainder when divided by however many servers you currently have. This works fine until the number of servers changes.

Here's the problem: if you go from 4 servers to 5, the `% number_of_servers` part of that formula changes for almost every key, which means almost every key now maps to a different server than before. In a cache, that's catastrophic — nearly the entire cache is invalidated in one shot, and every one of those keys causes a cache miss, dogpiling your database with the traffic the cache was supposed to be absorbing. In a sharded database, it means nearly all your data would need to be physically moved to different machines just because you added one more machine.

**Consistent hashing** solves this by hashing servers and keys onto the *same* circular space (commonly visualized as a ring, from 0 up to some large maximum value, wrapping back to 0). Each server gets a position on the ring based on hashing its identifier. Each key also gets a position on the ring based on hashing the key itself. The rule for ownership: a key belongs to the first server you encounter walking clockwise from the key's position.

```text
          server A (pos 10)
          /              \
   server D (pos 300)    server B (pos 90)
          \              /
          server C (pos 200)

   key "user:42" hashes to position 130
   -> walk clockwise from 130 -> lands on server C
```

The payoff: when you add a new server to the ring, it only takes over the keys in the narrow slice of the ring between itself and the next server counter-clockwise from it — roughly `1/(N+1)` of the total keyspace, where N is the previous number of servers. Everything else on the ring is untouched. Removing a server has the same limited blast radius — only the keys it owned need to move, and they move to the very next server clockwise.

One practical wrinkle: with only a few servers placed randomly on a ring, the slices each server owns can be wildly uneven — one server might get a huge arc and another a tiny sliver, causing uneven load. The fix is **virtual nodes**: instead of placing each physical server once on the ring, you place it at many positions (say, 100-200 virtual points scattered around the ring). This smooths out the distribution dramatically, and it has a nice side effect for replication too — data is typically replicated by continuing clockwise past the primary owner and storing copies on the next few *distinct physical* servers encountered.

The gotcha, and when this matters: consistent hashing is specifically a tool for *stateful* routing — distributed caches, sharded storage, and anything where "which server owns this piece of data" needs to stay stable as the cluster resizes. For plain stateless request routing (any server can handle any request), a normal load balancer with round robin or least-connections is simpler and consistent hashing is overkill.

## 1.8 CAP Theorem

The **CAP theorem** describes a hard limit that applies to any distributed system that stores data across more than one node: when a network partition happens — some nodes can't talk to others, even though each individual node is still alive — the system has to choose between staying fully consistent and staying fully available. It cannot fully guarantee both at that moment.

Let's define the three letters precisely, because the definitions are easy to fudge:

- **Consistency (C)**: every read gets the most recent write, or an error — never stale data presented as if it were current.
- **Availability (A)**: every request to a non-failing node gets *some* response — it might not be the freshest data, but the node doesn't refuse to answer.
- **Partition tolerance (P)**: the system keeps working according to some defined behavior even when network messages between nodes are delayed or dropped.

The key insight that trips people up: partition tolerance isn't really a choice you get to opt out of. Real networks drop packets, links fail, data centers lose connectivity to each other — partitions *will* happen. So the theorem isn't really "pick 2 of 3" in a free sense; it's closer to "partitions are a fact of life, so during a partition, pick C or A" — because you genuinely cannot deliver both at once when nodes can't communicate. Do you let a node answer with data that might be stale (favoring availability), or do you have it refuse to answer until it can confirm it has the latest data (favoring consistency)?

This gives two practical categories of systems:

- **CP systems** refuse to serve a request rather than risk returning wrong data during a partition. This is the right choice for things like payments, inventory counts, or access-control checks — situations where returning an outdated "yes you have permission" or "yes, that item is in stock" could cause real harm, so an honest error is safer than a confident wrong answer.
- **AP systems** keep answering even during a partition, accepting that the answer might be a few seconds or minutes stale, and sort out any conflicts once the partition heals. This suits things like a social media feed, a shopping cart, or a search index — cases where showing slightly stale data is a minor inconvenience, but refusing to load the page at all is a worse user experience.

("CA" systems, which claim both consistency and availability, only make sense in a world with no partitions — which doesn't describe any real distributed system running over an actual network, so this option is mostly a theoretical footnote.)

A useful extension beyond CAP is **PACELC**: it points out that even when there's *no* partition happening, you still face a trade-off — between Latency and Consistency (the "ELC" part). Reading from the nearest local replica is fast but might be slightly stale; confirming with a remote node guarantees freshness but costs latency. So the C-vs-A tension doesn't disappear once the network is healthy — it just changes shape into a C-vs-latency tension.

The practical takeaway for design work: don't just slap a "CP" or "AP" label on your whole system and call it done. Different pieces of the same system often make different choices — a checkout flow might be strict and CP (never oversell inventory), while the product recommendation panel on the same page is happily AP (a slightly stale recommendation is harmless). Identify which specific operations cannot tolerate staleness, and let those drive the decision, rather than picking one label for the entire architecture.

## 1.9 Failover

**Failover** is the mechanism by which a system automatically switches from a failed component to a healthy backup, so that a single failure doesn't turn into an outage the user actually notices. Where "redundancy" and "availability" describe the *goal* (having a backup, staying up), failover describes the *action* — the actual moment-to-moment process of detecting a failure and routing around it.

The most common underlying mechanism is a **heartbeat**: the backup (or a separate monitor) continuously pings the primary, expecting a steady pulse of "I'm alive" responses. When that pulse stops for longer than some threshold, the system concludes the primary has failed and triggers the switch to the backup. Some setups do this switch fully automatically; others require a human to confirm before traffic moves, trading a bit of speed for a safety check against false alarms (a network blip that looks like a failure but isn't).

Two setups are common, mirroring the redundancy patterns from the availability section:

- **Active-passive failover**: one primary handles all traffic; a standby sits ready but idle. When the primary fails, the standby takes over. The delay before it's fully up depends on how "warm" that standby was kept — a cold standby needs to boot up and load state (slow), a warm standby is running but not receiving traffic (medium), and a hot standby is already receiving a mirrored stream of traffic or data and can take over almost instantly.
- **Active-active failover**: multiple nodes are already handling live traffic simultaneously. If one fails, it's simply removed from rotation, and the others absorb its share of the load — there's no dramatic "switch" moment at all, just a graceful redistribution.

A concrete example: a database with one primary (accepting writes) and one replica (streaming a copy of every write). If the primary's disk fails, a heartbeat monitor notices within seconds, promotes the replica to be the new primary, and updates the application's connection string (often via DNS or a virtual IP) to point at it. Requests in flight during that window might briefly error out, but the system is back to accepting writes within seconds to minutes rather than being down until someone manually rebuilds the failed server.

A detail that's easy to overlook: **failback** — the process of returning to the original primary once it's repaired — needs just as much care as the initial failover. If failback is done carelessly (say, blindly flipping traffic back without first re-syncing any data written during the outage), you can silently lose or overwrite writes that happened while the backup was in charge.

The gotcha: failover only works if it's actually been tested. A standby that's never been exercised in a real failure drill is a common source of embarrassing incidents — the backup config has quietly drifted out of sync, or a permission is missing, and none of it is discovered until the one moment it's actually needed. "Chaos engineering" practices (deliberately killing the primary in a controlled test) exist specifically to catch this before a real outage does.

## 1.10 Fault Tolerance

**Fault tolerance** is a system's ability to keep functioning correctly even while some of its components are actively failing — not "recovers quickly after a failure" (that's closer to reliability's MTTR), but "keeps working *through* the failure, often without the user noticing anything happened at all."

It's closely related to, but distinct from, availability: availability is the measured *outcome* (a percentage of uptime), while fault tolerance is one of the *mechanisms* that produces that outcome. A system built with real fault tolerance is usually what makes a high availability number achievable in the first place, but you can theoretically have high measured availability from a system that just got lucky and never had a component fail yet — fault tolerance is what happens by design when something does fail, not just what you observe when nothing has.

The core technique is redundancy of the *function*, not just the hardware — multiple systems capable of independently doing the same job, so any one of them failing still leaves the job getting done. Examples: two or three copies of a database (a primary plus standby replicas) so a disk failure on one doesn't lose data or availability; several instances of a stateless service (often orchestrated by something like Kubernetes, which automatically restarts or replaces a crashed instance); and redundant power supplies or network links in physical data centers, so one power failure doesn't take a whole rack offline.

There's a genuine design fork in how a fault-tolerant system behaves once something breaks:

- **Full fault tolerance / masked failure**: the system keeps operating exactly as if nothing happened — the user sees zero difference. This is expensive: it typically requires extra capacity sitting idle (or duplicated work happening in real time) purely as insurance.
- **Graceful degradation**: the system keeps the *critical* functions working but sheds non-critical ones under stress — for example, an e-commerce site keeps checkout working during a partial outage but temporarily disables personalized recommendations or reviews. This is considerably cheaper and is the more common real-world choice.

Systems are also often described by the *scope* of failure they're built to survive, in increasing order of ambition: tolerating a single node dying, tolerating an entire data center going offline, tolerating an entire cloud region failing, and (rarest and most expensive) tolerating an entire cloud provider being unavailable. Very few companies actually need to build for that last tier — it's worth being honest about which tier your system genuinely needs rather than defaulting to the most extreme option.

The gotcha, and where this ties back to Stage 2 estimation-style thinking from the wider course: fault tolerance is never free. Every layer of redundancy is infrastructure that sits there most of the time doing nothing but insurance. The right question isn't "how fault-tolerant can we possibly make this," it's "what's the actual cost of downtime here (lost revenue, damaged trust, safety risk), and does that cost justify the ongoing expense of the redundancy needed to prevent it?" A internal admin tool used by five employees does not need the same fault tolerance budget as a payments system processing millions of transactions a day.

## 1.11 Summary and how these connect

Step back and these nine ideas form a single story rather than nine separate facts. **Scalability** is about growing a system's capacity without hitting a wall. **Availability** and **reliability** are the two different qualities you're trying to protect while you scale — one about uptime, one about correctness — and they require different fixes even though they sound similar. **SPOF** identification is how you find the weak links threatening both of those qualities, and **failover** plus **fault tolerance** are the concrete mechanisms — heartbeats, standbys, redundancy, graceful degradation — that turn "we found a weak link" into "the weak link no longer takes the system down."

The last three topics are the tools that make all of the above possible once a system spans multiple machines. **Latency, throughput, and bandwidth** give you the vocabulary to measure whether scaling efforts are actually working, and where the real bottleneck lives. **Consistent hashing** is a specific, elegant technique for spreading data across a horizontally-scaled, fault-tolerant fleet without a full reshuffle every time a machine joins or leaves. And the **CAP theorem** is the honest reminder that once your fault-tolerant, horizontally-scaled system spans a real network, you cannot dodge the consistency-versus-availability trade-off during a partition — you can only choose, deliberately, which side of it fits each specific operation.

Every later lesson in this course, and every "design X" problem in the companion course, is really just this vocabulary applied to a specific product. When you see a lesson add a database replica, that's availability and fault tolerance in action. When you see it shard data across servers, that's scalability meeting consistent hashing. When you see it justify accepting stale reads for a social feed, that's the CAP theorem's AP choice, made explicit. The next module, on networking fundamentals, moves one level down the stack — from "what qualities do we want" to "what actually carries a request from a client's browser to a server and back," which is the plumbing all of these concepts run on top of.
