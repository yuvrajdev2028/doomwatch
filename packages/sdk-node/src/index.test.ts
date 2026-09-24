import { describe, it } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import {
  Span,
  TraceContext,
  generateTraceId,
  generateSpanId,
  parseTraceparent
} from '@doomwatch/core';
import {
  initGlobalContextManager,
  runInTraceContext,
  getActiveTraceContext,
  getActiveSpan
} from './context.js';
import { DoomwatchExporter } from './exporter.js';
import { createDoomwatchMiddleware } from './middleware.js';
import { patchHttpClients } from './patch-http.js';

describe('OpenTelemetry Context Management', () => {
  it('should maintain ambient trace context across asynchronous Promise chains', async () => {
    initGlobalContextManager();

    const traceCtx: TraceContext = {
      trace_id: generateTraceId(),
      span_id: generateSpanId(),
      parent_span_id: null,
      trace_flags: '01'
    };

    const span: Span = {
      trace_id: traceCtx.trace_id,
      span_id: traceCtx.span_id,
      service_name: 'test-svc',
      runtime: 'node-test',
      span_kind: 'SERVER',
      name: 'GET /test',
      start_time_unix_ms: Date.now(),
      end_time_unix_ms: 0,
      duration_ms: 0
    };

    assert.strictEqual(getActiveTraceContext(), null);

    await runInTraceContext(traceCtx, span, async () => {
      // Step 1: Immediately active
      assert.strictEqual(getActiveTraceContext()?.trace_id, traceCtx.trace_id);
      assert.strictEqual(getActiveSpan()?.span_id, span.span_id);

      // Step 2: Across an async timer/microtask hop
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.strictEqual(getActiveTraceContext()?.trace_id, traceCtx.trace_id);
    });

    // Step 3: Outside context block, ambient context is safely cleaned up
    assert.strictEqual(getActiveTraceContext(), null);
  });
});

describe('Zero-Touch Outgoing HTTP Interception & Continuation', () => {
  it('should automatically attach continuation trace headers to outbound HTTP calls', async () => {
    const exportedSpans: Span[] = [];
    const mockExporter = {
      enqueue: (s: Span) => exportedSpans.push(s),
      flush: async () => {},
      stop: async () => {}
    } as unknown as DoomwatchExporter;

    // Auto-patch HTTP client
    patchHttpClients({
      serviceName: 'order-service',
      collectorUrl: 'http://localhost:9999',
      exporter: mockExporter
    });

    // 1. Setup a Mock Downstream HTTP Target Server (Service B)
    let receivedHeaders: http.IncomingHttpHeaders = {};
    const downstreamServer = http.createServer((req, res) => {
      receivedHeaders = req.headers;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });

    await new Promise<void>((resolve) => downstreamServer.listen(0, resolve));
    const targetPort = (downstreamServer.address() as any).port;

    // 2. Simulate Incoming Request to Service A with an existing trace ID
    const incomingTraceId = '5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d';
    const incomingParentSpanId = '1122334455667788';
    const middleware = createDoomwatchMiddleware({
      serviceName: 'order-service',
      exporter: mockExporter
    });

    // Mock incoming req & res
    const mockReq = {
      method: 'POST',
      url: '/orders',
      headers: {
        'x-tracing-id': incomingTraceId,
        'x-parent-id': incomingParentSpanId
      }
    } as any;

    const mockResHeaders: Record<string, string> = {};
    const mockRes = {
      statusCode: 200,
      setHeader: (k: string, v: string) => {
        mockResHeaders[k.toLowerCase()] = v;
      },
      getHeaders: () => mockResHeaders,
      write: () => true,
      end: (chunk: any) => chunk
    } as any;

    // Execute middleware and fire an outbound HTTP request inside it
    await new Promise<void>((resolve) => {
      middleware(mockReq, mockRes, async () => {
        // Here user runs their normal code without touching trace parameters!
        // Calling downstream Service B via native http.request
        http.get(`http://localhost:${targetPort}/inventory`, (res) => {
          res.resume();
          res.on('end', () => {
            mockRes.end('done');
            resolve();
          });
        });
      });
    });

    downstreamServer.close();

    // Verify continuation headers received by downstream server:
    assert.strictEqual(receivedHeaders['x-tracing-id'], incomingTraceId);
    assert.ok(receivedHeaders['traceparent']);

    const parsedTraceparent = parseTraceparent(receivedHeaders['traceparent'] as string);
    assert.ok(parsedTraceparent);
    assert.strictEqual(parsedTraceparent.trace_id, incomingTraceId);

    // Verify that parent_span_id received downstream matches Service A's server span
    const serverSpan = exportedSpans.find((s) => s.span_kind === 'SERVER');
    const clientSpan = exportedSpans.find((s) => s.span_kind === 'CLIENT');

    assert.ok(serverSpan, 'Server span should be recorded');
    assert.ok(clientSpan, 'Client span should be recorded');

    assert.strictEqual(clientSpan.trace_id, incomingTraceId);
    assert.strictEqual(clientSpan.parent_span_id, serverSpan.span_id);
  });

  it('should generate a fresh root trace ID for independent outbound requests', async () => {
    let capturedHeaders: http.IncomingHttpHeaders = {};
    const downstreamServer = http.createServer((req, res) => {
      capturedHeaders = req.headers;
      res.writeHead(200);
      res.end('ok');
    });

    await new Promise<void>((resolve) => downstreamServer.listen(0, resolve));
    const port = (downstreamServer.address() as any).port;

    // Outbound request made with NO active ambient context (e.g. background job)
    await new Promise<void>((resolve) => {
      http.get(`http://localhost:${port}/background-task`, (res) => {
        res.resume();
        res.on('end', () => resolve());
      });
    });

    downstreamServer.close();

    // Verify a fresh trace ID was automatically generated
    assert.ok(capturedHeaders['x-tracing-id']);
    assert.ok(capturedHeaders['traceparent']);
    assert.strictEqual((capturedHeaders['x-tracing-id'] as string).length, 32);
    assert.strictEqual(capturedHeaders['x-parent-id'], undefined);
  });

  it('should support global fetch with ambient trace continuation', async () => {
    let receivedHeaders: http.IncomingHttpHeaders = {};
    const server = http.createServer((req, res) => {
      receivedHeaders = req.headers;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const mockTraceCtx: TraceContext = {
      trace_id: 'abcdef0123456789abcdef0123456789',
      span_id: '9876543210fedcba',
      parent_span_id: null,
      trace_flags: '01'
    };

    const mockSpan: Span = {
      trace_id: mockTraceCtx.trace_id,
      span_id: mockTraceCtx.span_id,
      service_name: 'test-fetch',
      runtime: 'node-test',
      span_kind: 'SERVER',
      name: 'GET /mock',
      start_time_unix_ms: Date.now(),
      end_time_unix_ms: 0,
      duration_ms: 0
    };

    await runInTraceContext(mockTraceCtx, mockSpan, async () => {
      const resp = await fetch(`http://localhost:${port}/api/data`);
      assert.strictEqual(resp.status, 200);
    });

    server.close();

    assert.strictEqual(receivedHeaders['x-tracing-id'], mockTraceCtx.trace_id);
    assert.strictEqual(receivedHeaders['x-parent-id'], mockTraceCtx.span_id);
  });
});
