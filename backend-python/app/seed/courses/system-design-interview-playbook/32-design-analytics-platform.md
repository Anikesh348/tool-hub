> **Learning goal**
> Design an analytics/observability platform (metrics and logging), able to explain a high-throughput event ingestion pipeline, how time-series data is stored and downsampled over time, and the trade-offs in aggregating data at query time versus ahead of time.

## 32.1 Requirements and scope

**Functional requirements**

- Services and applications emit metrics (numeric measurements over time, e.g., request latency, error count, CPU usage) tagged with dimensions (service name, host, region, endpoint).
- Users query metrics over arbitrary time ranges, aggregated by dimension (e.g., "p99 latency for service X in region Y over the last 6 hours").
- Users build dashboards of multiple such queries, refreshed periodically.
- Users configure alerts that fire when a metric crosses a threshold over a defined window.

**Non-functional requirements**

- **Ingestion must never be the reason data is lost or delayed**, even under extreme write load — the entire value of an observability system collapses if it can't reliably absorb the traffic from the systems it's monitoring, especially during an incident, which is exactly when write volume tends to spike (error counters climbing) and when the data is most needed.
- **Query latency must stay low even over long time ranges**, because dashboards and alerts both depend on fast aggregation, and a system too slow to query during an incident fails at its actual job.
- **Storage cost must scale sub-linearly with retention**, since raw, full-resolution data kept forever at high ingestion volume would be prohibitively expensive — this is what motivates downsampling (discussed in the deep dive) as a first-class part of the design, not an afterthought.
- Eventual consistency is acceptable for metrics (a dashboard a few seconds behind real-time is normal and expected); strict consistency is not a goal anywhere in this system.

**Out of scope**

- Distributed tracing (spans/traces across service calls) — a related but distinct data model from metrics, not designed here.
- Log search/full-text indexing (mentioned briefly, but the deep dive focuses on numeric time-series metrics, the harder and more distinctive part of "analytics platform").
- The alerting rule engine's UI and notification-channel integrations.

## 32.2 Scale estimation

Assumptions for a mid-to-large internal observability platform serving many services:

- 10,000 hosts/containers being monitored, each emitting 200 distinct metrics (CPU, memory, per-endpoint latency/error counts, etc.) at a 10-second reporting interval.
- Per-host, per-interval: 200 metrics/10 sec = 20 metrics/sec per host.
- Platform-wide ingestion: 10,000 hosts × 20 metrics/sec = **200,000 data points/sec** at steady state — this is the dominant number driving the whole architecture, analogous to the engagement-event volume in the TikTok lesson.

**Storage, naive (no downsampling):**

- Each data point: a timestamp, a metric name/tag-set identifier, and a value — assume ~16 bytes compactly encoded (timestamps and tag-sets are highly compressible when stored column-wise, discussed in the deep dive).
- 200,000 points/sec × 16 bytes × 86,400 sec/day ≈ 276 GB/day of raw data, or over 100 TB/year at full resolution — this number alone is the entire justification for downsampling: nobody queries "give me every individual 10-second data point from 8 months ago," so paying full storage cost to retain that resolution forever is pure waste.

**Query load:** assume 5,000 active dashboards, each with 10 panels refreshing every 30 seconds, plus continuous alert-rule evaluation (assume 50,000 active alert rules, each evaluated every 60 seconds) → roughly (5,000×10/30) + (50,000/60) ≈ 1,700 + 830 ≈ 2,500 queries/sec. Notably, alert evaluation alone is a similar order of magnitude to dashboard queries — an easy thing to underestimate, since alerting runs continuously and silently in the background rather than being driven by a human looking at a screen.

**Read:write ratio:** roughly 2,500:200,000, meaning writes actually dominate raw request volume here — a real departure from most lessons in this course, where reads dominate. This inverts the usual instinct ("cache aggressively for reads") and instead pushes the hardest design work toward the ingestion path and toward making storage itself efficient enough that both writes and the (still substantial) query load can be served without either one starving the other.

## 32.3 API and data model

**Core endpoints:**

| Method & Path | Purpose | Request | Response |
| --- | --- | --- | --- |
| `POST /metrics/ingest` | Emit metric data points (typically batched) | `[{name, tags, value, timestamp}, ...]` | 202 Accepted |
| `GET /query?metric=&tags=&from=&to=&aggregation=` | Query aggregated time-series data | query params | `[{timestamp, value}, ...]` |
| `PUT /dashboards/{id}` | Save a dashboard config | panel definitions | updated config |
| `POST /alerts` | Create an alert rule | `{metric, condition, windowSeconds}` | created rule |

**Core entities:**

- `MetricSeries { name, tags(key-value set) }` — the *identity* of a time series is the combination of metric name and its full tag set (e.g., `request_latency{service=checkout, region=us-east, endpoint=/pay}` is a distinct series from the same metric name with different tags). This is a crucial modeling point: the number of unique series ("cardinality") can explode if tags are used carelessly (e.g., tagging by a unique request ID), and that explosion is one of the most common real operational problems in systems like this.
- `DataPoint { seriesId, timestamp, value }` — the raw ingested unit.
- `RollupDataPoint { seriesId, bucketStart, bucketDuration, min, max, avg, count, sum }` — a downsampled aggregate, discussed in the deep dive.
- `AlertRule { id, metric, tagFilter, condition, windowSeconds, status }`

**SQL vs. NoSQL, by access pattern:**

The dominant access pattern is entirely different from anything else in this course: extremely high-volume **sequential, timestamp-ordered writes** (always appending "now"), and reads that are almost always **range scans over time for a specific series or set of series** ("give me this metric's values between time A and B"), never random point lookups by an arbitrary key and never relational joins across unrelated entities. This is precisely the access pattern that purpose-built **time-series databases** are designed for — they store data column-wise (values for a series stored contiguously, which compresses extremely well since consecutive metric values are often numerically close together) and partition data by time range, so that both "append the newest data" and "scan a time range" are cheap, sequential operations, similar in spirit to the message queue's append-only log but optimized specifically for numeric, timestamped, aggregatable data rather than opaque message payloads. A general-purpose relational database can technically store this shape of data but degrades badly at this ingestion rate and this query pattern; a generic key-value store lacks the built-in time-range scanning and aggregation primitives that make time-series-specific storage so much more efficient for this exact workload.

## 32.4 High-level architecture

```text
Ingestion path:
  Monitored hosts/services -> Local Agent (batches metrics) -> Ingestion Gateway
       -> Message Queue (absorbs bursts, decouples ingestion from storage)
       -> Stream Processor -> Time-Series Storage (raw, short retention)
                            -> Downsampling Jobs -> Rollup Storage (longer retention, lower resolution)

Query path:
  Client (dashboard/alert evaluator) -> Query Service
       -> routes to Raw Storage (recent, high-resolution) OR Rollup Storage (older, aggregated)
       -> merges + returns time-series result
```

**Write path:** each monitored host runs a lightweight local agent that batches its metrics locally for a short interval (e.g., a few seconds) before sending, which reduces the number of individual network calls dramatically compared to sending every single data point immediately — this batching is a cheap, high-leverage optimization given the 200,000 points/sec scale. The Ingestion Gateway accepts these batches and immediately hands them to a message queue (the same building block covered in the distributed-message-queue lesson) rather than writing directly to storage — this decouples "did we durably accept this data" from "has it been fully processed and stored," so a temporary slowdown in the storage layer doesn't cause data loss or backpressure all the way to the monitored hosts, it just causes the queue to (temporarily) grow.

**Storage/downsampling path:** a stream processor consumes the queue and writes raw data points into time-series storage at full resolution, but only for a relatively short retention window (e.g., a few days) — separate background downsampling jobs continuously roll older data up into coarser aggregates (e.g., one-minute, then one-hour, then one-day resolution) stored in a separate, longer-retention rollup store, which is dramatically smaller because it holds summary statistics per bucket instead of every individual point. This entire mechanism is the deep dive's main subject.

**Read path:** a query for a short, recent time range is served from raw high-resolution storage; a query spanning months is transparently served from the appropriate rollup tier instead, since nobody needs 10-second resolution for a 6-month trend line, and serving it from rollups is both faster and far cheaper. The Query Service is responsible for picking the right storage tier (or blending tiers, for a query that spans both recent raw data and older rolled-up data) so that the choice is invisible to the person writing the query.

## 32.5 Deep dive: high-throughput ingestion, downsampling, and query-time aggregation

### The ingestion pipeline under load

The central risk at 200,000 points/sec (with real spikes far higher during incidents, exactly when the data matters most) is that any synchronous, tightly-coupled path from "agent sends metric" to "metric is durably stored" will eventually fall behind and either drop data or apply backpressure all the way back to the monitored systems — which is especially bad because those systems are often already struggling during an incident and shouldn't also be blocked or slowed by their own monitoring agent failing to send data.

The fix, already sketched in 32.4, is to put a message queue between ingestion and storage, converting "must process this instantly" into "must eventually process this, and can absorb bursts in between." This buys the storage layer time to catch up after a spike without losing anything, at the cost of a small, usually invisible delay between when a metric is emitted and when it's queryable — an entirely acceptable trade-off given the non-functional requirement that observability data is eventually-consistent, not strictly real-time. Local batching at the agent level further reduces load on the ingestion tier itself, trading a few seconds of local buffering (a small risk: if a host crashes before its batch is sent, that batch is lost) for a large reduction in request volume — a reasonable trade given that losing a few seconds of one host's metrics during a crash is a minor gap, not a systemic failure.

### Downsampling and storage tiering

Downsampling is the mechanism that makes long retention affordable, and it works by trading resolution for compactness as data ages, on the observation that recent data is queried at high resolution (debugging what's happening *right now*) while old data is almost always queried in aggregate (trend lines, capacity planning, "how did this metric look a quarter ago"). A typical tiering scheme:

| Age of data | Resolution kept | Approx. storage relative to raw |
| --- | --- | --- |
| 0-7 days | Full resolution (every 10-second point) | 1x (baseline) |
| 7-30 days | 1-minute rollups (min/max/avg/count per minute) | ~1/6 of raw |
| 30-180 days | 1-hour rollups | ~1/360 of raw |
| 180+ days | 1-day rollups | ~1/8,600 of raw |

A rollup bucket typically stores more than just an average — min, max, average, count, and sum are all cheap to compute incrementally as raw points arrive and are all useful for different questions (a spike that got smoothed away by averaging is still visible in the max column, which matters enormously for something like "did latency ever spike above our SLA, even briefly," a question a pure average would silently hide). This is the single most important modeling detail in the whole downsampling scheme: naive downsampling that keeps only an average discards exactly the information (rare spikes, outliers) that observability systems exist to surface.

The downsampling jobs themselves run as ongoing background processes (not a one-time migration) — as raw data crosses the 7-day boundary, it's aggregated into 1-minute buckets and the raw points can then be deleted or archived to cold storage; the same pattern repeats at each subsequent boundary. This is analogous to garbage collection: continuous, incremental, and designed to never let any one tier's data volume run away unbounded.

### Query-time aggregation trade-offs

A query like "p99 latency for service X over the last hour, broken down by region" requires aggregating across potentially many individual host-level series (X might run on hundreds of hosts across several regions) — this aggregation can happen at query time (fetch all the raw per-host series and compute the percentile across them when the query runs) or it can be pre-aggregated ahead of time (continuously maintain a "service X, all hosts, by region" rolled-up series as data arrives, so a query against it is just a direct read).

This is a real trade-off, not a clearly-better option in either direction: query-time aggregation is flexible (any new way of slicing the data — a query nobody anticipated — just works, since it operates on raw or lightly-rolled-up data) but is more expensive per query, especially over long time ranges or high-cardinality dimensions, and that cost is paid every single time the query runs. Pre-aggregation (sometimes implemented as continuously-maintained rollup series matching known common query shapes, similar in spirit to a materialized view) is cheap to query but only covers the specific aggregations someone thought to define in advance — a query asking for a breakdown that wasn't pre-aggregated still falls back to the expensive raw-data path. Percentiles specifically (p50, p95, p99 — extremely common in latency dashboards) are notable because they don't combine simply across pre-aggregated buckets the way sums or counts do (you cannot correctly compute an overall p99 by averaging several buckets' individual p99s); systems that want accurate percentiles from rolled-up data typically store an approximate summary structure (like a compressed histogram) per bucket instead of a single percentile value, specifically so percentile queries remain meaningful after data has been aggregated. A practical real-world design usually does both: pre-aggregate the small set of dashboard/alert queries known to run constantly (since these dominate query volume, per the 2,500 queries/sec estimate, and benefit the most from being cheap), while keeping raw or lightly-rolled-up data available for the smaller volume of ad-hoc, exploratory queries that can tolerate being a bit slower.

## 32.6 Bottlenecks and trade-offs

- **Single points of failure.** The ingestion message queue is the most critical shared component — if it's unavailable, agents need a local buffering/retry strategy (with a bounded buffer, to avoid unbounded memory growth on the monitored host itself) rather than blocking or crashing the very services being monitored.
- **Hot spots.** A single metric with runaway cardinality (e.g., a tag accidentally set to a unique value per request, like a request ID) can explode the number of distinct series the storage layer must track, degrading performance for every other metric sharing that storage tier — this is the most common real operational failure mode for systems like this, and mitigating it usually means enforcing cardinality limits or tag-naming conventions at ingestion time, rejecting or flagging metrics that violate them before they ever reach storage.
- **Consistency vs. availability.** This system leans heavily toward availability and eventual consistency everywhere — a dashboard a few seconds stale, or an alert evaluated against slightly-lagged data, is the accepted norm, and there's no analog anywhere in this design to the strict, immediate consistency required by the inventory/booking-style lessons, because nothing here represents a scarce, contended resource that two actors could conflict over.
- **What breaks first at 10x/100x scale:** at 10x (2 million points/sec), the stream-processing and raw-storage write path is the first strain point, pushing toward more aggressive partitioning of the ingestion pipeline by metric name/service. At 100x, cardinality management becomes the dominant operational concern rather than raw throughput — with enough distinct services and tags in play, simply tracking "which series exist" becomes its own significant workload, and query planning (deciding which raw/rollup tier and which pre-aggregation, if any, best answers a given query) becomes a genuinely hard problem in its own right rather than a simple routing decision.

## 32.7 Summary

An analytics/observability platform is defined by write-dominant traffic (the opposite of most systems in this course) that must never be lost even under burst load, met with a queue-buffered ingestion pipeline that decouples "accepted" from "stored." Long-term storage is made affordable through continuous downsampling — trading resolution for compactness as data ages, while deliberately preserving min/max alongside averages so spikes aren't silently smoothed away. Query performance depends on choosing the right point on the pre-aggregation-versus-query-time-aggregation spectrum for a given query's frequency and predictability, with percentile metrics specifically requiring summary structures more sophisticated than a single rolled-up number.

Natural follow-ups: how would you extend this design to support log data (which is far higher volume, text-based, and needs full-text search rather than numeric aggregation — a genuinely different storage engine, usually run alongside rather than inside the metrics pipeline), and how would you build anomaly detection on top of this pipeline (typically consuming the same downsampled rollup streams rather than raw data, since trend-level signal is usually what anomaly detection needs, not full-resolution noise).
