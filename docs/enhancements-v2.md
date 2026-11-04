# Doomwatch: Future Enhancements & Roadmap (v2)

**Date & Time:** November 5, 2026, 02:48:52 IST  
**Status:** Planning / Roadmap  
**Document Version:** 1.0  

---

## Overview

Phases 1 through 6 of **Doomwatch**—covering Core Contracts, Ingestion Collector, Node.js SDK, React/Browser SDK, Web Dashboard, and local E2E validation—are completed.

This document details the prioritized enhancements, architectural expansions, and features required to evolve Doomwatch from an MVP into a production-grade, polyglot observability platform.

---

## 1. Multi-Runtime SDK Expansion

Currently, Doomwatch supports Node.js and React/Browser applications. Modern microservice environments are polyglot and require client libraries across major backend runtimes:

### 1.1 Python SDK (`doomwatch-python`)
* **Framework Integrations:** Middleware extensions for **FastAPI**, **Flask**, and **Django**.
* **Ambient Context Propagation:** Utilize Python's native `contextvars` and the OpenTelemetry Python API (`opentelemetry-api`) to carry trace context across `asyncio` task boundaries and thread pools without signature modifications.
* **HTTP Client Auto-Patching:** Interceptors for standard outgoing HTTP clients, including `requests`, `httpx`, and `aiohttp`.

### 1.2 Java / JVM SDK (`doomwatch-java`)
* **Spring Boot Starter:** Auto-configuration with Spring `WebFilter` / `HandlerInterceptor` to inspect incoming requests and establish root/server spans.
* **Context Propagation:** Context propagation backed by `ThreadLocal` or the OpenTelemetry Java instrumentation engine.
* **Client Interceptors:** Automatic header injection for Spring `RestTemplate`, `WebClient`, and Apache HttpClient.

### 1.3 Go SDK (`doomwatch-go`)
* **Framework Middleware:** Middleware for Go standard library `net/http`, as well as frameworks such as `gin`, `fiber`, and `echo`.
* **Explicit Context Propagation:** Utilities to inject into and extract from Go's idiomatic `context.Context`.

---

## 2. Async Messaging & Queue Instrumentation

Real-world distributed systems frequently communicate over asynchronous message brokers rather than synchronous HTTP alone:

* **Broker Integrations:** Support for **Apache Kafka**, **RabbitMQ**, **AWS SQS / SNS**, and **Redis Streams**.
* **Producer & Consumer Spans:**
  * Inject W3C `traceparent` headers into message broker metadata/record headers (`PRODUCER` span kind).
  * Extract trace context inside consumer workers to continue the trace DAG (`CONSUMER` span kind).
* **Asynchronous DAG Linking:** Preserve causality across decoupled event-driven workflows and background worker pipelines.

---

## 3. Database & Cache Auto-Instrumentation

Database and cache operations often represent the dominant latency factor in backend workflows. SDKs should trace these operations as child spans:

### 3.1 Database Drivers
* **Supported Drivers:** PostgreSQL (`pg`), MySQL (`mysql2`), Prisma ORM, and Mongoose / MongoDB driver.
* **Captured Telemetry:**
  * Execution duration and query timings.
  * Sanitized SQL/NoSQL query statements (automatic stripping of raw values and parameters to preserve data privacy).
  * Error status codes, failures, and connection pool latency.

### 3.2 In-Memory Caches
* **Supported Engines:** Redis (`ioredis`, `redis`) and Memcached.
* **Captured Telemetry:** Cache operations (`GET`, `SET`, `DEL`), hit/miss metadata, and execution duration.

---

## 4. Collector & Storage Enhancements

As trace volume scales, the ingestion pipeline and storage engine require enterprise features:

### 4.1 Trace Sampling & Rate Limiting
* **Head-Based Sampling:** Probabilistic sampling configured at SDK level (e.g., sample 10% of high-volume healthy endpoints).
* **Tail-Based Sampling:** Ingestion-tier sampling to guarantee 100% retention of:
  * Traces containing errors (HTTP 4xx/5xx or unhandled exceptions).
  * High-latency traces exceeding configured thresholds (e.g., $>1000\text{ms}$).
  * Custom priority transaction flags.

### 4.2 Data Retention & TTL Policies
* Automated trace eviction via MongoDB TTL indexes or partitioned collection drops for traces older than $N$ days.

### 4.3 Ingestion Security & Authentication
* Ingestion authentication using API keys or Bearer tokens on `POST /v1/traces` to prevent unauthorized span submission.
* Rate limiting per tenant / application token to safeguard collector availability.

### 4.4 Alternative Analytical Storage Engines
* Support for analytical columnar datastores (e.g., **ClickHouse**, **Elasticsearch** / **OpenSearch**) for high-throughput trace aggregation and multi-month querying.

---

## 5. Web Dashboard Enhancements

Extend the current waterfall timeline and trace list with deeper analytical tooling:

* **Service Dependency Graph / Topology Map:**
  * Interactive network map visualizing live service-to-service communication paths, call throughput, and error rates derived from trace DAGs.
* **Aggregated Latency Analytics ($p50$, $p90$, $p95$, $p99$):**
  * Endpoint and service-level percentile latency metrics over selectable time windows.
* **Real-Time Streaming / Live Tail:**
  * Real-time trace ingestion streaming via WebSockets/Server-Sent Events (SSE) replacing periodic HTTP polling.

---

## 6. Standalone React Sample App

* **Live Frontend Demo (`examples/sample-react-app`):**
  * Build a standalone interactive frontend (e.g., Vite + React e-commerce UI) wired to `@doomwatch/react`.
  * Demonstrates end-to-end real browser network interception calling `examples/service-a`, visual button click tracing, and direct link-outs to the Doomwatch Dashboard.
