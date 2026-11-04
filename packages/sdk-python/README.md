# Doomwatch Python SDK

Official Python SDK for the **Doomwatch** distributed tracing and observability platform.

## Features

* **Zero-Touch Context Propagation**: Automatic ambient context management using Python's native `contextvars`.
* **W3C Trace Context Compliant**: Fully compliant with W3C `traceparent` (`00-{trace_id}-{span_id}-{flags}`) with fallback to legacy `x-tracing-id`.
* **Framework Middlewares**:
  * **ASGI Middleware**: Native support for **FastAPI**, **Starlette**, etc.
  * **WSGI Middleware & Flask Extension**: Native support for **Flask**, **Django**, and generic WSGI servers.
* **Auto-Instrumentation for Outgoing HTTP**: Automatically injects trace headers and records `CLIENT` spans for `urllib.request`, `requests`, and `httpx`.
* **Data Sanitization & Redaction**: Built-in recursive redaction of sensitive credentials (`password`, `authorization`, `token`, `secret`, `api_key`, `cookie`) and byte size truncation.
* **Non-Blocking Fail-Open Exporter**: Background daemon thread that batches and flushes spans asynchronously without slowing down or crashing your application.

---

## Installation

```bash
pip install doomwatch
```

Or install with framework extras:
```bash
pip install "doomwatch[fastapi,requests]"
```

---

## Quickstart

### 1. Initialize Doomwatch

Call `Doomwatch.init(...)` at the entry point of your service:

```python
from doomwatch import Doomwatch

Doomwatch.init(
    service_name="payment-service",
    collector_url="http://localhost:4000"
)
```

### 2. FastAPI Integration

```python
from fastapi import FastAPI
from doomwatch import Doomwatch, DoomwatchASGIMiddleware

Doomwatch.init(service_name="order-service")

app = FastAPI()
app.add_middleware(
    DoomwatchASGIMiddleware,
    service_name="order-service",
    exporter=Doomwatch.get_instance().exporter
)

@app.post("/orders")
async def create_order():
    return {"status": "created"}
```

### 3. Flask Integration

```python
from flask import Flask
from doomwatch import Doomwatch, DoomwatchFlask

Doomwatch.init(service_name="user-service")

app = Flask(__name__)
DoomwatchFlask(app)

@app.route("/users")
def get_users():
    return {"users": ["Alice", "Bob"]}
```

### 4. Automatic Outgoing HTTP Propagation

When your service makes an outgoing HTTP call using `requests` or `urllib`, Doomwatch automatically injects continuation headers and measures the request:

```python
import requests

# traceparent & x-tracing-id are automatically injected!
resp = requests.get("http://downstream-service/charge")
```

### 5. Manual Span Tracking

```python
from doomwatch import Doomwatch

with Doomwatch.start_span("process_payment_algorithm") as span:
    # compute complex business logic
    span.metadata = {"algorithm": "fast-v2"}
```
