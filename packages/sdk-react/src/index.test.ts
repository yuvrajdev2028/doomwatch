import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { Span, parseTraceparent } from '@doomwatch/core';
import { BrowserSpanExporter } from './exporter.js';
import { patchBrowserHttp } from './interceptor.js';
import { DoomwatchBrowserSdk } from './sdk.js';

describe('React / Browser SDK Interception', () => {
  let server: http.Server;
  let targetPort: number;
  let lastReceivedHeaders: http.IncomingHttpHeaders = {};

  before(async () => {
    server = http.createServer((req, res) => {
      lastReceivedHeaders = req.headers;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    targetPort = (server.address() as any).port;

    // Simulate browser window global environment for Node test runner
    (globalThis as any).window = {
      location: { href: `http://localhost:${targetPort}` },
      fetch: globalThis.fetch,
      addEventListener: () => {},
      removeEventListener: () => {}
    };
    (globalThis as any).document = {
      visibilityState: 'visible'
    };
  });

  after(async () => {
    DoomwatchBrowserSdk.resetInstance();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('should automatically inject traceparent and x-tracing-id on outgoing browser fetch', async () => {
    const exportedSpans: Span[] = [];
    const mockExporter = {
      enqueue: (s: Span) => exportedSpans.push(s),
      flush: async () => {},
      stop: () => {}
    } as unknown as BrowserSpanExporter;

    patchBrowserHttp({
      serviceName: 'web-frontend',
      collectorUrl: 'http://localhost:4000',
      exporter: mockExporter
    });

    const targetUrl = `http://localhost:${targetPort}/api/products`;
    const resp = await (globalThis as any).window.fetch(targetUrl);
    assert.strictEqual(resp.status, 200);

    // Verify headers received by target backend service
    assert.ok(lastReceivedHeaders['traceparent']);
    assert.ok(lastReceivedHeaders['x-tracing-id']);

    const traceId = lastReceivedHeaders['x-tracing-id'] as string;
    assert.strictEqual(traceId.length, 32);

    const parsed = parseTraceparent(lastReceivedHeaders['traceparent'] as string);
    assert.ok(parsed);
    assert.strictEqual(parsed.trace_id, traceId);

    // Verify CLIENT span generated in browser
    assert.ok(exportedSpans.length > 0);
    const clientSpan = exportedSpans[exportedSpans.length - 1];
    assert.strictEqual(clientSpan.trace_id, traceId);
    assert.strictEqual(clientSpan.service_name, 'web-frontend');
    assert.strictEqual(clientSpan.span_kind, 'CLIENT');
    assert.strictEqual(clientSpan.runtime, 'browser');
    assert.strictEqual(clientSpan.http?.status_code, 200);
  });

  it('should correlate user UI actions with subsequent API calls', async () => {
    const sdk = DoomwatchBrowserSdk.init({
      serviceName: 'web-store',
      collectorUrl: 'http://localhost:4000'
    });

    // 1. User clicks "Place Order"
    const interaction = sdk.startUserInteraction('Place Order Button');
    const interactionTraceId = interaction.traceId;

    // 2. Browser fires an API call during this interaction
    await (globalThis as any).window.fetch(`http://localhost:${targetPort}/api/checkout`, {
      method: 'POST',
      body: JSON.stringify({ item: 'laptop' })
    });

    // Verify the API call adopted the user interaction's trace ID
    assert.strictEqual(lastReceivedHeaders['x-tracing-id'], interactionTraceId);

    // 3. User interaction completes
    interaction.end();
  });
});
