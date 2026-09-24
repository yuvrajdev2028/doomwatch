import { describe, it } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { Span } from '@doomwatch/core';
import { MemoryStorageEngine } from './storage/memory.js';
import { SpanBuffer } from './buffer.js';
import { CollectorServer } from './server.js';
import { CollectorConfig } from './config.js';

function makeSampleSpan(overrides: Partial<Span> = {}): Span {
  const now = Date.now();
  return {
    trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
    span_id: '00f067aa0ba902b7',
    parent_span_id: null,
    service_name: 'test-service',
    runtime: 'node-test',
    span_kind: 'SERVER',
    name: 'POST /api/test',
    start_time_unix_ms: now,
    end_time_unix_ms: now + 50,
    duration_ms: 50,
    http: {
      method: 'POST',
      url: 'http://localhost/api/test',
      status_code: 200
    },
    ...overrides
  };
}

describe('SpanBuffer Unit Tests', () => {
  it('should enqueue and flush spans properly', async () => {
    const storage = new MemoryStorageEngine();
    await storage.init();
    const buffer = new SpanBuffer(storage, 100, 10);

    const span1 = makeSampleSpan({ span_id: 's1' });
    const span2 = makeSampleSpan({ span_id: 's2' });

    buffer.enqueue([span1, span2]);
    const stats = buffer.getStats();
    assert.strictEqual(stats.pendingSpans, 2);
    assert.strictEqual(stats.totalIngested, 2);

    const flushed = await buffer.flush();
    assert.strictEqual(flushed, 2);
    assert.strictEqual(buffer.getStats().pendingSpans, 0);

    const traces = await storage.getTraces();
    assert.strictEqual(traces.length, 1);
    assert.strictEqual(traces[0].span_count, 2);
  });
});

describe('MemoryStorageEngine DAG & Querying', () => {
  it('should correctly reconstruct DAG parent-child hierarchy', async () => {
    const storage = new MemoryStorageEngine();
    await storage.init();

    const traceId = 'trace-dag-100';
    // Root span (Frontend)
    const rootSpan = makeSampleSpan({
      trace_id: traceId,
      span_id: 'span-root',
      parent_span_id: null,
      service_name: 'frontend',
      name: 'Click Checkout',
      start_time_unix_ms: 1000,
      end_time_unix_ms: 1500
    });

    // Child span (Order Service)
    const orderSpan = makeSampleSpan({
      trace_id: traceId,
      span_id: 'span-order',
      parent_span_id: 'span-root',
      service_name: 'order-service',
      name: 'POST /orders',
      start_time_unix_ms: 1050,
      end_time_unix_ms: 1450
    });

    // Grandchild span (Payment Service)
    const paymentSpan = makeSampleSpan({
      trace_id: traceId,
      span_id: 'span-payment',
      parent_span_id: 'span-order',
      service_name: 'payment-service',
      name: 'POST /charge',
      start_time_unix_ms: 1100,
      end_time_unix_ms: 1300,
      http: { method: 'POST', url: '/charge', status_code: 201 }
    });

    await storage.insertSpans([rootSpan, orderSpan, paymentSpan]);

    const trace = await storage.getTraceById(traceId);
    assert.ok(trace);
    assert.strictEqual(trace.trace_id, traceId);
    assert.strictEqual(trace.span_count, 3);
    assert.deepStrictEqual(trace.service_names.sort(), ['frontend', 'order-service', 'payment-service'].sort());
    assert.strictEqual(trace.root_span_name, 'Click Checkout');
    assert.strictEqual(trace.total_duration_ms, 500);

    // Verify parentage in spans list
    const foundPayment = trace.spans.find((s) => s.span_id === 'span-payment');
    assert.strictEqual(foundPayment?.parent_span_id, 'span-order');
  });

  it('should filter traces by service, error, and status code', async () => {
    const storage = new MemoryStorageEngine();
    await storage.init();

    const successSpan = makeSampleSpan({
      trace_id: 't-ok',
      service_name: 'auth-svc',
      http: { method: 'GET', url: '/login', status_code: 200 }
    });

    const errorSpan = makeSampleSpan({
      trace_id: 't-err',
      service_name: 'auth-svc',
      http: { method: 'GET', url: '/login', status_code: 500 },
      error: { name: 'InternalError', message: 'DB down' }
    });

    await storage.insertSpans([successSpan, errorSpan]);

    const onlyErrors = await storage.getTraces({ has_error: true });
    assert.strictEqual(onlyErrors.length, 1);
    assert.strictEqual(onlyErrors[0].trace_id, 't-err');

    const status500 = await storage.getTraces({ status_code: 500 });
    assert.strictEqual(status500.length, 1);
    assert.strictEqual(status500[0].trace_id, 't-err');
  });
});

describe('CollectorServer HTTP Endpoints', () => {
  const testPort = 44555;
  const config: CollectorConfig = {
    port: testPort,
    mongoUri: 'mongodb://localhost:27017/doomwatch',
    mongoDbName: 'doomwatch_test',
    batchFlushIntervalMs: 50,
    batchSize: 5,
    corsOrigin: '*',
    useMemoryFallback: true
  };

  let server: CollectorServer;
  let storage: MemoryStorageEngine;

  async function request(options: http.RequestOptions, body?: any): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { ...options, port: testPort, host: '127.0.0.1' },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode || 0, body: data ? JSON.parse(data) : null });
            } catch {
              resolve({ status: res.statusCode || 0, body: data });
            }
          });
        }
      );
      req.on('error', reject);
      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  }

  it('should start server and respond to /health', async () => {
    storage = new MemoryStorageEngine();
    server = new CollectorServer(config, storage);
    await server.start();

    const res = await request({ method: 'GET', path: '/health' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.strictEqual(res.body.healthy, true);
  });

  it('should accept ingested spans via POST /v1/traces', async () => {
    const traceId = 'trace-http-001';
    const span = makeSampleSpan({ trace_id: traceId });

    const postRes = await request(
      {
        method: 'POST',
        path: '/v1/traces',
        headers: { 'Content-Type': 'application/json' }
      },
      { spans: [span] }
    );

    assert.strictEqual(postRes.status, 202);
    assert.strictEqual(postRes.body.accepted, 1);

    // Trigger flush
    await server.getBuffer().flush();

    // Query trace list
    const listRes = await request({ method: 'GET', path: '/v1/traces' });
    assert.strictEqual(listRes.status, 200);
    assert.strictEqual(listRes.body.traces.length, 1);

    // Query trace by ID
    const detailRes = await request({ method: 'GET', path: `/v1/traces/${traceId}` });
    assert.strictEqual(detailRes.status, 200);
    assert.strictEqual(detailRes.body.trace_id, traceId);
    assert.strictEqual(detailRes.body.spans.length, 1);
  });

  it('should handle CORS preflight OPTIONS request', async () => {
    const optionsRes = await request({
      method: 'OPTIONS',
      path: '/v1/traces',
      headers: { Origin: 'http://localhost:3000' }
    });
    assert.strictEqual(optionsRes.status, 204);
  });

  it('should gracefully stop server', async () => {
    await server.stop();
  });
});
