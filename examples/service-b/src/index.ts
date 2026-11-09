import express from 'express';
import Doomwatch from '@doomwatch/node';

// Simulated/In-Memory Redis Cache Client
export class MockRedisCache {
  private store = new Map<string, any>();

  async sendCommand(command: { name: string; args: any[] }): Promise<any> {
    // Simulate lightweight cache roundtrip latency (3ms)
    await new Promise((resolve) => setTimeout(resolve, 3));

    const op = command.name.toUpperCase();
    const [key, val] = command.args;

    if (op === 'GET') {
      return this.store.has(key) ? this.store.get(key) : null;
    }
    if (op === 'SET') {
      this.store.set(key, val);
      return 'OK';
    }
    return null;
  }
}

// Simulated/In-Memory PostgreSQL Database Client for Payments
export class MockPaymentDatabase {
  async query(sqlText: string, values?: any[]): Promise<{ rows: any[]; rowCount: number }> {
    // Simulate lightweight DB roundtrip latency (6ms)
    await new Promise((resolve) => setTimeout(resolve, 6));
    return { rows: [], rowCount: 1 };
  }
}

export interface ServiceBOptions {
  cacheClient?: any;
  dbClient?: any;
}

export function createServiceB(
  collectorUrl: string = 'http://localhost:4000',
  options: ServiceBOptions = {}
) {
  // 1. Initialize Doomwatch SDK
  Doomwatch.init({
    serviceName: 'payment-service',
    collectorUrl,
    batchIntervalMs: 200,
    batchSize: 5
  });

  // 2. Set up Redis Cache and PostgreSQL clients with Doomwatch auto-instrumentation
  const cache = options.cacheClient || new MockRedisCache();
  const db = options.dbClient || new MockPaymentDatabase();
  Doomwatch.instrumentRedis(cache, 'payment-service');
  Doomwatch.instrumentPg(db, 'payment-service');

  const app = express();
  app.use(express.json());

  // 3. Attach Doomwatch incoming request middleware
  app.use(Doomwatch.middleware('payment-service'));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'payment-service' });
  });

  app.post('/charge', async (req, res) => {
    const { orderId = 'ord-unknown', amount = 0, currency = 'USD' } = req.body || {};
    const idempotencyKey = `idempotency:${orderId}`;
    const transactionId = `txn-${Date.now()}`;

    // Step 1: Redis cache check for idempotency (Cache MISS on first checkout, HIT on duplicates)
    const cachedStatus = await cache.sendCommand({
      name: 'GET',
      args: [idempotencyKey]
    });

    if (cachedStatus) {
      return res.json({
        transactionId: `cached-${transactionId}`,
        status: cachedStatus,
        amount,
        currency,
        cached: true,
        activeTraceId: Doomwatch.getActiveTraceId()
      });
    }

    // Step 2: Persist payment transaction into PostgreSQL database
    // Sanitized statement and duration captured automatically by Doomwatch
    await db.query(
      `INSERT INTO payments (txn_id, order_id, amount, currency, status) VALUES ('${transactionId}', '${orderId}', ${amount}, '${currency}', 'authorized');`
    );

    // Step 3: Populate Redis cache with auth token (sensitive tokens redacted)
    await cache.sendCommand({
      name: 'SET',
      args: [idempotencyKey, 'secret-auth-token-9988', 'EX', '3600']
    });

    res.json({
      transactionId,
      status: 'paid',
      amount,
      currency,
      cached: false,
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
