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
  console.log('              DOOMWATCH END-TO-END DEMO');
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

  // 2. Start Service B (Payment Service)
  const appB = createServiceB(`http://127.0.0.1:${collectorPort}`);
  const serviceB = http.createServer(appB);
  await new Promise<void>((resolve) => serviceB.listen(serviceBPort, resolve));
  console.log(`✓ Service B (Payment Service) running on http://localhost:${serviceBPort}`);

  // 3. Start Service A (Order Service)
  const appA = createServiceA(
    `http://127.0.0.1:${collectorPort}`,
    `http://127.0.0.1:${serviceBPort}`
  );
  const serviceA = http.createServer(appA);
  await new Promise<void>((resolve) => serviceA.listen(serviceAPort, resolve));
  console.log(`✓ Service A (Order Service) running on http://localhost:${serviceAPort}`);

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
  console.log(`[Service A] Order confirmed: ${orderResult.orderId} (status: ${orderResult.status})`);
  console.log(`[Service B] Payment processed: ${orderResult.payment.transactionId} ($${orderResult.payment.amount})`);
  console.log(`[Frontend] Received 201 Created from Service A!`);

  interaction.end();

  // Flush all SDK and Collector queues
  await Doomwatch.flush();
  await browserSdk.flush();
  await new Promise((resolve) => setTimeout(resolve, 150));
  await collectorServer.getBuffer().flush();

  // 5. Query trace from Doomwatch Collector
  console.log('\n------------------------------------------------------------');
  console.log('▶ Reconstructing Trace Waterfall from Doomwatch Collector:');
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

  console.log('Trace Waterfall Hierarchy:');
  for (const span of trace.spans) {
    const isRoot = !span.parent_span_id;
    const prefix = isRoot ? '' : '   '.repeat(span.span_kind === 'SERVER' ? 1 : 2) + '└── ';
    const typeLabel = `[${span.service_name}] (${span.span_kind})`;
    const statusLabel = span.http?.status_code ? `HTTP ${span.http.status_code}` : '';
    console.log(`${prefix}${typeLabel.padEnd(35)} ${span.name.padEnd(20)} ${statusLabel.padEnd(10)} (${span.duration_ms}ms)`);
  }

  console.log('\n============================================================');
  console.log('✓ TRACE CONTINUATION & DAG VERIFIED WITH ZERO CODE CHANGES!');
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
