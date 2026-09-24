# Doomwatch: Architecture, Context Propagation & DAG Specification

## 1. Deep Dive: Flat Trace ID vs. Directed Acyclic Graph (DAG)

### 1.1 The Core Limitation of a Flat Trace ID
In a flat trace ID model, every service attaches the exact same identifier (`trace_id: "T-100"`) to its logs and events. 

Suppose a user initiates a checkout on an e-commerce platform. The React frontend calls Service B (Order Service), which in turn executes three operations:
1. Calls Service C (Inventory Service) to reserve items.
2. Calls Service D (Payment Gateway) to process the charge.
3. Calls Service C (Inventory Service) a second time to confirm fulfillment.

If we only store a flat `trace_id = "T-100"`, the database stores a flat collection of records:

| Record | Service | Operation | Timestamp | Duration | Trace ID |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Frontend | `POST /checkout` | 10:00:00.000 | 1200ms | `T-100` |
| 2 | Service B | `POST /checkout` | 10:00:00.050 | 1100ms | `T-100` |
| 3 | Service C | `POST /reserve` | 10:00:00.100 | 200ms | `T-100` |
| 4 | Service D | `POST /charge` | 10:00:00.350 | 500ms | `T-100` |
| 5 | Service C | `POST /fulfill` | 10:00:00.900 | 150ms | `T-100` |

#### Why this causes critical observability failures:
1. **Lost Causality (Who called whom?)**:
   Looking at Record 3 and Record 4, did Service B call Service C and D? Or did Service C call Service D? With only a flat ID, there is no parent-child relationship.
2. **Concurrency & Parallelism Blindness**:
   Did Service B wait for Inventory reservation before calling Payment? Or did it call them in parallel using `Promise.all()` / async workers? In a flat table, you cannot distinguish sequential dependency from concurrent execution.
3. **Inability to build a Waterfall (Flame Graph)**:
   You cannot calculate **self-time** vs. **waiting-for-downstream time**. If Service B took 1100ms, was Service B slow, or was Service D (Payment) slow?
4. **Loop / Repeated Call Ambiguity**:
   When Service C is called twice in the same request, flat logs cannot correlate which logs inside Service C belong to call #1 vs. call #2.

---

### 1.2 How a DAG Solves This Completely

A **Directed Acyclic Graph (DAG)** introduces two additional IDs:
* **`span_id`**: A unique ID for *this specific execution step / hop*.
* **`parent_span_id`**: The `span_id` of the caller that initiated this step (null for the root).

#### What the Data Looks Like with a DAG:

```json
[
  { "service": "Frontend",  "span_id": "span-1", "parent_span_id": null,     "name": "Click Checkout" },
  { "service": "Service B", "span_id": "span-2", "parent_span_id": "span-1", "name": "POST /checkout" },
  { "service": "Service C", "span_id": "span-3", "parent_span_id": "span-2", "name": "POST /reserve" },
  { "service": "Service D", "span_id": "span-4", "parent_span_id": "span-2", "name": "POST /charge" },
  { "service": "Service C", "span_id": "span-5", "parent_span_id": "span-2", "name": "POST /fulfill" }
]
```

#### Visual Comparison: Flat vs. DAG

```mermaid
flowchart TD
    subgraph FlatView["Flat Trace ID (Unstructured Bucket)"]
        F1["Log 1 (trace: T1)"] --- F2["Log 2 (trace: T1)"]
        F2 --- F3["Log 3 (trace: T1)"]
        F3 --- F4["Log 4 (trace: T1)"]
        style FlatView fill:#ffebee,stroke:#c62828
    end

    subgraph DAGView["DAG (Call Tree with Causality)"]
        Root["Frontend: Click Checkout<br/>[span_id: S1, parent: null]"]
        Root --> B["Service B: /checkout<br/>[span_id: S2, parent: S1]"]
        B --> C1["Service C: /reserve<br/>[span_id: S3, parent: S2]"]
        B --> D["Service D: /charge<br/>[span_id: S4, parent: S2]"]
        B --> C2["Service C: /fulfill<br/>[span_id: S5, parent: S2]"]
        style DAGView fill:#e8f5e9,stroke:#2e7d32
    end
```

#### Waterfall Timeline Rendered in the UI via DAG:

```
[Frontend: Click Checkout ---------------------------------------------- 1200ms]
  └── [Service B: /checkout -------------------------------------------- 1100ms]
        ├── [Service C: /reserve ---------- 200ms]
        ├── [Service D: /charge --------------------------- 500ms]
        └── [Service C: /fulfill ------- 150ms]
```

With the DAG, Doomwatch can instantly pinpoint:
* **Critical Path**: Payment (`Service D`) consumed 500ms of the total 1100ms.
* **Failure Blast Radius**: If `Service D` fails, the exact sub-branch that died is immediately isolated.

---

## 2. Context Propagation Without Code Changes (Zero-Touch DX)

### 2.1 The Principle: "No Manual Parameter Passing"
Users should **never** have to rewrite their business functions like this:
```javascript
// BAD OBSERVABILITY DESIGN (DO NOT DO THIS)
async function processOrder(orderId, traceId) { // <- Forced code modification!
  await saveToDb(orderId, traceId);
  await callPayment(orderId, traceId);
}
```

Instead, Doomwatch uses **ambient runtime context** and **automatic interception** (often called auto-instrumentation or monkey-patching). The developer writes normal code, and Doomwatch tracks the context invisibly.

### 2.2 How Ambient Context Works Under the Hood

Every runtime has an engine-level feature that carries state through asynchronous execution chains without modifying function signatures:

```mermaid
flowchart LR
    Incoming["Incoming HTTP Request"] --> Middleware["Doomwatch Middleware / Hook"]
    Middleware --> Ambient["Bind to Ambient Context Store<br/>(AsyncLocalStorage / ContextVar / ThreadLocal)"]
    
    subgraph AppCode["User's Application Code (100% Untouched)"]
        Func1["serviceLayer()"] --> Func2["repositoryLayer()"] --> Func3["helperUtils()"]
    end
    
    Ambient -. "Ambiently Available" .-> AppCode
    
    AppCode --> OutgoingClient["HTTP Client (fetch / axios / requests / RestTemplate)"]
    OutgoingClient --> Interceptor["Doomwatch Auto-Interceptor"]
    Interceptor -. "Reads Active Span" .-> Ambient
    Interceptor --> Downstream["Injects Headers & Sends Request"]
```

---

### 2.3 User Experience in Each Supported Language

#### A. Node.js (Express / Fastify / NestJS)
The user only imports Doomwatch at the entry point. All existing code remains unchanged.

```javascript
// index.js - That's it! 2 lines added.
const doomwatch = require('@doomwatch/node');
doomwatch.init({ collectorUrl: 'http://localhost:4000', serviceName: 'order-service' });

// -------------------------------------------------------------
// USER'S EXISTING CODE BELOW (ZERO CHANGES)
// -------------------------------------------------------------
const express = require('express');
const axios = require('axios');
const app = express();

app.post('/checkout', async (req, res) => {
  // Doomwatch automatically intercepted this incoming call and set AsyncLocalStorage!
  
  // When user calls axios or fetch, Doomwatch's patched http client
  // automatically reads AsyncLocalStorage and attaches x-tracing-id and x-parent-id!
  const inventory = await axios.post('http://inventory-service/reserve', req.body);
  const payment = await axios.post('http://payment-service/charge', { amount: 100 });

  res.json({ status: 'confirmed', inventory: inventory.data, payment: payment.data });
});
```

#### B. Python (FastAPI / Flask)
```python
# main.py - 2 lines added
from fastapi import FastAPI
import doomwatch
import requests

app = FastAPI()
doomwatch.init(app, collector_url="http://localhost:4000", service_name="order-service")

# -------------------------------------------------------------
# USER'S EXISTING CODE BELOW (ZERO CHANGES)
# -------------------------------------------------------------
@app.post("/checkout")
def checkout():
    # Doomwatch automatically auto-instruments the 'requests' or 'httpx' library
    # using Python's contextvars!
    resp = requests.post("http://inventory-service/reserve")
    return {"status": "ok", "inventory": resp.json()}
```

#### C. Java (Spring Boot)
Zero Java code changes. The user only adds the starter dependency and a configuration entry:

```xml
<!-- pom.xml -->
<dependency>
    <groupId>com.doomwatch</groupId>
    <artifactId>doomwatch-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

```yaml
# application.yml
doomwatch:
  collector-url: http://localhost:4000
  service-name: order-service
```
Spring Boot's auto-configuration automatically registers the `Filter` for incoming requests and customizes `RestTemplate` / `WebClient` for outgoing requests via `ThreadLocal`.

---

## 3. End-to-End System Architecture

### 3.1 High-Level Topology
All services and frontends report to a **Doomwatch Ingest Collector**, ensuring database credentials and internal topology remain secure.

```mermaid
flowchart TD
    subgraph ClientLayer["Frontend Apps"]
        ReactApp["React App (@doomwatch/react)"]
        AngularApp["Angular App (@doomwatch/angular)"]
    end

    subgraph APIGateway["Ingress / API Gateway"]
        Gateway["NGINX / Envoy / Cloud Gateway"]
    end

    subgraph ServiceMesh["Microservices Backend"]
        NodeSvc["Service A (Node.js)"]
        PySvc["Service B (FastAPI)"]
        JavaSvc["Service C (Spring Boot)"]
        Queue["Message Queue<br/>(Kafka / RabbitMQ / BullMQ)"]
        Worker["Async Worker (Python/Celery)"]
    end

    subgraph DoomwatchSystem["Doomwatch Platform"]
        IngestAPI["Doomwatch Collector<br/>(Lightweight Ingestion Service)"]
        RingBuffer["In-Memory Queue / Buffer"]
        DB[(Doomwatch Datastore<br/>MongoDB / ClickHouse)]
        UI["Doomwatch Web Dashboard<br/>(Waterfall, Graph, Payloads)"]
    end

    ReactApp -- "1. HTTP Request (x-tracing-id)" --> Gateway
    AngularApp -- "1. HTTP Request (x-tracing-id)" --> Gateway
    Gateway --> NodeSvc

    NodeSvc -- "2. Continuation Call" --> PySvc
    PySvc -- "3. Continuation Call" --> JavaSvc
    PySvc -- "4. Enqueue Job (with trace metadata)" --> Queue
    Queue --> Worker

    %% Telemetry reporting
    ReactApp -. "POST /v1/telemetry (batched)" .-> IngestAPI
    AngularApp -. "POST /v1/telemetry (batched)" .-> IngestAPI
    NodeSvc -. "POST /v1/telemetry (batched)" .-> IngestAPI
    PySvc -. "POST /v1/telemetry (batched)" .-> IngestAPI
    JavaSvc -. "POST /v1/telemetry (batched)" .-> IngestAPI
    Worker -. "POST /v1/telemetry (batched)" .-> IngestAPI

    IngestAPI --> RingBuffer
    RingBuffer --> DB
    UI <--> DB
```

---

### 3.2 Asynchronous Request & Trace Context Propagation Flow

This sequence demonstrates how a single trace transitions seamlessly from synchronous calls through an asynchronous queue and background worker:

```mermaid
sequenceDiagram
    autonumber
    actor User as User Browser (React)
    participant SvcA as Service A (Node.js)
    participant SvcB as Service B (FastAPI)
    participant Broker as RabbitMQ / Kafka
    participant Worker as Background Worker
    participant Collector as Doomwatch Ingest API

    User->>SvcA: POST /order [Trace: T1, Span: S1]
    Note over SvcA: Adopt T1, Start Span S2 (parent: S1)
    
    SvcA->>SvcB: POST /process [Trace: T1, Span: S3, Parent: S2]
    Note over SvcB: Adopt T1, Start Span S4 (parent: S3)
    
    SvcB->>Broker: Publish {job_id: 99, trace_id: T1, parent_span_id: S4}
    SvcB-->>SvcA: 202 Accepted
    SvcA-->>User: 200 OK (Order Received)

    Note over SvcA,Collector: SvcA & SvcB flush spans S1, S2, S3, S4 to Collector
    SvcA-->>Collector: Telemetry Batch [S1, S2, S3]
    SvcB-->>Collector: Telemetry Batch [S4]

    Note over Broker,Worker: Asynchronous Background Processing
    Broker->>Worker: Consume Job
    Note over Worker: Restore Trace T1, Start Span S5 (parent: S4)
    Worker->>Worker: Heavy PDF Generation
    Worker-->>Collector: Telemetry Batch [S5]

    Note over Collector: Collector correlates all spans into single DAG: S1 -> S2 -> S3 -> S4 -> S5!
```

---

## 4. Telemetry Data Model (Span Contract)

Every log and request/response event captured by Doomwatch adheres to this unified JSON structure:

```json
{
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "parent_span_id": "5a3e12bb43f89012",
  "service_name": "order-service",
  "runtime": "node-v20",
  "span_kind": "SERVER",
  "name": "POST /api/v1/orders",
  "start_time_unix_ms": 1726950000100,
  "end_time_unix_ms": 1726950000350,
  "duration_ms": 250,
  "http": {
    "method": "POST",
    "url": "https://api.domain.com/api/v1/orders",
    "route": "/api/v1/orders",
    "status_code": 201,
    "request_headers": {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0..."
    },
    "request_body": {
      "item_id": "ITEM-101",
      "quantity": 2
    },
    "response_headers": {
      "content-type": "application/json"
    },
    "response_body": {
      "order_id": "ORD-9988",
      "status": "created"
    }
  },
  "error": null,
  "metadata": {
    "environment": "production",
    "hostname": "order-svc-pod-7d4f"
  }
}
```

---

## 5. Architectural Roadmap: From MVP to Full Vision

```mermaid
gantt
    title Doomwatch Multi-Platform Implementation Roadmap
    dateFormat  YYYY-MM-DD
    section Phase 1: Core Foundation & MVP
    Span Contract & Collector API            :p1_1, 2026-10-01, 7d
    Node.js SDK (@doomwatch/node)           :p1_2, after p1_1, 10d
    React SDK (@doomwatch/react)            :p1_3, after p1_1, 7d
    Doomwatch UI (Waterfall & Trace Graph)  :p1_4, after p1_2, 12d
    section Phase 2: Python & Angular
    FastAPI & Flask SDK (doomwatch-python)  :p2_1, after p1_4, 10d
    Angular SDK (@doomwatch/angular)        :p2_2, after p2_1, 7d
    section Phase 3: Java & Async Queues
    Spring Boot Starter (doomwatch-spring)  :p3_1, after p2_2, 14d
    Queue Context Interceptors (Kafka/Rabbit):p3_2, after p3_1, 10d
```

### Strategic Architecture Recommendation:
To support all 5 runtimes without having to reinvent HTTP socket interception and context hooks 5 times from scratch:
* **Leverage OpenTelemetry's open-source Context API internally within Doomwatch SDKs**:
  * In Node: use `@opentelemetry/api` context management (10kb, zero dependencies).
  * In Python: use standard `opentelemetry-api` context.
  * In Java: use standard OpenTelemetry or Micrometer context.
* **Why?** You get rock-solid, production-hardened context propagation across any thread, worker, or async loop, while your custom Doomwatch SDK focuses purely on:
  1. Capturing request/response payloads and status codes.
  2. Formatting the Doomwatch JSON schema.
  3. Shipping batched telemetry to your lightweight Ingestion Collector.
