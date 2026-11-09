import {
  Span,
  generateSpanId,
  generateTraceId,
  sanitizeRedisCommand
} from '@doomwatch/core';
import { getActiveTraceContext, getActiveSpan } from '../context.js';
import { DoomwatchExporter } from '../exporter.js';

export interface RedisPatchOptions {
  serviceName: string;
  exporter: DoomwatchExporter;
  maxStatementBytes?: number;
}

const PATCHED_FLAG = Symbol.for('doomwatch_redis_patched');

/**
 * Instruments a Redis Client or prototype (supporting ioredis and node-redis).
 */
export function instrumentRedisTarget(
  target: any,
  options: RedisPatchOptions
): void {
  const proto = target?.prototype || target;
  if (!proto) return;

  if (proto[PATCHED_FLAG]) return;
  proto[PATCHED_FLAG] = true;

  if (typeof proto.sendCommand === 'function') {
    wrapSendCommand(proto, options);
  }
}

function wrapSendCommand(proto: any, options: RedisPatchOptions): void {
  const originalSendCommand = proto.sendCommand;
  const { serviceName, exporter, maxStatementBytes = 2048 } = options;
  const runtime = `node-${process.version}`;

  proto.sendCommand = function patchedSendCommand(this: any, command: any, ...rest: any[]) {
    // ioredis passes a Command object (command.name, command.args)
    // node-redis passes an array or command name directly
    let cmdName = 'COMMAND';
    let cmdArgs: any[] = [];

    if (command && typeof command.name === 'string') {
      cmdName = command.name;
      cmdArgs = Array.isArray(command.args) ? command.args : [];
    } else if (typeof command === 'string') {
      cmdName = command;
      cmdArgs = rest;
    } else if (Array.isArray(command)) {
      cmdName = String(command[0] || 'COMMAND');
      cmdArgs = command.slice(1);
    }

    const activeCtx = getActiveTraceContext();
    const parentSpan = getActiveSpan();
    const traceId = activeCtx?.trace_id || generateTraceId();
    const parentSpanId = parentSpan ? parentSpan.span_id : activeCtx?.span_id || null;
    const childSpanId = generateSpanId();
    const startTime = Date.now();

    const sanitized = sanitizeRedisCommand(cmdName, cmdArgs, maxStatementBytes);

    function evaluateCacheHit(result: any): boolean | undefined {
      const op = cmdName.toUpperCase();
      if (op === 'GET' || op === 'HGET') {
        return result !== null && result !== undefined;
      }
      if (op === 'EXISTS' || op === 'HEXISTS') {
        return result === 1 || result === true;
      }
      return undefined;
    }

    function recordSpan(durationMs: number, err: any, result?: any) {
      try {
        const span: Span = {
          trace_id: traceId,
          span_id: childSpanId,
          parent_span_id: parentSpanId,
          service_name: serviceName,
          runtime,
          span_kind: 'CLIENT',
          name: `redis: ${sanitized.operation}${sanitized.key ? ' ' + sanitized.key : ''}`,
          start_time_unix_ms: startTime,
          end_time_unix_ms: startTime + durationMs,
          duration_ms: Math.max(0, durationMs),
          db: {
            system: 'redis',
            operation: sanitized.operation,
            collection_or_table: sanitized.key,
            statement: sanitized.statement,
            cache_hit: evaluateCacheHit(result)
          },
          error: err
            ? {
                name: err.name || 'RedisError',
                message: err.message || String(err),
                stack: err.stack
              }
            : null
        };
        exporter.enqueue(span);
      } catch {
        // Fail-open: swallow tracing errors
      }
    }

    // Intercept ioredis command.promise if present
    if (command && command.promise && typeof command.promise.then === 'function') {
      command.promise
        .then((res: any) => {
          recordSpan(Date.now() - startTime, null, res);
        })
        .catch((err: any) => {
          recordSpan(Date.now() - startTime, err);
        });

      return originalSendCommand.call(this, command, ...rest);
    }

    // Standard Promise return
    let resPromise: any;
    try {
      resPromise = originalSendCommand.call(this, command, ...rest);
    } catch (syncErr) {
      recordSpan(Date.now() - startTime, syncErr);
      throw syncErr;
    }

    if (resPromise && typeof resPromise.then === 'function') {
      return resPromise
        .then((res: any) => {
          recordSpan(Date.now() - startTime, null, res);
          return res;
        })
        .catch((err: any) => {
          recordSpan(Date.now() - startTime, err);
          throw err;
        });
    }

    return resPromise;
  };
}
