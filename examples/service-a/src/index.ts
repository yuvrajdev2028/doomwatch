import express from 'express';
import Doomwatch from '@doomwatch/node';

// Simulated/In-Memory PostgreSQL Database Client
export class MockPostgresDb {
  private orders = new Map<string, any>();

  async query(sqlText: string, values?: any[]): Promise<{ rows: any[]; rowCount: number }> {
    // Simulate lightweight DB roundtrip latency (8ms)
    await new Promise((resolve) => setTimeout(resolve, 8));

    if (/insert\s+into\s+orders/i.test(sqlText)) {
      return { rows: [], rowCount: 1 };
    }
    if (/update\s+orders/i.test(sqlText)) {
      return { rows: [], rowCount: 1 };
    }
    return { rows: Array.from(this.orders.values()), rowCount: this.orders.size };
  }
}

export interface ServiceAOptions {
  dbClient?: any;
}

export function createServiceA(
  collectorUrl: string = 'http://localhost:4000',
  serviceBUrl: string = 'http://localhost:3002',
  options: ServiceAOptions = {}
) {
  // 1. Initialize Doomwatch SDK
  Doomwatch.init({
    serviceName: 'order-service',
    collectorUrl,
    batchIntervalMs: 200,
    batchSize: 5
  });

  // 2. Set up PostgreSQL client and instrument with Doomwatch
  const db = options.dbClient || new MockPostgresDb();
  Doomwatch.instrumentPg(db, 'order-service');

  const app = express();
  app.use(express.json());

  // 3. Attach Doomwatch incoming request middleware
  app.use(Doomwatch.middleware('order-service'));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'order-service' });
  });

  app.post('/orders', async (req, res) => {
    const { item = 'Widget', price = 99 } = req.body || {};
    const orderId = `ord-${Date.now()}`;

    try {
      // Step 1: Persist initial order record into PostgreSQL
      // Doomwatch automatically intercepts this query, sanitizes SQL, and records a CLIENT DB span
      await db.query(
        `INSERT INTO orders (id, item, price, status) VALUES ('${orderId}', '${item}', ${price}, 'pending');`
      );

      // Step 2: Call downstream Payment Service (Service B)
      // Doomwatch automatically injects W3C traceparent header on outgoing fetch()
      const paymentResponse = await fetch(`${serviceBUrl}/charge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, amount: price, currency: 'USD' })
      });

      const paymentData = (await paymentResponse.json()) as any;

      // Step 3: Update order status to 'confirmed' in PostgreSQL
      // Doomwatch intercepts this query and links it to the active order-service trace
      await db.query(
        `UPDATE orders SET status = 'confirmed' WHERE id = '${orderId}';`
      );

      res.status(201).json({
        orderId,
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
