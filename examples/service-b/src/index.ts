import express from 'express';
import Doomwatch from '@doomwatch/node';

export function createServiceB(collectorUrl: string = 'http://localhost:4000') {
  // 1. Initialize Doomwatch SDK
  Doomwatch.init({
    serviceName: 'payment-service',
    collectorUrl,
    batchIntervalMs: 200,
    batchSize: 5
  });

  const app = express();
  app.use(express.json());

  // 2. Attach Doomwatch incoming request middleware
  app.use(Doomwatch.middleware('payment-service'));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'payment-service' });
  });

  app.post('/charge', async (req, res) => {
    // Normal business logic - ZERO tracing parameter passing!
    const { amount = 0, currency = 'USD' } = req.body || {};

    // Simulate 30ms processing latency
    await new Promise((resolve) => setTimeout(resolve, 30));

    res.json({
      transactionId: `txn-${Date.now()}`,
      status: 'paid',
      amount,
      currency,
      activeTraceId: Doomwatch.getActiveTraceId()
    });
  });

  return app;
}

// Auto-run if executed as main file
if (process.argv[1]?.endsWith('service-b/dist/index.js')) {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3002;
  const collector = process.env.DOOMWATCH_COLLECTOR_URL || 'http://localhost:4000';
  const app = createServiceB(collector);
  app.listen(port, () => {
    console.log(`[Service B: Payment Service] Running on http://localhost:${port}`);
  });
}
