import {
  Span,
  generateSpanId,
  generateTraceId,
  sanitizeSqlQuery
} from '@doomwatch/core';
import { getActiveTraceContext, getActiveSpan } from '../context.js';
import { DoomwatchExporter } from '../exporter.js';

export interface PgPatchOptions {
  serviceName: string;
  exporter: DoomwatchExporter;
  maxStatementBytes?: number;
}

const PATCHED_FLAG = Symbol.for('doomwatch_pg_patched');

/**
 * Instruments a PostgreSQL Client or Pool prototype, or an instance.
 */
export function instrumentPgTarget(
  target: any,
  options: PgPatchOptions
): void {
  if (!target || typeof target.prototype?.query !== 'function') {
    if (typeof target?.query === 'function' && !target[PATCHED_FLAG]) {
      wrapQueryMethod(target, options);
    }
    return;
  }

  if (target.prototype[PATCHED_FLAG]) return;
  target.prototype[PATCHED_FLAG] = true;

  wrapQueryMethod(target.prototype, options);
}

function wrapQueryMethod(proto: any, options: PgPatchOptions): void {
  const originalQuery = proto.query;
  const { serviceName, exporter, maxStatementBytes = 2048 } = options;
  const runtime = `node-${process.version}`;

  proto.query = function patchedQuery(this: any, ...args: any[]) {
    let sqlText = '';
    let callback: ((err: any, result?: any) => void) | undefined;

    // Detect SQL string or Config object
    if (typeof args[0] === 'string') {
      sqlText = args[0];
    } else if (typeof args[0] === 'object' && args[0] !== null) {
      sqlText = args[0].text || '';
    }

    // Find callback if passed
    if (typeof args[1] === 'function') {
      callback = args[1];
    } else if (typeof args[2] === 'function') {
      callback = args[2];
    }

    const activeCtx = getActiveTraceContext();
    const parentSpan = getActiveSpan();
    const traceId = activeCtx?.trace_id || generateTraceId();
    const parentSpanId = parentSpan ? parentSpan.span_id : activeCtx?.span_id || null;
    const childSpanId = generateSpanId();
    const startTime = Date.now();

    const sanitized = sanitizeSqlQuery(sqlText, maxStatementBytes);

    function recordSpan(durationMs: number, err: any, rowCount?: number) {
      try {
        const span: Span = {
          trace_id: traceId,
          span_id: childSpanId,
          parent_span_id: parentSpanId,
          service_name: serviceName,
          runtime,
          span_kind: 'CLIENT',
          name: `postgresql: ${sanitized.operation}${sanitized.table ? ' ' + sanitized.table : ''}`,
          start_time_unix_ms: startTime,
          end_time_unix_ms: startTime + durationMs,
          duration_ms: Math.max(0, durationMs),
          db: {
            system: 'postgresql',
            operation: sanitized.operation,
            collection_or_table: sanitized.table,
            statement: sanitized.statement,
            rows_affected: typeof rowCount === 'number' ? rowCount : undefined
          },
          error: err
            ? {
                name: err.name || 'PostgresError',
                message: err.message || String(err),
                stack: err.stack
              }
            : null
        };
        exporter.enqueue(span);
      } catch {
        // Fail-open: never throw inside tracing recorder
      }
    }

    if (callback) {
      // Callback-based invocation
      const wrappedCallback = (err: any, res?: any) => {
        recordSpan(Date.now() - startTime, err, res?.rowCount);
        return callback!(err, res);
      };

      if (typeof args[1] === 'function') {
        args[1] = wrappedCallback;
      } else if (typeof args[2] === 'function') {
        args[2] = wrappedCallback;
      }

      try {
        return originalQuery.apply(this, args);
      } catch (syncErr) {
        recordSpan(Date.now() - startTime, syncErr);
        throw syncErr;
      }
    }

    // Promise-based invocation
    let resultPromise: any;
    try {
      resultPromise = originalQuery.apply(this, args);
    } catch (syncErr) {
      recordSpan(Date.now() - startTime, syncErr);
      throw syncErr;
    }

    if (resultPromise && typeof resultPromise.then === 'function') {
      return resultPromise
        .then((res: any) => {
          recordSpan(Date.now() - startTime, null, res?.rowCount);
          return res;
        })
        .catch((err: any) => {
          recordSpan(Date.now() - startTime, err);
          throw err;
        });
    }

    return resultPromise;
  };
}
