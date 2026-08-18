> **Learning goal**
> Design an e-commerce store like Amazon, with a working catalog/search flow, inventory that never oversells under concurrent purchases, and a checkout process that stays consistent across inventory, payment, and shipping even when one of those steps fails.

## 24.1 Requirements and scope

**Functional requirements**

- Browse and search a product catalog (by keyword, category, filters like price range).
- View a product detail page with price, description, images, and current stock status.
- Add items to a cart.
- Check out: reserve inventory, charge payment, create an order, kick off shipping.
- View order history and order status.

**Non-functional requirements**

- **Correctness over raw speed for checkout.** Two customers must never both successfully buy the last unit of a product — overselling is a business and trust problem, not just a technical bug.
- **High availability for browsing and search.** If search is briefly stale (a product that sold out five seconds ago still shows as "in stock" until you click into it), that is acceptable. Browsing is read-heavy and eventual consistency is fine there.
- **Durability of orders.** Once an order is confirmed and paid, it must never be silently lost, even if a downstream service (shipping) is temporarily down.
- Reasonable latency: product pages and search should respond in a few hundred milliseconds; checkout can tolerate a bit more (a second or two) because it involves external payment calls.

**Out of scope**

- Recommendation/personalization engines ("customers also bought").
- Seller/marketplace onboarding tooling (assume products already exist in the catalog).
- Returns, refunds, and customer support workflows.
- Full-text search relevance tuning — we'll assume a search index exists and focus on how it's fed and queried, not on ranking algorithms.

## 24.2 Scale estimation

Assumptions, stated explicitly, for a large but not hyperscale retailer:

- 50 million monthly active users, 10 million daily active users (DAU).
- Each DAU views ~20 product pages and performs ~15 searches per session → 200M product-page views/day, 150M searches/day.
- 2% of DAU complete a checkout → 200,000 orders/day.
- Average order has 2 line items → 400,000 inventory-decrement operations/day.

**Traffic (requests/sec):**

- Product views: 200M / 86,400 ≈ 2,300 req/s average; peak (holiday sale, 5-10x) could hit 15,000-20,000 req/s.
- Search: 150M / 86,400 ≈ 1,700 req/s average.
- Checkouts: 200,000 / 86,400 ≈ 2.3 req/s average — tiny by comparison, but each one does much more work (multiple downstream calls) and correctness matters far more than for a page view.

**Storage:**

- Catalog: assume 100 million SKUs, ~2 KB of structured metadata each (title, description, attributes) → ~200 GB, easily fits a relational database with room to spare, or a document store if attributes vary wildly by category.
- Orders: 200,000/day × 2 KB/order × 365 days ≈ 146 GB/year — small, but must be durable and queryable by user and by order ID for years (returns, tax records).
- Images: assume 5 images per SKU at 200 KB each = 1 KB... actually 1 MB per SKU × 100M SKUs = 100 TB. This clearly belongs in object storage (e.g., S3-like blob storage) behind a CDN, not in the primary database.

**Bandwidth:** image-heavy pages dominate. If an average product page pulls 1 MB of images and we serve 2,300 pages/sec at peak ×5 = ~11,500/sec, that's over 11 GB/s at peak — this alone justifies a CDN in front of images, independent of anything else in the design.

**Read:write ratio:** browsing/search reads outnumber checkout writes by roughly 1,000:1. This single number is the strongest architectural signal in the whole problem: optimize aggressively for read scalability (caching, search indexes, read replicas), and treat checkout as a small, low-throughput but high-integrity path that deserves its own careful design rather than reusing the read-optimized stack.

## 24.3 API and data model

**Core endpoints:**

| Method & Path | Purpose | Request | Response |
| --- | --- | --- | --- |
| `GET /products/search?q=&category=&page=` | Search catalog | query params | list of product summaries |
| `GET /products/{id}` | Product detail | — | full product + stock status |
| `POST /cart/items` | Add to cart | `{productId, qty}` | updated cart |
| `POST /checkout` | Start checkout | `{cartId, shippingAddr, paymentToken}` | `{orderId, status}` |
| `GET /orders/{id}` | Order status | — | order + line items + status |

**Core entities:**

- `Product { id, title, description, price, category, attributes(json) }`
- `Inventory { productId, warehouseId, availableQty, reservedQty }`
- `Cart { id, userId, items: [{productId, qty}] }`
- `Order { id, userId, status, total, createdAt }`
- `OrderItem { orderId, productId, qty, priceAtPurchase }`
- `Payment { orderId, provider, status, amount }`

**SQL vs. NoSQL, by access pattern:**

- **Catalog metadata and search:** product attributes vary a lot by category (a shirt has size/color; a laptop has RAM/CPU), and the dominant access pattern is "search by arbitrary combination of fields," not multi-table joins. This is a good fit for a document store (flexible schema) for the catalog itself, paired with a dedicated search index (inverted index, e.g. Elasticsearch-style) that is rebuilt/updated asynchronously from catalog writes. Trying to serve full-text, faceted search directly out of a relational database works at small scale but degrades badly as catalog size and query complexity grow.
- **Inventory and orders:** this is the opposite pattern — a small number of well-defined tables, strict consistency requirements ("don't oversell"), and the need for atomic, multi-row transactions (decrement inventory *and* create an order row together, or neither). This is a textbook case for a relational database with ACID transactions. The temptation to use a NoSQL store here for "scale" should be resisted — checkout's write volume (2-3 req/s average) is nowhere near the level that requires giving up transactions, and giving them up is precisely what causes overselling bugs.

So the design intentionally uses two different databases for two different parts of the same product, each justified by its own access pattern rather than a single default choice applied everywhere.

## 24.4 High-level architecture

```text
Client (web/mobile)
  -> CDN (product images, static assets)
  -> Load Balancer
       -> API Gateway (auth, rate limiting)
            -> Catalog/Search Service --------> Search Index (read replica of catalog)
            -> Cart Service ---------> Cache (session cart) + Cart DB
            -> Checkout Service (orchestrator)
                 -> Inventory Service -> Relational DB (source of truth for stock)
                 -> Payment Service -> External Payment Gateway
                 -> Order Service -> Relational DB (orders)
                 -> Message Queue -> Shipping Service (async)
            -> Catalog write path: Admin/Seller tool -> Catalog DB -> async indexer -> Search Index
```

**Read path (browse/search):** a client hits search or a product page; these go through a cache (for hot product pages) and a dedicated search index (for search queries), both fed asynchronously from the catalog's source-of-truth database. This means a newly listed product might take a few seconds to appear in search — acceptable given the non-functional requirement that browsing tolerates staleness.

**Write path (checkout):** this is the interesting one and is treated as a short, tightly-coupled sequence rather than "fire and forget." A checkout request hits a **Checkout Service** that acts as an orchestrator: it calls Inventory to reserve stock, calls Payment to charge the customer, and only after payment succeeds does it finalize the order and hand off to Shipping (asynchronously, via a queue, since shipping doesn't need to happen inside the customer-facing request). Each of these steps can fail independently, which is exactly the problem the deep dive addresses.

## 24.5 Deep dive: inventory consistency and the checkout saga

This problem has two deeply related hard parts: **how do we stop two customers from buying the last unit of the same product**, and **how do we keep inventory, payment, and shipping consistent when checkout spans multiple services that can each fail independently?**

### Preventing overselling

The naive approach — read the current stock count, check if it's positive, then write a decrement — is a classic race condition. Two requests can both read `availableQty = 1`, both see "in stock," and both decrement, leaving `availableQty = -1` and two customers who paid for a unit that doesn't exist.

The fix is to never separate the check from the decrement. Two standard techniques:

1. **Conditional atomic update.** Instead of "read then write," issue a single SQL statement like `UPDATE inventory SET availableQty = availableQty - 1 WHERE productId = ? AND availableQty >= 1`. The database's row-level locking makes this atomic: only one of two concurrent requests can succeed in decrementing past zero, because the second one re-evaluates `availableQty >= 1` against the already-decremented value and gets zero rows affected. The application checks the affected-row count: 1 means success, 0 means "sold out," no application-level lock needed.
2. **Reservation with expiry.** For checkout flows that take multiple steps (add to cart, enter address, enter payment), holding a hard decrement for the whole flow is too aggressive — it would let a customer "lock" inventory just by starting checkout and abandoning it. Instead, use a soft reservation: `reservedQty` is incremented atomically (same conditional-update trick) when checkout begins, with a short TTL (e.g., 10-15 minutes). If checkout completes, the reservation converts to a real decrement of `availableQty` and the reservation is cleared. If checkout times out or is abandoned, a background job releases the reservation back to available stock. This is the same pattern used by concert-ticket and flight-seat systems (covered in a later lesson) — anywhere "hold, then commit or release" beats "lock indefinitely."

At the scale estimated above (2-3 checkouts/sec average, maybe a few hundred/sec during a flash sale on one hot item), a single relational database partition per product line handles this without needing distributed locks — the conditional-update trick is enough because the database's own transaction isolation does the hard work. If a single SKU becomes so hot that it alone exceeds one database's write throughput (a true doorbuster flash sale), that's a hot-spot problem addressed in 24.6.

### The checkout saga

Checkout touches at least three systems that cannot be updated in one atomic transaction because they're different services (and one, payment, is a third-party system entirely): Inventory, Payment, and Order/Shipping. Reserving inventory, then charging the card, then creating the order is a sequence where any step can fail after a previous one already succeeded — e.g., payment fails after inventory was reserved.

The standard pattern for this is a **saga**: a sequence of local transactions, each with a defined compensating action that undoes it if a later step fails.

```text
Step 1: Reserve inventory       (compensate: release reservation)
Step 2: Charge payment          (compensate: refund)
Step 3: Create order record     (compensate: cancel order)
Step 4: Enqueue shipping        (compensate: n/a, order already cancelled upstream)
```

Concretely: the Checkout Service reserves inventory first (cheap to undo, and no point charging a card for something we can't fulfill). If reservation fails (sold out), the flow stops immediately and the customer sees "out of stock" — no payment attempted. If reservation succeeds but payment fails (card declined, gateway timeout), the Checkout Service runs the compensating action: release the reservation, and the customer sees a payment error with their cart intact. Only after payment succeeds does the order get created and shipping enqueued; at that point the saga is "committed" and nothing rolls back — shipping failures become an operational/support issue, not a checkout-consistency issue, because the customer has already been correctly charged for goods that are reserved for them.

Idempotency matters throughout: the client might retry a checkout request after a network timeout, so the Checkout Service should accept an idempotency key (e.g., generated client-side per checkout attempt) and, on retry, return the result of the original attempt instead of double-charging or double-reserving. This is the same idempotency-key pattern used more deeply in the payment-system lesson later in this course.

## 24.6 Bottlenecks and trade-offs

- **Single points of failure.** The Inventory database is the most critical piece — if it's down, no checkout can complete anywhere in the system, even though browsing (served from cache/search index) keeps working fine. Mitigate with a primary-replica setup with automatic failover; the browsing path's cache/search layer already gives natural resilience since it doesn't depend on Inventory being instantly available.
- **Hot spots.** A single viral or doorbuster SKU concentrates all checkout write traffic onto one row (or one small partition) of the Inventory table, which can become a bottleneck even though total checkout traffic is otherwise low. Mitigations: pre-split hot SKUs across multiple "shard" rows (e.g., `availableQty` split across N counters that each absorb 1/N of the traffic, reconciled periodically), or queue purchase attempts for that SKU and process them serially rather than let them all hit the database simultaneously.
- **Consistency vs. availability.** The design deliberately picks different points on this spectrum for different parts of the system: browsing/search favors availability and accepts staleness; inventory/checkout favors consistency and accepts that, under extreme load, some requests get rejected ("try again") rather than risk overselling. This split — not a single system-wide choice — is the main design insight of this lesson.
- **What breaks first at 10x scale:** the search index and product-page cache scale horizontally without much trouble (they're read replicas of derived data). The Inventory database's write path is what breaks first, particularly during flash sales, because it's intentionally the strongly-consistent bottleneck. At 100x scale, the catalog itself may need to move from a single document store to a sharded one by category or seller ID, and the search index needs its own horizontal scaling (index sharding), independent of the catalog's own storage.

## 24.7 Summary

An e-commerce store splits cleanly into a read-heavy, availability-favoring browsing/search path and a low-throughput, consistency-critical checkout path — and the entire design flows from recognizing that split early. Overselling is prevented not by application-level locks but by atomic conditional updates and short-lived reservations with expiry. Checkout across independent services (inventory, payment, shipping) is handled as a saga: ordered steps with compensating actions, so a mid-flow failure never leaves the customer charged for nothing or holding inventory nobody billed them for.

Natural follow-ups an interviewer might raise: how would you support multiple warehouses and route an order to the nearest one with stock (adds a routing/allocation step before reservation), and how would you handle a flash sale where demand for one SKU is 1,000x normal (sharded counters, a waiting-room queue in front of checkout, or both).
