# Doomwatch: Deferred Features & Technical Roadmap for v2

**Date & Time:** November 10, 2026, 01:20:45 IST  
**Document Version:** 1.0  
**Status:** Backlog & Scope Boundary Management  

---

## 1. Overview & Scope Philosophy

To ensure **Doomwatch v1** remains a lean, reliable, and easily verifiable Proof of Concept (POC), several advanced architectural features have been intentionally deferred. 

This document serves as the single source of truth for all architectural components, drivers, and scalability optimizations slated for **Version 2 (v2)**.

---

## 2. Itemized Deferred Features for v2

### 2.1 Async Messaging & Queue Instrumentation
* **Scope**:
  * Tracing through asynchronous message brokers: **Apache Kafka**, **RabbitMQ (AMQP)**, **AWS SQS / SNS**, and **Redis Streams**.
  * Task queue framework integrations: **Celery** (Python), **BullMQ** (Node.js), and **Spring Kafka / Spring AMQP** (Java).
  * Implementation of **Span Links** to handle batch message consumption (e.g. 1 Kafka consumer batch processing 50 messages from 50 different traces).
  * Automatic calculation and rendering of **Queue Dwell Time** (time a message sat idle in a broker before processing).
* **Reason for Deferral**:
  * Asynchronous queues introduce non-hierarchical, decoupled timelines that complicate flame graphs and trace reconstruction. For v1, synchronous HTTP request-response tracing and database query tracing represent the core priority. Users with DB-backed queues can bridge the trace by persisting `trace_id` and `span_id` in their job rows.

---

### 2.2 Trace Sampling & Ingestion Rate Limiting
* **Scope**:
  * **Head-Based Sampling**: Probabilistic sampling at the SDK/ingress tier (e.g. sample 10% of healthy requests).
  * **Tail-Based Sampling**: Ingestion-tier sampling in the Collector buffer (persist 100% of traces with errors or latency $>1\text{s}$, downsample healthy traces to 5%).
  * **Token Bucket Rate Limiting**: Per-service and per-endpoint ingestion throttles returning `429 Too Many Requests`.
* **Reason for Deferral**:
  * In a v1 POC, capturing 100% of traces is critical for testing, debugging, and verification. Premature sampling adds configuration overhead and risks dropping traces during development.

---

### 2.3 Rolling Time-Partitioned Collections
* **Scope**:
  * Shifting trace storage from a single `spans` collection to daily or hourly rolling collections (e.g. `spans_2026_11_10`).
  * Instantaneous $O(1)$ partition drops (`db.spans_2026_11_01.drop()`) to completely eliminate WiredTiger write I/O fragmentation during TTL eviction.
* **Reason for Deferral**:
  * In v1, a standard configurable MongoDB TTL index (`expireAfterSeconds`) provides sufficient automated disk cleanup without requiring complex multi-collection query routers or MongoDB time-series bucket management.

---

### 2.4 Ingestion Security & Access Control
* **Scope**:
  * **Dual-Key Authentication**: Separate Write Keys (`dw_ingest_...` for SDK span ingestion) from Read Keys (`dw_read_...` for dashboard / querying).
  * **Ingress Payload Guards**: Hard limits on batch sizes (max 1,000 spans/request) and HTTP payload size limits (e.g. max 5MB with `413 Payload Too Large`).
  * **Tenant Isolation**: Multi-tenant authorization and namespace segmentation.
* **Reason for Deferral**:
  * Authentication headers on `POST /v1/traces` add friction to local docker-compose environments, example microservices, and end-to-end integration tests.

---

### 2.5 Alternative High-Scale Storage Engines (ClickHouse & Elasticsearch)
* **Scope**:
  * **ClickHouse Storage Driver**: Columnar vectorized DBMS engine providing $10\times$–$20\times$ ZSTD data compression and sub-second $p99$ percentile latency aggregations across billions of spans.
  * **Elasticsearch / OpenSearch Storage Driver**: Lucene inverted index engine for full-text search across arbitrary payloads, headers, and exception stack traces.
* **Reason for Deferral**:
  * Doomwatch's pluggable `StorageEngine` interface isolates the storage implementation. MongoDB (with automatic in-memory fallback) provides an ideal zero-dependency setup for v1 without forcing developers to maintain dedicated ClickHouse or JVM clusters.

---

### 2.6 Go SDK (`doomwatch-go`)
* **Scope**:
  * Go middleware for standard library `net/http`, as well as frameworks like `gin` and `fiber`.
  * Context propagation across Go's explicit `context.Context` boundaries.
* **Reason for Deferral**:
  * Node.js, Python, and Java/JVM SDKs cover the primary polyglot matrix for the current milestone.

---

### 2.7 Advanced Web Dashboard Features
* **Scope**:
  * **Live WebSocket Streaming / Tail**: Real-time trace emission replacing 2-second HTTP polling.
  * **Service Dependency Graph / Topology Map**: Dynamic node-link visualization of live inter-service communication paths, throughput, and error rates.
  * **Percentile Latency Aggregates**: Interactive $p50$, $p90$, $p95$, and $p99$ trend graphs across endpoints and time ranges.
* **Reason for Deferral**:
  * The current v1 Web Dashboard already provides a clean, responsive Trace Explorer, Waterfall Flame Graph, and Span Detail Drawer with JSON payload and header inspection.

---

## 3. Summary Matrix

| Feature | Target Version | Current v1 Alternative |
| :--- | :--- | :--- |
| **Database & Cache Auto-Instrumentation** | **v1 (Active)** | In implementation (MongoDB, PostgreSQL, Redis) |
| **Configurable Data Retention (TTL)** | **v1 (Active)** | Native MongoDB TTL index ($N$ days, default disabled) |
| **Async Queues (Kafka, RabbitMQ, SQS)** | **v2** | Manual DB row context bridging (`trace_id` column) |
| **Trace Sampling & Rate Limiting** | **v2** | Ingest 100% of spans |
| **Partitioned Collections** | **v2** | Single collection with TTL index |
| **Ingestion Authentication & Security** | **v2** | Open local ingestion endpoint |
| **ClickHouse / Elasticsearch Storage** | **v2** | MongoDB + high-performance In-Memory engine |
| **Go SDK (`doomwatch-go`)** | **v2** | Polyglot support via Node, Python, and Java |
| **Live WebSockets & Topology Graph** | **v2** | 2-second polling + DAG Waterfall Flame Chart |
