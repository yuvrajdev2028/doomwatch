# Doomwatch: Collector & Storage Architecture & Enhancements

**Date & Time:** November 10, 2026, 01:20:45 IST  
**Document Version:** 1.0  
**Status:** Architecture Specification & Decisions  

---

## 1. Trace Sampling & Rate Limiting

### 1.1 The Core Problem
In low-traffic environments (10–50 requests/sec), collecting 100% of spans is feasible. However, in production at scale (e.g., 5,000–50,000 requests/sec with 10 spans per request):
* **Ingestion Volume**: 50,000 req/s $\times$ 10 spans = **500,000 spans/sec**.
* **Bandwidth & Storage**: At ~1 KB per span, that is **500 MB/sec $\approx$ 43 TB/day**.
* **Diminishing Returns**: 99% of those traces are identical, successful `200 OK` health checks and mundane queries that offer zero diagnostic value.

To make observability economically and computationally viable, you must sample.

---

### 1.2 Head-Based vs. Tail-Based Sampling

There are two primary paradigms in distributed tracing:

```mermaid
flowchart TD
    subgraph HeadBased["Head-Based Sampling (Decided at Ingress)"]
        H_Root["Root Span (Frontend / Gateway)"] -->|Hash trace_id % 100 < 5%| H_Decision{"Sampled?"}
        H_Decision -->|Yes (traceparent flag: 01)| H_Record["All downstream services record spans"]
        H_Decision -->|No (traceparent flag: 00)| H_Drop["All downstream services drop spans"]
    end

    subgraph TailBased["Tail-Based Sampling (Decided at Collector)"]
        T_Services["Services send 100% spans to Collector Buffer"] --> T_Collector["Collector Ring Buffer (holds trace for 3-5s)"]
        T_Collector --> T_Eval{"Evaluate Whole Trace"}
        T_Eval -->|Has 4xx/5xx error?| T_Keep["Keep 100%"]
        T_Eval -->|Duration > 1,000ms?| T_Keep
        T_Eval -->|VIP Tenant or Route?| T_Keep
        T_Eval -->|Normal 200 OK?| T_Sample["Sample at 1%"]
        T_Keep --> T_Storage["Persist to Database"]
        T_Sample --> T_Storage
    end
```

| Dimension | Head-Based Sampling | Tail-Based Sampling |
| :--- | :--- | :--- |
| **Where Decision Occurs** | At the very first service (root span / API gateway). | At the Doomwatch Collector after the trace finishes. |
| **How Context Propagates** | W3C `traceparent` flags: `01` (sampled) vs `00` (not sampled). Downstream services see `00` and do not emit spans. | Services emit spans; collector buffers and evaluates the complete trace. |
| **Resource Savings** | **Maximum savings**: Saves CPU in microservices, reduces egress network bandwidth, reduces collector ingestion load. | **Storage savings only**: Services and network still process spans; collector discards uninteresting traces before saving to disk. |
| **Anomalies / Errors** | **Blind to downstream errors**: If a trace was sampled out at the root, and step 4 throws a 500 or takes 15 seconds, **it is lost forever**. | **100% error and latency retention**: Guarantees you never miss a bug, crash, or slow transaction. |

---

### 1.3 Recommended Strategy: Hybrid Sampling
1. **At the SDK Level (Head-Based Default)**:
   * Endpoints like `/health`, `/metrics`, or static assets are sampled at `0.1%` or `0%`.
   * Standard business routes sample at a configurable rate (e.g., `10%`).
2. **At the Collector Level (Tail-Based Safety Net)**:
   * The Collector's `SpanBuffer` maintains a short-lived sliding window (e.g. 5 seconds).
   * **Rule 1 (Errors)**: If any span in a trace has `has_error: true` or `status_code >= 400`, persist the **entire** trace.
   * **Rule 2 (Latency Outliers)**: If the trace duration exceeds a threshold (e.g. $> 1,000\text{ms}$ or $p99$), persist it.
   * **Rule 3 (Probabilistic baseline)**: Retain 5% of normal, successful traces for baseline latency percentiles.

---

## 2. TTL (Time-to-Live) & Data Retention

### 2.1 The Problem
Trace data has high immediate value (debugging an issue that happened 10 minutes ago) but rapidly decaying long-term value (nobody queries individual `200 OK` traces from 3 weeks ago). Without automated data pruning, database disks quickly exhaust.

### 2.2 Retention Mechanisms

#### Option A: MongoDB TTL Indexes (Simplest for Small/Medium Scale)
MongoDB provides built-in TTL indexes that run a background thread every 60 seconds:
```javascript
// Index on the span start timestamp with an N-day expiration
db.spans.createIndex(
  { "start_time_date": 1 }, 
  { expireAfterSeconds: N * 86400 }
);
```
* **Limitation at High Scale**: At high throughput (millions of documents), MongoDB's background TTL thread deletes documents one-by-one. This causes high WiredTiger write I/O, heavy page rewriting, and storage fragmentation.

#### Option B: Rolling Time-Partitioned Collections (High Performance)
Instead of deleting individual rows, bucket spans into daily collections:
* `spans_2026_11_10`
* `spans_2026_11_09`
* `spans_2026_11_08`

When data exceeds the retention window (e.g., $N$ days):
```javascript
// Instantaneous O(1) metadata operation, zero disk fragmentation:
db.spans_2026_11_01.drop();
```
The Collector queries across active days using MongoDB views or application-level collection routing based on query timestamp bounds.

---

## 3. Ingestion Security & Access Control

Currently, the Collector's `POST /v1/traces` endpoint is open. In production, this introduces vulnerabilities:
* **Denial of Service (DoS)**: Attackers or buggy SDK client loops can flood the collector with gigabytes of garbage data.
* **Tenant Spoofing**: Service A could submit traces pretending to be Service B.

### 3.1 Security Blueprint

```
Client / Service ──> [ Reverse Proxy / Ingress ] 
                         │
                         ├─ 1. Validate 'X-Doomwatch-Key' (Write Key vs Read Key)
                         ├─ 2. Token Bucket Rate Limiter (Max 5,000 spans/sec per key)
                         ├─ 3. Content-Length & JSON Body Size Guard (Max 5MB)
                         │
                         ▼ (Authorized & Sanitized)
                     [ Collector Ingestion API ]
```

1. **Dual-Key Architecture**:
   * **Ingestion Key (`dw_ingest_...`)**: Write-only permission for SDKs (`POST /v1/traces`). Cannot read or query traces.
   * **Query Key (`dw_read_...` or Admin JWT)**: Read-only or Admin permission for dashboard and analytics APIs (`GET /v1/traces`).
2. **Payload Protection**:
   * Reject payloads exceeding `5MB` with `413 Payload Too Large`.
   * Enforce `max_spans_per_batch = 1,000` to prevent memory exhaustion in the JSON parser.
3. **Rate Limiting**:
   * Implemented via an in-memory token bucket or Redis rate limiter. If a misconfigured microservice spams spans, return `429 Too Many Requests` before it impacts database performance.

---

## 4. Alternative Storage Backends (ClickHouse vs. Elasticsearch)

While MongoDB is great for getting started due to its flexible BSON document model, all modern telemetry platforms eventually move to columnar storage (ClickHouse).

### Why MongoDB Hits a Bottleneck with Traces:
1. **Row-Oriented BSON**: Storing millions of documents duplicates field names (`trace_id`, `service_name`, `duration_ms`) on disk for every span.
2. **Slow Aggregations**: Computing $p50$, $p95$, and $p99$ latencies requires MongoDB to scan entire documents from disk into memory.
3. **Poor Compression**: BSON documents typically compress at only $1.5\times$ to $2\times$.

---

### Storage Backend Comparison

| Feature | MongoDB (Current) | Elasticsearch / OpenSearch | ClickHouse (Industry Standard) |
| :--- | :--- | :--- | :--- |
| **Storage Architecture** | Document store (BSON, row-oriented) | Inverted index (Lucene) | Columnar DBMS (Vectorized query engine) |
| **Data Compression** | Low ($2\times$) | Medium ($3\times$–$4\times$) | **Extreme ($10\times$–$20\times$)** using ZSTD/LZ4 |
| **Aggregation Speed ($p99$)** | Slow on large datasets | Moderate | **Blazing fast** (reads only the `duration_ms` column) |
| **Full-Text Statement Search** | Regex / Text Index (Slow) | **Industry Best** (Lucene inverted index) | Good (using token bloom filters and minmax indexes) |
| **RAM / CPU Footprint** | Moderate | Very High (JVM heap heavy) | Low to Moderate (C++ native) |
| **TTL Eviction Cost** | High (row-by-row deletion) | Moderate (Index lifecycle management) | **Near zero** (drops columnar partitions on disk) |
| **Used By** | Early stage startups | Elastic APM, Jaeger (v1) | **Signoz, Sentry, Datadog, Uber, Cloudflare** |

---

## 5. Architectural Decisions for Doomwatch

Based on evaluation of the current project stage (Proof-of-Concept / v1), the following architectural decisions are established:

### Decision 1: Defer Sampling & Ingestion Rate Limiting to v2
* **Rationale**: This is a POC v1. The priority is establishing a robust, functional core telemetry pipeline with full trace fidelity. Introducing complex sampling algorithms (head/tail buffering) and rate limiters adds premature complexity.
* **Action**: Ingest 100% of spans in v1. Defer sampling and rate limiting to v2.

### Decision 2: Implement Configurable MongoDB TTL for v1
* **Rationale**: Long-running tests or local deployments can easily fill disk space with stale traces. A simple, native MongoDB TTL index on trace timestamps prevents disk bloat with minimal code changes.
* **Specification**:
  * Implement an $N$-day retention policy in `MongoStorageEngine`.
  * $N$ must be a configurable positive number (via environment variable `DOOMWATCH_TTL_DAYS` or config file).
  * **Default setting**: `0` or `null` (disabled / no TTL) to prevent unexpected data loss out of the box.
  * Validation: Reject negative or non-numeric values gracefully.

### Decision 3: Defer Advanced Storage & Security Features to v2
* **Rationale**: While rolling time-partitioned collections, API key authentication, and alternative storage engines (ClickHouse / Elasticsearch) are clearly superior for large-scale enterprise deployments, they are out of scope for a v1 POC.
* **Action**:
  * Rolling time-partitioned collections $\rightarrow$ **Deferred to v2**.
  * Dual-key ingestion security & authentication $\rightarrow$ **Deferred to v2**.
  * ClickHouse and Elasticsearch storage engines $\rightarrow$ **Deferred to v2**.
