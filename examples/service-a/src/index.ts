import express from 'express';
import Doomwatch from '@doomwatch/node';

export function createServiceA(
  collectorUrl: string = 'http://localhost:4000',
  serviceBUrl: string = 'http://localhost:3002'
) {
  // 1. Initialize Doomwatch SDK
  Doomwatch.init({
    serviceName: 'order-service',
    collectorUrl,
    batchIntervalMs: 200,
    batchSize: 5
  });

  const app = express();
  app.use(express.json());

  // 2. Attach Doomwatch incoming request middleware
  app.use(Doomwatch.middleware('order-service'));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'order-service' });
  });

  app.post('/orders', async (req, res) => {
    const { item = 'Widget', price = 99 } = req.body || {};

    try {
      // Call downstream Payment Service (Service B)
      // NOTICE: User writes normal fetch() with ZERO trace parameters!
      // Doomwatch automatically injects W3C traceparent and continuation trace ID.
      const paymentResponse = await fetch(`${serviceBUrl}/charge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: price, currency: 'USD' })
      });

      const paymentData = (await paymentResponse.json()) as any;

      res.status(201).json({
        orderId: `ord-${Date.now()}`,
        status: 'confirmed',
        item,
        price,
        payment: paymentData,
        activeTraceId: Doomwatch.getActiveTraceId()
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to process order', message: err.message });
    }
  });

  return app;
}

// Auto-run if executed as main file
if (process.argv[1]?.endsWith('service-a/dist/index.js')) {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  const collector = process.env.DOOMWATCH_COLLECTOR_URL || 'http://localhost:4000';
  const serviceB = process.env.SERVICE_B_URL || 'http://localhost:3002';
  const app = createServiceA(collector, serviceB);
  app.listen(port, () => {
    console.log(`[Service A: Order Service] Running on http://localhost:${port}`);
  });
}
