import { IncomingMessage, ServerResponse } from 'node:http';
import {
  Span,
  extractOrGenerateTraceContext,
  formatTraceparent,
  redactHeaders,
  sanitizePayload
} from '@doomwatch/core';
import { runInTraceContext } from './context.js';
import { DoomwatchExporter } from './exporter.js';

export interface MiddlewareOptions {
  serviceName: string;
  exporter: DoomwatchExporter;
  maxBodyBytes?: number;
  redactedKeys?: string[];
}

/**
 * Express / Connect / HTTP Middleware for automatic incoming request tracing.
 * Captures request & response headers, bodies, latencies, and maintains ambient trace context.
 */
export function createDoomwatchMiddleware(options: MiddlewareOptions) {
  const { serviceName, exporter, maxBodyBytes = 4096, redactedKeys } = options;
  const runtime = `node-${process.version}`;

  return function doomwatchMiddleware(
    req: IncomingMessage & { body?: unknown; originalUrl?: string; baseUrl?: string },
    res: ServerResponse & { getHeaders?: () => Record<string, string | string[] | undefined> },
    next?: (err?: any) => void
  ): void {
    const startTime = Date.now();
    const headers = req.headers as Record<string, string | string[] | undefined>;

    // 1. Extract existing trace or generate a new root trace (never blank)
    const traceCtx = extractOrGenerateTraceContext(headers);

    // 2. Attach trace headers to outgoing response so caller receives correlation ID
    res.setHeader('x-tracing-id', traceCtx.trace_id);
    res.setHeader('traceparent', formatTraceparent(traceCtx.trace_id, traceCtx.span_id));

    const rawUrl = req.originalUrl || req.url || '/';
    const cleanRoute = rawUrl.split('?')[0];

    // 3. Initialize Server Span
    const span: Span = {
      trace_id: traceCtx.trace_id,
      span_id: traceCtx.span_id,
      parent_span_id: traceCtx.parent_span_id,
      service_name: serviceName,
      runtime,
      span_kind: 'SERVER',
      name: `${req.method || 'GET'} ${cleanRoute}`,
      start_time_unix_ms: startTime,
      end_time_unix_ms: 0,
      duration_ms: 0,
      http: {
        method: req.method || 'GET',
        url: rawUrl,
        route: cleanRoute,
        request_headers: redactHeaders(headers)
      }
    };

    // 4. Capture response payload and lifecycle hooks
    const originalWrite = res.write;
    const originalEnd = res.end;
    const responseChunks: Buffer[] = [];
    let responseBytes = 0;

    res.write = function (chunk: any, ...args: any[]): boolean {
      if (chunk && responseBytes < maxBodyBytes) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        responseChunks.push(buf);
        responseBytes += buf.length;
      }
      return originalWrite.apply(res, [chunk, ...args] as any);
    };

    res.end = function (chunk?: any, ...args: any[]): any {
      if (chunk && responseBytes < maxBodyBytes) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        responseChunks.push(buf);
        responseBytes += buf.length;
      }

      const endTime = Date.now();
      span.end_time_unix_ms = endTime;
      span.duration_ms = Math.max(0, endTime - startTime);

      if (span.http) {
        span.http.status_code = res.statusCode;
        span.http.response_headers = redactHeaders(
          typeof res.getHeaders === 'function' ? (res.getHeaders() as any) : undefined
        );

        // Capture request body if parsed by body-parser or middleware
        if (req.body) {
          span.http.request_body = sanitizePayload(req.body, maxBodyBytes, redactedKeys);
        }

        // Parse response body
        if (responseChunks.length > 0) {
          const rawResponse = Buffer.concat(responseChunks).toString('utf8');
          try {
            const parsed = JSON.parse(rawResponse);
            span.http.response_body = sanitizePayload(parsed, maxBodyBytes, redactedKeys);
          } catch {
            span.http.response_body = sanitizePayload(rawResponse, maxBodyBytes, redactedKeys);
          }
        }
      }

      // Record error if status code >= 500
      if (res.statusCode >= 500 && !span.error) {
        span.error = {
          name: 'HttpError',
          message: `Request failed with HTTP status ${res.statusCode}`
        };
      }

      // Enqueue to exporter without blocking
      exporter.enqueue(span);

      return originalEnd.apply(res, [chunk, ...args] as any);
    };

    // 5. Run the request handler inside the active async trace context
    runInTraceContext(traceCtx, span, () => {
      if (typeof next === 'function') {
        next();
      }
    });
  };
}
