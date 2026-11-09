import {
  Span,
  generateSpanId,
  generateTraceId,
  sanitizeMongoFilter
} from '@doomwatch/core';
import { getActiveTraceContext, getActiveSpan } from '../context.js';
import { DoomwatchExporter } from '../exporter.js';

export interface MongoPatchOptions {
  serviceName: string;
  exporter: DoomwatchExporter;
  maxStatementBytes?: number;
}

const MONGO_INSTRUMENTED = Symbol.for('doomwatch_mongo_instrumented');

interface InFlightCommand {
  startTime: number;
  traceId: string;
  parentSpanId: string | null;
  childSpanId: string;
  operation: string;
  collection: string;
  dbName?: string;
  statement: string;
}

/**
 * Instruments a MongoClient instance using the official Command Monitoring API.
 */
export function instrumentMongoClient(
  client: any,
  options: MongoPatchOptions
): void {
  if (!client || typeof client.on !== 'function') return;
  if (client[MONGO_INSTRUMENTED]) return;
  client[MONGO_INSTRUMENTED] = true;

  const { serviceName, exporter, maxStatementBytes = 2048 } = options;
  const runtime = `node-${process.version}`;
  const inFlightCommands = new Map<number | string, InFlightCommand>();

  client.on('commandStarted', (event: any) => {
    try {
      const activeCtx = getActiveTraceContext();
      const parentSpan = getActiveSpan();
      const traceId = activeCtx?.trace_id || generateTraceId();
      const parentSpanId = parentSpan ? parentSpan.span_id : activeCtx?.span_id || null;
      const childSpanId = generateSpanId();
      const operation = event.commandName || 'command';

      const collectionRaw = event.command ? event.command[operation] || event.command.collection : null;
      const collection = typeof collectionRaw === 'string' ? collectionRaw : event.databaseName || 'unknown';
      const statement = sanitizeMongoFilter(event.command, maxStatementBytes);

      inFlightCommands.set(event.requestId, {
        startTime: Date.now(),
        traceId,
        parentSpanId,
        childSpanId,
        operation,
        collection,
        dbName: event.databaseName,
        statement
      });
    } catch {
      // Fail-open
    }
  });

  client.on('commandSucceeded', (event: any) => {
    try {
      const pending = inFlightCommands.get(event.requestId);
      if (!pending) return;
      inFlightCommands.delete(event.requestId);

      const endTime = Date.now();
      const durationMs =
        event.duration != null ? Math.round(event.duration) : Math.max(0, endTime - pending.startTime);

      const rowsAffected = event.reply?.n || event.reply?.nModified || (event.reply?.ok === 1 ? 1 : undefined);

      const span: Span = {
        trace_id: pending.traceId,
        span_id: pending.childSpanId,
        parent_span_id: pending.parentSpanId,
        service_name: serviceName,
        runtime,
        span_kind: 'CLIENT',
        name: `mongodb: ${pending.operation} ${pending.collection}`,
        start_time_unix_ms: pending.startTime,
        end_time_unix_ms: endTime,
        duration_ms: durationMs,
        db: {
          system: 'mongodb',
          name: pending.dbName,
          operation: pending.operation,
          collection_or_table: pending.collection,
          statement: pending.statement,
          rows_affected: typeof rowsAffected === 'number' ? rowsAffected : undefined
        }
      };
      exporter.enqueue(span);
    } catch {
      // Fail-open
    }
  });

  client.on('commandFailed', (event: any) => {
    try {
      const pending = inFlightCommands.get(event.requestId);
      if (!pending) return;
      inFlightCommands.delete(event.requestId);

      const endTime = Date.now();
      const durationMs =
        event.duration != null ? Math.round(event.duration) : Math.max(0, endTime - pending.startTime);

      const span: Span = {
        trace_id: pending.traceId,
        span_id: pending.childSpanId,
        parent_span_id: pending.parentSpanId,
        service_name: serviceName,
        runtime,
        span_kind: 'CLIENT',
        name: `mongodb: ${pending.operation} ${pending.collection}`,
        start_time_unix_ms: pending.startTime,
        end_time_unix_ms: endTime,
        duration_ms: durationMs,
        db: {
          system: 'mongodb',
          name: pending.dbName,
          operation: pending.operation,
          collection_or_table: pending.collection,
          statement: pending.statement
        },
        error: event.failure
          ? {
              name: event.failure.name || 'MongoError',
              message: event.failure.message || String(event.failure),
              stack: event.failure.stack
            }
          : null
      };
      exporter.enqueue(span);
    } catch {
      // Fail-open
    }
  });
}
