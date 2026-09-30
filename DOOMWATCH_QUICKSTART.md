# Doomwatch: Quickstart & Testing Guide

This guide provides step-by-step instructions to run, test, and inspect **Doomwatch** and its example microservices locally.

---

## 1. System Overview

| Component | Package / Path | Description | Default Port |
| :--- | :--- | :--- | :--- |
| **Collector API** | [`packages/collector`](file:///home/yuvraj-pratap-singh/doomwatch/packages/collector) | Ingestion server & trace storage engine | `4000` |
| **Web Dashboard** | [`packages/dashboard`](file:///home/yuvraj-pratap-singh/doomwatch/packages/dashboard) | Trace visualizer, flame graph & payload inspector | `4000` (or `5000`) |
| **Node.js SDK** | [`packages/sdk-node`](file:///home/yuvraj-pratap-singh/doomwatch/packages/sdk-node) | Auto-instrumenting Node/Express SDK | Library |
| **React SDK** | [`packages/sdk-react`](file:///home/yuvraj-pratap-singh/doomwatch/packages/sdk-react) | Browser fetch/XHR interceptor & provider | Library |
| **Core Contracts** | [`packages/core`](file:///home/yuvraj-pratap-singh/doomwatch/packages/core) | W3C parser, ID generation & sanitization | Library |
| **Service A** | [`examples/service-a`](file:///home/yuvraj-pratap-singh/doomwatch/examples/service-a) | Order Service (upstream backend) | `3001` |
| **Service B** | [`examples/service-b`](file:///home/yuvraj-pratap-singh/doomwatch/examples/service-b) | Payment Service (downstream backend) | `3002` |

---

## 2. Prerequisites

* **Node.js**: `v18.0.0` or higher (verified on Node `v24.8.0`).
* **npm**: `v9.0.0` or higher.
* *(Optional)* **Docker**: If you wish to run a dedicated MongoDB instance instead of the built-in in-memory storage.

---

## 3. Method 1: Instant End-to-End Demo (Single Command)

We have created an automated demonstration that boots the Ingestion Collector, Service B, and Service A, executes a simulated frontend checkout, and outputs the reconstructed trace waterfall directly in your terminal.

From the project root:

```bash
npm run demo
```

### Expected Output:
```text
============================================================
              DOOMWATCH END-TO-END DEMO
============================================================

✓ Doomwatch Collector running on http://localhost:4000
✓ Service B (Payment Service) running on http://localhost:3002
✓ Service A (Order Service) running on http://localhost:3001

------------------------------------------------------------
▶ Triggering User Checkout Flow from Frontend Browser...
------------------------------------------------------------
[Frontend] User clicked 'Place Order' (Trace ID: d120a7b794729aa758fc1e69a53b0225)
[Frontend] POST http://localhost:3001/orders -> Sending order payload
[Service A] Order confirmed: ord-1790276409071 (status: confirmed)
[Service B] Payment processed: txn-1790276409062 ($3499)
[Frontend] Received 201 Created from Service A!

------------------------------------------------------------
▶ Reconstructing Trace Waterfall from Doomwatch Collector:
------------------------------------------------------------
Trace ID : d120a7b794729aa758fc1e69a53b0225
Services : web-store-frontend -> order-service -> payment-service
Duration : 81ms
Spans    : 5
Status   : SUCCESS ✓

Trace Waterfall Hierarchy:
[web-store-frontend] (INTERNAL)     UI: Checkout Flow               (81ms)
[web-store-frontend] (CLIENT)       POST /orders         HTTP 201   (80ms)
   └── [order-service] (SERVER)            POST /orders         HTTP 201   (47ms)
      └── [order-service] (CLIENT)            POST /charge         HTTP 200   (43ms)
   └── [payment-service] (SERVER)          POST /charge         HTTP 200   (32ms)

============================================================
✓ TRACE CONTINUATION & DAG VERIFIED WITH ZERO CODE CHANGES!
============================================================
```

---

## 4. Method 2: Running the Full Test Suite

To run all 23 unit, integration, and end-to-end tests across the entire repository:

```bash
npm test
```

To build all TypeScript packages:

```bash
npm run build
```

---

## 5. Method 3: Running Microservices Manually (Terminal by Terminal)

If you want to run the services independently and trigger requests via `curl` or Postman:

### Terminal 1: Start Doomwatch Collector
```bash
npm run start --workspace=@doomwatch/collector
```
* The Collector will start on **`http://localhost:4000`**.
* By default, if MongoDB is not running locally, it automatically falls back to the high-performance in-memory storage engine.

### Terminal 2: Start Service B (Payment Service)
```bash
npm run start --workspace=example-service-b
```
* Service B will start on **`http://localhost:3002`**.

### Terminal 3: Start Service A (Order Service)
```bash
npm run start --workspace=example-service-a
```
* Service A will start on **`http://localhost:3001`**.

---

## 6. Triggering Requests and Inspecting Traces

Open a fourth terminal to trigger and inspect traces:

### Test 1: Place an Order (Root Trace Generated Automatically)
Trigger a request to Service A. Service A will automatically call Service B downstream:

```bash
curl -i -X POST http://localhost:3001/orders \
  -H "Content-Type: application/json" \
  -d '{"item": "MacBook Pro M3 Max", "price": 3499}'
```

**Response**:
```json
{
  "orderId": "ord-1790276409071",
  "status": "confirmed",
  "item": "MacBook Pro M3 Max",
  "price": 3499,
  "payment": {
    "transactionId": "txn-1790276409062",
    "status": "paid",
    "amount": 3499,
    "currency": "USD"
  },
  "activeTraceId": "d120a7b794729aa758fc1e69a53b0225"
}
```

Notice the response headers contain the correlation IDs:
```http
x-tracing-id: d120a7b794729aa758fc1e69a53b0225
traceparent: 00-d120a7b794729aa758fc1e69a53b0225-5af543720447cbdd-01
```

---

### Test 2: Trigger Request with Existing Frontend Trace ID
Simulate a request originating from a React or mobile client with an existing trace ID:

```bash
curl -i -X POST http://localhost:3001/orders \
  -H "Content-Type: application/json" \
  -H "x-tracing-id: a1b2c3d4e5f60718293a4b5c6d7e8f90" \
  -d '{"item": "Studio Display", "price": 1599}'
```

Both Service A and Service B will adopt `a1b2c3d4e5f60718293a4b5c6d7e8f90`!

---

### Test 3: Query Collector for All Traces
Inspect recent traces captured by Doomwatch:

```bash
curl http://localhost:4000/v1/traces
```

Filter by service name:
```bash
curl "http://localhost:4000/v1/traces?service=order-service"
```

Filter for errors only:
```bash
curl "http://localhost:4000/v1/traces?has_error=true"
```

---

### Test 4: Reconstruct a Specific Trace's Full DAG
Retrieve the complete hierarchical span tree, durations, and request/response payloads:

```bash
curl http://localhost:4000/v1/traces/<trace_id>
```

---

### Test 5: Check Collector Health & Buffer Stats
```bash
curl http://localhost:4000/health
```

**Response**:
```json
{
  "status": "ok",
  "storage": "in-memory",
  "healthy": true,
  "buffer": {
    "pendingSpans": 0,
    "totalIngested": 18,
    "totalFlushed": 18,
    "totalErrors": 0
  }
}
```

---

## 7. Minimal Web Dashboard (Phase 6)

Doomwatch includes a built-in, zero-dependency interactive Web Dashboard for visual trace exploration, waterfall flame charts, and span inspection.

### Accessing the Dashboard:
The dashboard is served directly by the Doomwatch Ingestion Collector:
1. Start the Collector:
   ```bash
   npm run start --workspace=@doomwatch/collector
   ```
2. Open your browser and navigate to:
   ```text
   http://localhost:4000/
   ```
   *(or `http://localhost:4000/dashboard`)*

### Standalone Dashboard Server (Alternative):
You can also run the dashboard as an independent microservice pointing to any Doomwatch collector:
```bash
npm run start --workspace=@doomwatch/dashboard
```
Then navigate to: **`http://localhost:5000/`**

### Dashboard Capabilities & Features:
* **Live Feed & Auto-Refresh**: Automatically polls the Collector every 2 seconds for fresh traces with a one-click pause/play toggle.
* **Trace Filter Bar**: Instant client-side search and filtering by:
  * Trace ID (hex hash)
  * Service Name (`order-service`, `payment-service`, `web-store-frontend`, etc.)
  * Error status (`Errors Only` toggle)
  * HTTP Status Code
* **Interactive Waterfall & DAG Flame Graph**:
  * Visualizes the complete parent-child span hierarchy with branch connectors.
  * Proportional horizontal timing bars showing exact start offset and duration for each span in milliseconds.
  * Color-coded service tags and status badges (Success `200/201`, Client Error `4xx`, Server Error `5xx`).
* **Slide-out Span Inspector Drawer**:
  * Click any span row in the waterfall to inspect deep telemetry details.
  * Details include: Span ID, Parent Span ID, HTTP Method, Target URL, Status Code, Duration.
  * Sanitized HTTP Headers (Authorization tokens masked).
  * Sanitized & Truncated Request / Response JSON Payloads (sensitive keys like `password`, `token`, `secret` automatically redacted).
  * Error message and stack traces for failed spans.

---

## 8. Using Real MongoDB (Optional)

If you have Docker installed and want to test persistence with a real MongoDB database:

1. **Start MongoDB via Docker Compose**:
   ```bash
   docker compose up -d mongodb
   ```
2. **Start Collector with MongoDB Connection**:
   ```bash
   MONGODB_URI=mongodb://localhost:27017/doomwatch npm run start --workspace=@doomwatch/collector
   ```
   * The Collector will automatically connect, create optimized indexes on `{ trace_id: 1 }` and `{ service_name: 1 }`, and persist all spans directly into the `spans` collection.

---

## 9. Summary of How Zero-Touch Tracing Works

1. **Node.js Services**:
   ```javascript
   import Doomwatch from '@doomwatch/node';
   
   // 1. Initialize once
   Doomwatch.init({ serviceName: 'my-service', collectorUrl: 'http://localhost:4000' });
   
   // 2. Attach middleware
   app.use(Doomwatch.middleware());
   
   // Existing code remains untouched! All outbound fetch/axios calls automatically inherit context.
   ```

2. **React Applications**:
   ```tsx
   import { DoomwatchProvider } from '@doomwatch/react';
   
   export function App() {
     return (
       <DoomwatchProvider serviceName="web-frontend" collectorUrl="http://localhost:4000">
         <MyStore />
       </DoomwatchProvider>
     );
   }
   ```
