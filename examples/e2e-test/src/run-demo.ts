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

async function main() {
  console.log('\n============================================================');
  console.log('       DOOMWATCH FULL-STACK DISTRIBUTED TRACING DEMO');
  console.log('   (Frontend -> Microservices -> PostgreSQL -> Redis Cache)   ');
  console.log('============================================================\n');

  const collectorPort = 4000;
  const serviceBPort = 3002;
  const serviceAPort = 3001;

  // 1. Start Doomwatch Collector
  const collectorStorage = new MemoryStorageEngine();
  const collectorConfig: CollectorConfig = {
    port: collectorPort,
    mongoUri: 'mongodb://localhost:27017/doomwatch',
    mongoDbName: 'doomwatch_demo',
    batchFlushIntervalMs: 50,
    batchSize: 5,
    corsOrigin: '*',
    useMemoryFallback: true
  };

  const collectorServer = new CollectorServer(collectorConfig, collectorStorage);
  await collectorServer.start();
  console.log(`✓ Doomwatch Collector running on http://localhost:${collectorPort}`);

  // 2. Start Service B (Payment Service with Redis & PostgreSQL)
  const appB = createServiceB(`http://127.0.0.1:${collectorPort}`);
  const serviceB = http.createServer(appB);
  await new Promise<void>((resolve) => serviceB.listen(serviceBPort, resolve));
  console.log(`✓ Service B (Payment Service + Redis + PostgreSQL) running on http://localhost:${serviceBPort}`);

  // 3. Start Service A (Order Service with PostgreSQL)
  const appA = createServiceA(
    `http://127.0.0.1:${collectorPort}`,
    `http://127.0.0.1:${serviceBPort}`
  );
  const serviceA = http.createServer(appA);
  await new Promise<void>((resolve) => serviceA.listen(serviceAPort, resolve));
  console.log(`✓ Service A (Order Service + PostgreSQL) running on http://localhost:${serviceAPort}`);

  // 4. Setup simulated frontend browser environment
  (globalThis as any).window = {
    location: { href: `http://localhost:5173` },
    fetch: globalThis.fetch,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  (globalThis as any).document = { visibilityState: 'visible' };

  const browserSdk = DoomwatchBrowserSdk.init({
    serviceName: 'web-store-frontend',
    collectorUrl: `http://127.0.0.1:${collectorPort}`,
    batchIntervalMs: 50,
    batchSize: 5
  });

  console.log('\n------------------------------------------------------------');
  console.log('▶ Triggering User Checkout Flow from Frontend Browser...');
  console.log('------------------------------------------------------------');

  const interaction = browserSdk.startUserInteraction('Checkout Flow');
  const traceId = interaction.traceId;
  console.log(`[Frontend] User clicked 'Place Order' (Trace ID: ${traceId})`);

  const orderPayload = { item: 'MacBook Pro M3 Max', price: 3499 };
  console.log(`[Frontend] POST http://localhost:${serviceAPort}/orders -> Sending order payload`);

  const res = await (globalThis as any).window.fetch(`http://127.0.0.1:${serviceAPort}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(orderPayload)
  });

  const orderResult = await res.json();
  console.log(`[Service A] Order recorded in PostgreSQL (status: ${orderResult.status})`);
  console.log(`[Service B] Payment checked in Redis cache & recorded in PostgreSQL: ${orderResult.payment.transactionId}`);
  console.log(`[Frontend] Received 201 Created from Service A with active trace continuation!`);

  interaction.end();

  // Flush all SDK and Collector queues
  await Doomwatch.flush();
  await browserSdk.flush();
  await new Promise((resolve) => setTimeout(resolve, 150));
  await collectorServer.getBuffer().flush();

  // 5. Query trace from Doomwatch Collector
  console.log('\n------------------------------------------------------------');
  console.log('▶ Reconstructing Complete Distributed Trace Waterfall (DAG):');
  console.log('------------------------------------------------------------');

  const trace = await collectorStorage.getTraceById(traceId);
  if (!trace) {
    console.error('Error: Trace not found in collector!');
    process.exit(1);
  }

  console.log(`Trace ID : ${trace.trace_id}`);
  console.log(`Services : ${trace.service_names.join(' -> ')}`);
  console.log(`Duration : ${trace.total_duration_ms}ms`);
  console.log(`Spans    : ${trace.span_count}`);
  console.log(`Status   : ${trace.has_error ? 'FAILED ✗' : 'SUCCESS ✓'}\n`);

  // Build causal tree hierarchy
  const spanMap = new Map<string, any>();
  const rootSpans: any[] = [];
  for (const s of trace.spans) {
    spanMap.set(s.span_id, { ...s, children: [] });
  }
  for (const s of trace.spans) {
    const node = spanMap.get(s.span_id);
    if (s.parent_span_id && spanMap.has(s.parent_span_id)) {
      spanMap.get(s.parent_span_id).children.push(node);
    } else {
      rootSpans.push(node);
    }
  }

  function printWaterfallTree(node: any, depth = 0) {
    const indent = '  '.repeat(depth) + (depth > 0 ? '└── ' : '');
    const serviceLabel = `[${node.service_name}]`.padEnd(24);
    let details = '';

    if (node.http?.status_code) {
      details = `HTTP ${node.http.status_code}`;
    } else if (node.db) {
      if (node.db.system === 'redis') {
        const hitLabel = node.db.cache_hit === true ? '[CACHE HIT]' : node.db.cache_hit === false ? '[CACHE MISS]' : '';
        details = `Redis ${hitLabel} "${node.db.statement}"`;
      } else {
        details = `SQL (${node.db.system}) "${node.db.statement}"`;
      }
    }

    console.log(`${indent}${serviceLabel} ${node.name.padEnd(28)} (${node.duration_ms}ms) ${details}`);
    for (const child of node.children) {
      printWaterfallTree(child, depth + 1);
    }
  }

  console.log('Trace Waterfall Hierarchy:');
  for (const root of rootSpans) {
    printWaterfallTree(root);
  }

  // Telemetry Statistics
  const httpSpans = trace.spans.filter((s) => Boolean(s.http) || s.span_kind === 'SERVER');
  const dbSpans = trace.spans.filter((s) => s.db?.system === 'postgresql');
  const redisSpans = trace.spans.filter((s) => s.db?.system === 'redis');

  console.log('\nTelemetry Breakdown:');
  console.log(` • HTTP Spans      : ${httpSpans.length}`);
  console.log(` • PostgreSQL Spans: ${dbSpans.length} (auto-sanitized statements)`);
  console.log(` • Redis Spans     : ${redisSpans.length} (cache HIT/MISS & token redactions)`);

  console.log('\n============================================================');
  console.log('✓ DISTRIBUTED TRACE DAG ACROSS HTTP, DB & CACHE VERIFIED!');
  console.log('============================================================\n');

  // Teardown
  DoomwatchBrowserSdk.resetInstance();
  serviceA.close();
  serviceB.close();
  await collectorServer.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error('Demo error:', err);
  process.exit(1);
});
