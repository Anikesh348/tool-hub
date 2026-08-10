> **Learning goal**
> Design a multi-tenant e-commerce platform like Shopify, able to compare tenant-isolation strategies, explain how per-store customization is served without forking code per merchant, and handle storefronts with wildly different traffic levels on shared infrastructure.

## 26.1 Requirements and scope

**Functional requirements**

- A merchant can create a store, configure its theme/branding, and list products.
- Each store gets its own public storefront (custom domain or subdomain) that customers browse and buy from.
- Merchants manage orders, inventory, and basic store settings through an admin dashboard.
- The platform supports many independent merchants ("tenants") on shared infrastructure, each with completely separate data.

**Non-functional requirements**

- **Strict data isolation between tenants.** A bug that leaks one merchant's orders or customer data to another is close to the worst possible failure for this kind of platform — this requirement dominates almost every decision in this lesson.
- **Fair resource sharing.** One merchant running a flash sale (a "traffic spike" tenant) must not degrade service for every other merchant sharing the same infrastructure — this is sometimes called the "noisy neighbor" problem.
- **Customizability without forking.** Merchants need visually and functionally different storefronts, but the platform can't maintain a separate codebase per merchant — customization has to be data-driven.
- Storefronts must stay available and reasonably fast even during large, unpredictable per-tenant spikes (a single merchant going viral).

**Out of scope**

- Payment processing internals (assume it's handled by an external processor, as covered in a later lesson).
- The visual theme editor / drag-and-drop UI itself.
- App marketplace / third-party app ecosystem.

## 26.2 Scale estimation

Assumptions for a platform hosting many independent stores:

- 2 million active merchant stores.
- Store size distribution is extremely skewed: assume 95% of stores are small (under 100 orders/month), 4% are medium, and 1% are large (some doing more traffic than most standalone e-commerce sites). This long-tail skew is the central fact that shapes the whole design — a uniform "give every tenant the same fixed resources" approach would be enormously wasteful for the 95% and inadequate for the 1%.
- Average of 500 storefront page views/store/day across the platform (weighted heavily toward the top tenants) → 2M × 500 = 1 billion views/day ≈ 11,500 req/s average, with the top 1% of stores plausibly generating 50%+ of that traffic.
- Average order volume: 50,000 orders/day platform-wide from small/medium stores combined, plus large spikes from big merchants' flash sales that can temporarily multiply a single store's order rate by 50-100x for a few hours.

**Storage:**

- Product catalogs: 2M stores × average 200 products × 2 KB ≈ 800 GB platform-wide — modest in aggregate, but must be partitioned so that no single store's data operations (e.g., a bulk product import) can lock or slow down another store's data.
- Orders: assume 50,000 orders/day × 2 KB × 365 ≈ 36.5 GB/year platform-wide, again small in aggregate but needs per-tenant query isolation (a merchant should never accidentally be able to run a query that scans another merchant's orders).

**The key estimation insight for this problem isn't a single throughput number — it's the skew.** A platform where the busiest 1% of tenants generate the majority of traffic needs an architecture that treats tenants unequally on purpose (dedicated or heavily-cached resources for the biggest stores) while still keeping the long tail cheap to serve (shared, pooled infrastructure for everyone else). This directly motivates the isolation-strategy discussion in 26.5.

## 26.3 API and data model

**Core endpoints** (all implicitly scoped to a tenant, typically via subdomain or an auth token that encodes the store ID):

| Method & Path | Purpose | Request | Response |
| --- | --- | --- | --- |
| `POST /admin/stores/{storeId}/products` | Merchant adds a product | product fields | created product |
| `GET /storefront/{storeId}/products` | Customer browses store's catalog | — | product list |
| `POST /storefront/{storeId}/checkout` | Customer buys | cart + payment | order confirmation |
| `GET /admin/stores/{storeId}/orders` | Merchant views orders | — | order list |
| `PUT /admin/stores/{storeId}/theme` | Merchant updates storefront theme/config | theme JSON | updated config |

**Core entities:**

- `Store { id, name, domain, planTier, themeConfig(json) }`
- `Product { id, storeId, title, price, ... }`
- `Order { id, storeId, customerId, total, status }`
- `ThemeConfig` — a structured JSON/document describing layout, colors, and which storefront sections are enabled, resolved at request time to render the actual storefront (see 26.5).

Every tenant-owned table (`Product`, `Order`, and others) carries a `storeId`, and every single query against them is required — at the application or database-proxy layer — to include a `storeId` filter. This one convention, made structurally impossible to bypass, is the backbone of the isolation strategy described below.

**SQL vs. NoSQL, by access pattern:**

- **Orders and inventory** need transactional guarantees per store (an order and its inventory decrement must be atomic, exactly as in the general e-commerce lesson) — a relational database is the right fit, with `storeId` as a mandatory, indexed column on every table.
- **Theme/config data** is a flexible, per-store document that doesn't need joins or transactions with other data — a document/key-value store keyed by `storeId` fits naturally and lets merchants have wildly different config shapes without schema migrations.
- **Catalog data** sits in between: mostly relational (products belong to a store, have relationships to variants and orders) but with some flexible attributes — a relational database with a JSON column for flexible attributes is a common pragmatic compromise, avoiding the need for two separate systems just for product data.

## 26.4 High-level architecture

```text
Customer request (storename.platform.com or custom domain)
  -> DNS -> Load Balancer
       -> Routing layer (resolves domain -> storeId)
            -> Storefront Rendering Service
                 -> Theme Config Store (per-store JSON)
                 -> Catalog DB (filtered by storeId)
                 -> Cache (per-store page/fragment cache)
            -> Checkout Service (per-store order flow, isolated per tenant at the DB layer)

Merchant admin request
  -> Load Balancer -> Admin API -> same underlying DBs, always storeId-scoped

Data layer:
  Small/medium tenants -> shared DB clusters, logically isolated by storeId
  Large tenants -> dedicated DB shard (or dedicated cluster) for isolation + performance
```

**Read path (storefront browsing):** a request arrives at a domain that maps to a specific store; the routing layer resolves which tenant this is *before* anything else happens, and that `storeId` is threaded through every subsequent call. The Storefront Rendering Service fetches that store's theme config and catalog data (always filtered by `storeId`) and renders the page, using a per-store cache so that repeat views of a popular store's homepage don't re-hit the database every time.

**Write path (checkout, product edits):** identical in spirit to the general e-commerce checkout design (inventory reservation, payment, order creation), except every operation is additionally scoped to a `storeId`, and — critically — a large tenant's checkout traffic is routed to that tenant's own dedicated resources rather than sharing a connection pool with thousands of small tenants, so one merchant's flash sale can't exhaust database connections needed by everyone else.

## 26.5 Deep dive: multi-tenancy isolation, per-store customization, and uneven traffic

This is a platform problem more than a "how does a store work" problem — the storefront/checkout mechanics are the same as any e-commerce design; what's new here is running thousands to millions of *independent* versions of that mechanic safely and efficiently on shared infrastructure.

### Tenant isolation strategies

There are three standard approaches, each with a real trade-off — this table is the crux of the lesson:

| Strategy | Isolation strength | Operational cost | Best for |
| --- | --- | --- | --- |
| Shared schema, `tenantId` column on every row | Weakest (a missing `WHERE storeId=?` is a data leak) | Lowest — one schema, one set of migrations, cheap per tenant | The long tail of small tenants, where per-tenant overhead must be near zero |
| Separate schema per tenant, same database instance | Medium (queries are naturally scoped by schema, harder to leak by mistake) | Medium — migrations must run per schema, but no extra infrastructure per tenant | Medium tenants, or platforms wanting stronger isolation without full infra duplication |
| Separate database (or cluster) per tenant | Strongest (physically separate storage and connection pool) | Highest — real infrastructure and operational cost per tenant | The top tier of large tenants, where noisy-neighbor risk and blast radius must be minimized |

The insight that makes this deep dive interesting (rather than "pick one") is that **a real platform at this scale doesn't pick one strategy — it picks per tenant, based on that tenant's tier**, exactly matching the skewed distribution from Stage 2. The 95% of small stores live in a shared-schema model where per-tenant overhead is close to zero and `storeId` filtering is enforced centrally (ideally at a data-access layer or via row-level security features in the database, not left to each individual query author to remember). As a store crosses growth thresholds, it can be migrated to its own schema, and the very largest merchants get a dedicated database (or even a dedicated application-tier deployment) where their traffic physically cannot compete with anyone else's for resources. This tiered approach is what lets the platform be cheap enough to onboard a hobbyist store for free while still safely hosting a merchant doing enterprise-level volume.

Enforcing the `storeId` boundary is worth dwelling on, because "just remember to filter by storeId" is exactly the kind of rule that gets violated under deadline pressure and causes real data leaks. The safer pattern is to make the boundary structural rather than a coding convention: a data-access layer that automatically injects the current request's `storeId` into every query (so a developer writing a new endpoint can't forget it even if they try), or database-native row-level security tied to the authenticated tenant context. Code review and testing help, but the goal is a system where a single missed `WHERE` clause is architecturally impossible, not just unlikely.

### Per-store customization without forking

Merchants need visibly different storefronts (different themes, layouts, enabled sections like "featured collection" or "customer reviews") without the platform maintaining separate application code per merchant. The mechanism is a **theme configuration document** per store — a structured, versioned JSON/document object describing which template is used, what sections appear in what order, color/branding values, and any store-specific text. The Storefront Rendering Service is a single, shared piece of code that takes `(storeId, request)` and renders a page by reading that store's theme config and applying it against a fixed set of platform-provided templates and section types. Customization becomes a data problem (what does this store's config document say) rather than a code problem (does this store need its own deployment), which is what makes it possible to serve millions of visually distinct storefronts from one codebase.

### Handling wildly uneven traffic

Because a tiny fraction of stores generate the bulk of traffic, and any store can spike unpredictably (a viral product, a marketing email blast), the platform needs both steady-state fairness and burst tolerance:

- **Steady-state fairness:** per-tenant rate limiting and connection-pool quotas in the shared-schema tier prevent one busy small/medium tenant from starving others sharing the same database cluster — the same mechanism covered in depth in the rate-limiter lesson, applied here per `storeId` instead of per user.
- **Burst tolerance:** aggressive per-store caching (rendered storefront pages, product listings) absorbs read spikes without hitting the database at all for the vast majority of requests during a traffic surge, since storefront content changes far less often than it's viewed. For write-heavy spikes (a flash sale's checkout traffic), the same inventory-reservation and saga pattern from the e-commerce lesson applies per store, and — for the largest tenants — dedicated infrastructure means their spike physically cannot degrade any other tenant's experience, only their own.

## 26.6 Bottlenecks and trade-offs

- **Single points of failure.** A shared database cluster hosting thousands of small tenants is a much larger blast radius than a typical single-tenant outage — if it goes down, every tenant on it goes down simultaneously. Mitigation: standard replication/failover, but also deliberately capping how many tenants (and how much aggregate traffic) any one shared cluster hosts, so an outage's blast radius has a ceiling.
- **Hot spots.** The clearest hot-spot risk in this whole design is a single small/medium tenant unexpectedly going viral while still living in the shared-schema tier — their sudden spike can degrade every other tenant sharing that cluster. Mitigation: automated tier promotion (detect sustained traffic well above a tenant's historical baseline and migrate them to isolated resources proactively, not just after an incident).
- **Consistency vs. availability.** Per-tenant data (orders, inventory) needs the same strong consistency as any e-commerce checkout flow; but cross-tenant concerns like platform-wide analytics or search across all stores can be eventually consistent, since no single storefront's correctness depends on them.
- **What breaks first at 10x/100x scale:** at 10x, the shared-schema tier's connection pools and noisy-neighbor isolation get stressed first, pushing more medium tenants into dedicated schemas earlier than originally planned. At 100x, the routing/domain-resolution layer (which must map every incoming request's domain to a `storeId` before anything else can happen) and the tiering/promotion automation itself become the bottleneck — deciding *which* tenants need dedicated resources, and doing so fast enough, becomes as hard an engineering problem as serving the storefronts themselves.

## 26.7 Summary

The distinctive problem in a multi-tenant e-commerce platform is not building one store — it's safely and efficiently hosting an enormous, highly skewed population of independent stores on shared infrastructure. Isolation is handled with a tiered strategy (shared schema for the long tail, dedicated schemas or databases for the largest tenants) rather than one-size-fits-all, customization is handled as a data-driven theme configuration rather than per-merchant code, and uneven traffic is handled with per-tenant rate limiting, aggressive caching, and proactive tier promotion for tenants that outgrow the shared tier.

Natural follow-ups: how would you support a merchant migrating from the shared-schema tier to a dedicated database with zero downtime (typically a background data-copy plus a brief cutover window), and how would you design the platform-wide search/analytics feature that needs to query across all tenants despite the isolation boundaries built to keep them apart.
