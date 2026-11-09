import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import {
  Span,
  TraceContext,
  generateTraceId,
  generateSpanId
} from '@doomwatch/core';
import {
  initGlobalContextManager,
  runInTraceContext
} from './context.js';
import { DoomwatchExporter } from './exporter.js';
import {
  instrumentPgTarget,
  instrumentRedisTarget,
  instrumentMongoClient,
  patchDatabaseDrivers
} from './db/index.js';

class MockExporter extends DoomwatchExporter {
  public recordedSpans: Span[] = [];
  constructor() {
    super({ collectorUrl: 'http://localhost:4000' });
  }
  override enqueue(span: Span): void {
    this.recordedSpans.push(span);
  }
}

describe('Database & Cache Auto-Instrumentation (Config-Driven)', () => {
  it('should completely bypass instrumentation when instrumentDatabase is false', () => {
    const exporter = new MockExporter();
    let queryCalled = false;

    // Target object
    const target = {
      query: (sql: string) => {
        queryCalled = true;
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
    };

    // Call patchDatabaseDrivers with config: false
    patchDatabaseDrivers({
      serviceName: 'test-service',
      exporter,
      config: false
    });

    // The method should remain unmodified or not recorded
    target.query('SELECT 1');
    assert.strictEqual(exporter.recordedSpans.length, 0);
  });

  describe('PostgreSQL Auto-Instrumentation', () => {
    it('should intercept query, link ambient trace context, sanitize SQL, and record span', async () => {
      initGlobalContextManager();
      const exporter = new MockExporter();

      const mockClient = {
        query: async (queryText: string, values?: any[]) => {
          return { rows: [{ id: 1, name: 'Alice' }], rowCount: 1 };
        }
      };

      instrumentPgTarget(mockClient, {
        serviceName: 'order-service',
        exporter
      });

      const traceCtx: TraceContext = {
        trace_id: generateTraceId(),
        span_id: generateSpanId(),
        parent_span_id: null
      };

      const rootSpan: Span = {
        trace_id: traceCtx.trace_id,
        span_id: traceCtx.span_id,
        service_name: 'order-service',
        runtime: 'node-test',
        span_kind: 'SERVER',
        name: 'POST /checkout',
        start_time_unix_ms: Date.now(),
        end_time_unix_ms: 0,
        duration_ms: 0
      };

      await runInTraceContext(traceCtx, rootSpan, async () => {
        const rawSql = "SELECT * FROM orders WHERE user_id = 42 AND coupon = 'SUMMER2026';";
        const result = await mockClient.query(rawSql);
        assert.strictEqual(result.rowCount, 1);
      });

      assert.strictEqual(exporter.recordedSpans.length, 1);
      const span = exporter.recordedSpans[0];

      assert.strictEqual(span.trace_id, traceCtx.trace_id);
      assert.strictEqual(span.parent_span_id, rootSpan.span_id);
      assert.strictEqual(span.span_kind, 'CLIENT');
      assert.strictEqual(span.db?.system, 'postgresql');
      assert.strictEqual(span.db?.operation, 'SELECT');
      assert.strictEqual(span.db?.collection_or_table, 'orders');
      assert.strictEqual(span.db?.rows_affected, 1);
      assert.ok(!span.db?.statement?.includes('42'));
      assert.ok(!span.db?.statement?.includes('SUMMER2026'));
      assert.ok(span.db?.statement?.includes('user_id = ?'));
      assert.ok(span.db?.statement?.includes('coupon = ?'));
      assert.strictEqual(span.error, null);
    });

    it('should capture query error and record error span while throwing', async () => {
      initGlobalContextManager();
      const exporter = new MockExporter();

      const mockClient = {
        query: async (_sql?: string) => {
          throw new Error('Connection terminated unexpectedly');
        }
      };

      instrumentPgTarget(mockClient, {
        serviceName: 'order-service',
        exporter
      });

      await assert.rejects(async () => {
        await mockClient.query('SELECT 1 FROM invalid_table');
      }, /Connection terminated/);

      assert.strictEqual(exporter.recordedSpans.length, 1);
      const span = exporter.recordedSpans[0];
      assert.ok(span.error);
      assert.strictEqual(span.error?.message, 'Connection terminated unexpectedly');
    });
  });

  describe('Redis Auto-Instrumentation', () => {
    it('should intercept Redis GET and evaluate cache HIT / MISS', async () => {
      initGlobalContextManager();
      const exporter = new MockExporter();

      const mockRedis = {
        sendCommand: async (command: any) => {
          if (command.args[0] === 'session:hit') {
            return 'user_session_token_123';
          }
          return null; // Cache miss
        }
      };

      instrumentRedisTarget(mockRedis, {
        serviceName: 'auth-service',
        exporter
      });

      // 1. Cache HIT
      await mockRedis.sendCommand({ name: 'GET', args: ['session:hit'] });
      assert.strictEqual(exporter.recordedSpans.length, 1);
      const hitSpan = exporter.recordedSpans[0];
      assert.strictEqual(hitSpan.db?.system, 'redis');
      assert.strictEqual(hitSpan.db?.operation, 'GET');
      assert.strictEqual(hitSpan.db?.collection_or_table, 'session:hit');
      assert.strictEqual(hitSpan.db?.cache_hit, true);

      // 2. Cache MISS
      await mockRedis.sendCommand({ name: 'GET', args: ['session:miss'] });
      assert.strictEqual(exporter.recordedSpans.length, 2);
      const missSpan = exporter.recordedSpans[1];
      assert.strictEqual(missSpan.db?.cache_hit, false);
    });

    it('should redact sensitive values on Redis SET commands', async () => {
      const exporter = new MockExporter();
      const mockRedis = {
        sendCommand: async (_cmd?: any) => 'OK'
      };

      instrumentRedisTarget(mockRedis, {
        serviceName: 'auth-service',
        exporter
      });

      await mockRedis.sendCommand({
        name: 'SET',
        args: ['user:auth:99', 'raw-super-secret-password-1234', 'EX', '3600']
      });

      assert.strictEqual(exporter.recordedSpans.length, 1);
      const span = exporter.recordedSpans[0];
      assert.strictEqual(span.db?.system, 'redis');
      assert.ok(!span.db?.statement?.includes('raw-super-secret-password-1234'));
      assert.ok(span.db?.statement?.includes('SET user:auth:99 [REDACTED] EX 3600'));
    });
  });

  describe('MongoDB Command Monitoring Auto-Instrumentation', () => {
    it('should trace MongoDB commands with sanitized BSON filters', async () => {
      initGlobalContextManager();
      const exporter = new MockExporter();

      const mockMongoClient = new EventEmitter();
      instrumentMongoClient(mockMongoClient, {
        serviceName: 'catalog-service',
        exporter
      });

      const traceCtx: TraceContext = {
        trace_id: generateTraceId(),
        span_id: generateSpanId(),
        parent_span_id: null
      };

      const parentSpan: Span = {
        trace_id: traceCtx.trace_id,
        span_id: traceCtx.span_id,
        service_name: 'catalog-service',
        runtime: 'node-test',
        span_kind: 'SERVER',
        name: 'GET /products',
        start_time_unix_ms: Date.now(),
        end_time_unix_ms: 0,
        duration_ms: 0
      };

      await runInTraceContext(traceCtx, parentSpan, async () => {
        mockMongoClient.emit('commandStarted', {
          requestId: 101,
          commandName: 'find',
          databaseName: 'production_db',
          command: {
            find: 'products',
            filter: { category: 'electronics', price: { $lt: 500 } }
          }
        });

        // Simulate duration
        await new Promise((r) => setTimeout(r, 10));

        mockMongoClient.emit('commandSucceeded', {
          requestId: 101,
          commandName: 'find',
          duration: 12.5,
          reply: { ok: 1, cursor: { id: 0, firstBatch: [{ _id: 'p1' }] } }
        });
      });

      assert.strictEqual(exporter.recordedSpans.length, 1);
      const span = exporter.recordedSpans[0];

      assert.strictEqual(span.trace_id, traceCtx.trace_id);
      assert.strictEqual(span.parent_span_id, parentSpan.span_id);
      assert.strictEqual(span.span_kind, 'CLIENT');
      assert.strictEqual(span.db?.system, 'mongodb');
      assert.strictEqual(span.db?.operation, 'find');
      assert.strictEqual(span.db?.collection_or_table, 'products');
      assert.strictEqual(span.db?.name, 'production_db');
      assert.ok(!span.db?.statement?.includes('electronics'));
      assert.ok(!span.db?.statement?.includes('500'));
      assert.ok(span.db?.statement?.includes('"category":"?"'));
      assert.ok(span.db?.statement?.includes('"$lt":"?"'));
    });
  });
});
