import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import {
  CollectorServer,
  MemoryStorageEngine,
  CollectorConfig
} from '@doomwatch/collector';
import Doomwatch from '@doomwatch/node';
import { DoomwatchBrowserSdk } from '@doomwatch/react';
import { createServiceA } from '../../service-a/dist/index.js';
import { createServiceB } from '../../service-b/dist/index.js';

describe('Doomwatch End-to-End Multi-Service Tracing', () => {
  let collectorServer: CollectorServer;
  let collectorStorage: MemoryStorageEngine;
  let collectorPort: number;

  let serviceAServer: http.Server;
  let serviceAPort: number;

  let serviceBServer: http.Server;
  let serviceBPort: number;

  let browserSdk: DoomwatchBrowserSdk;

  before(async () => {
    // 1. Start Doomwatch Ingestion Collector
    collectorStorage = new MemoryStorageEngine();
    collectorPort = 4100;
    const collectorConfig: CollectorConfig = {
      port: collectorPort,
      mongoUri: 'mongodb://localhost:27017/doomwatch',
      mongoDbName: 'doomwatch_e2e',
      batchFlushIntervalMs: 50,
      batchSize: 5,
      corsOrigin: '*',
      useMemoryFallback: true
    };

    collectorServer = new CollectorServer(collectorConfig, collectorStorage);
    await collectorServer.start();

    // 2. Start Service B (Downstream Payment Service)
    const appB = createServiceB(`http://127.0.0.1:${collectorPort}`);
    serviceBServer = http.createServer(appB);
    await new Promise<void>((resolve) => serviceBServer.listen(0, resolve));
    serviceBPort = (serviceBServer.address() as any).port;

    // 3. Start Service A (Upstream Order Service)
    const appA = createServiceA(
      `http://127.0.0.1:${collectorPort}`,
      `http://127.0.0.1:${serviceBPort}`
    );
    serviceAServer = http.createServer(appA);
    await new Promise<void>((resolve) => serviceAServer.listen(0, resolve));
    serviceAPort = (serviceAServer.address() as any).port;

    // 4. Initialize Browser SDK to simulate Frontend React user action
    (globalThis as any).window = {
      location: { href: `http://localhost:5173` },
      fetch: globalThis.fetch,
      addEventListener: () => {},
      removeEventListener: () => {}
    };
    (globalThis as any).document = { visibilityState: 'visible' };

    browserSdk = DoomwatchBrowserSdk.init({
      serviceName: 'web-store-frontend',
      collectorUrl: `http://127.0.0.1:${collectorPort}`,
      batchIntervalMs: 50,
      batchSize: 5
    });
  });

  after(async () => {
    DoomwatchBrowserSdk.resetInstance();
    await new Promise<void>((resolve) => serviceAServer.close(() => resolve()));
    await new Promise<void>((resolve) => serviceBServer.close(() => resolve()));
    await collectorServer.stop();
  });

  it('should capture end-to-end trace from Frontend -> Service A -> Service B with exact DAG causality', async () => {
    // 1. User clicks "Checkout" in Frontend
    const interaction = browserSdk.startUserInteraction('Checkout Button');
    const expectedTraceId = interaction.traceId;

    // 2. Frontend fires POST /orders to Service A
    const orderPayload = { item: 'MacBook Pro M3', price: 2499 };
    const response = await (globalThis as any).window.fetch(`http://127.0.0.1:${serviceAPort}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload)
    });

    assert.strictEqual(response.status, 201);
    const orderResult = await response.json();

    // Verify response adopted active trace ID
    assert.strictEqual(orderResult.activeTraceId, expectedTraceId);
    assert.strictEqual(orderResult.payment.status, 'paid');
    assert.strictEqual(orderResult.payment.amount, 2499);

    interaction.end();

    // 3. Flush SDK buffers to Collector
    await Doomwatch.flush();
    await browserSdk.flush();

    // Wait a brief tick for Collector buffer to receive spans
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Force flush Collector in-memory buffer to storage
    await collectorServer.getBuffer().flush();

    // 4. Query the Collector for the complete Trace DAG
    const trace = await collectorStorage.getTraceById(expectedTraceId);
    assert.ok(trace, `Trace '${expectedTraceId}' must exist in Collector storage`);
    assert.strictEqual(trace.trace_id, expectedTraceId);

    // 5. Verify all services participated under the same trace ID
    assert.ok(trace.service_names.includes('web-store-frontend'), 'Frontend span present');
    assert.ok(trace.service_names.includes('order-service'), 'Order service span present');
    assert.ok(trace.service_names.includes('payment-service'), 'Payment service span present');

    // 6. Verify DAG Parent-Child Relationships
    const spans = trace.spans;
    assert.ok(spans.length >= 3, `Expected at least 3 spans in DAG, received ${spans.length}`);

    // Span 1: Frontend Client Span
    const frontendSpan = spans.find((s) => s.service_name === 'web-store-frontend' && s.span_kind === 'CLIENT');
    assert.ok(frontendSpan, 'Frontend client span exists');
    assert.strictEqual(frontendSpan.trace_id, expectedTraceId);

    // Span 2: Service A Server Span
    const serviceAServerSpan = spans.find((s) => s.service_name === 'order-service' && s.span_kind === 'SERVER');
    assert.ok(serviceAServerSpan, 'Service A server span exists');
    assert.strictEqual(serviceAServerSpan.trace_id, expectedTraceId);
    assert.strictEqual(serviceAServerSpan.parent_span_id, frontendSpan.span_id, 'Service A must point to Frontend as parent');
    assert.strictEqual(serviceAServerSpan.http?.status_code, 201);

    // Span 3: Service A Client Span (outbound call to Service B)
    const serviceAClientSpan = spans.find((s) => s.service_name === 'order-service' && s.span_kind === 'CLIENT');
    assert.ok(serviceAClientSpan, 'Service A outbound client span exists');
    assert.strictEqual(serviceAClientSpan.trace_id, expectedTraceId);
    assert.strictEqual(serviceAClientSpan.parent_span_id, serviceAServerSpan.span_id, 'Service A outbound call must point to incoming order span');

    // Span 4: Service B Server Span (incoming charge call)
    const serviceBServerSpan = spans.find((s) => s.service_name === 'payment-service' && s.span_kind === 'SERVER');
    assert.ok(serviceBServerSpan, 'Service B server span exists');
    assert.strictEqual(serviceBServerSpan.trace_id, expectedTraceId);
    assert.strictEqual(serviceBServerSpan.parent_span_id, serviceAClientSpan.span_id, 'Service B must point to Service A outbound client span');
    assert.strictEqual(serviceBServerSpan.http?.status_code, 200);

    // 7. Verify Sanitized Payloads
    assert.deepStrictEqual(serviceAServerSpan.http?.request_body, orderPayload);
    assert.strictEqual((serviceBServerSpan.http?.request_body as any)?.amount, 2499);
  });
});
