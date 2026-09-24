import http, { ClientRequest, ClientRequestArgs, IncomingMessage } from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import {
  Span,
  generateSpanId,
  generateTraceId,
  formatTraceparent,
  redactHeaders,
  sanitizePayload
} from '@doomwatch/core';
import { getActiveTraceContext, getActiveSpan } from './context.js';
import { DoomwatchExporter } from './exporter.js';

export interface PatchHttpOptions {
  serviceName: string;
  collectorUrl: string;
  exporter: DoomwatchExporter;
  maxBodyBytes?: number;
  redactedKeys?: string[];
}

let isPatched = false;

/**
 * Patches global http.request, https.request, and globalThis.fetch to automatically
 * inject W3C traceparent headers and record CLIENT spans.
 */
export function patchHttpClients(options: PatchHttpOptions): void {
  if (isPatched) return;
  isPatched = true;

  const { serviceName, collectorUrl, exporter, maxBodyBytes = 4096, redactedKeys } = options;
  const collectorHost = new URL(collectorUrl).host;
  const runtime = `node-${process.version}`;

  // -------------------------------------------------------------
  // 1. Patch http.request and https.request
  // -------------------------------------------------------------
  function wrapRequestMethod(originalRequest: typeof http.request, protocol: 'http:' | 'https:') {
    return function patchedRequest(
      this: unknown,
      ...args: any[]
    ): ClientRequest {
      let urlArg: string | URL | null = null;
      let optionsArg: ClientRequestArgs = {};
      let cbArg: ((res: IncomingMessage) => void) | undefined;

      if (typeof args[0] === 'string' || args[0] instanceof URL) {
        urlArg = args[0];
        if (typeof args[1] === 'object' && args[1] !== null) {
          optionsArg = { ...args[1] };
          if (typeof args[2] === 'function') cbArg = args[2];
        } else if (typeof args[1] === 'function') {
          cbArg = args[1];
        }
      } else if (typeof args[0] === 'object' && args[0] !== null) {
        optionsArg = { ...args[0] };
        if (typeof args[1] === 'function') cbArg = args[1];
      }

      // Determine destination host & URL
      const host =
        optionsArg.host ||
        optionsArg.hostname ||
        (urlArg ? (typeof urlArg === 'string' ? new URL(urlArg).host : urlArg.host) : 'localhost');
      const port = optionsArg.port || (protocol === 'https:' ? 443 : 80);
      const path =
        optionsArg.path ||
        (urlArg ? (typeof urlArg === 'string' ? new URL(urlArg).pathname : urlArg.pathname) : '/');
      const method = (optionsArg.method || 'GET').toUpperCase();

      // Skip tracing requests to the Doomwatch Collector itself to avoid infinite feedback loops
      if (host.includes(collectorHost)) {
        return originalRequest.apply(this, args as any);
      }

      // Check ambient context
      const activeCtx = getActiveTraceContext();
      const parentSpan = getActiveSpan();

      const traceId = activeCtx ? activeCtx.trace_id : generateTraceId();
      const childSpanId = generateSpanId();
      const parentSpanId = parentSpan ? parentSpan.span_id : activeCtx?.span_id || null;

      // Inject trace headers into outgoing request
      optionsArg.headers = optionsArg.headers || {};
      (optionsArg.headers as any)['traceparent'] = formatTraceparent(traceId, childSpanId);
      (optionsArg.headers as any)['x-tracing-id'] = traceId;
      if (parentSpanId) {
        (optionsArg.headers as any)['x-parent-id'] = parentSpanId;
      }

      const startTime = Date.now();
      const fullUrl = `${protocol}//${host}:${port}${path}`;

      // Initialize CLIENT Span
      const clientSpan: Span = {
        trace_id: traceId,
        span_id: childSpanId,
        parent_span_id: parentSpanId,
        service_name: serviceName,
        runtime,
        span_kind: 'CLIENT',
        name: `${method} ${path.split('?')[0]}`,
        start_time_unix_ms: startTime,
        end_time_unix_ms: 0,
        duration_ms: 0,
        http: {
          method,
          url: fullUrl,
          route: path.split('?')[0],
          request_headers: redactHeaders(optionsArg.headers as any)
        }
      };

      // Wrap response callback
      const wrappedCb = (res: IncomingMessage) => {
        const endTime = Date.now();
        clientSpan.end_time_unix_ms = endTime;
        clientSpan.duration_ms = Math.max(0, endTime - startTime);

        if (clientSpan.http) {
          clientSpan.http.status_code = res.statusCode;
          clientSpan.http.response_headers = redactHeaders(res.headers as any);
        }

        if (res.statusCode && res.statusCode >= 400 && !clientSpan.error) {
          clientSpan.error = {
            name: 'HttpError',
            message: `Outbound request failed with HTTP ${res.statusCode}`
          };
        }

        exporter.enqueue(clientSpan);

        if (cbArg) {
          cbArg(res);
        }
      };

      // Reassemble arguments
      let newArgs: any[];
      if (urlArg) {
        newArgs = cbArg ? [urlArg, optionsArg, wrappedCb] : [urlArg, optionsArg];
      } else {
        newArgs = cbArg ? [optionsArg, wrappedCb] : [optionsArg];
      }

      const clientReq = originalRequest.apply(this, newArgs as any);

      clientReq.on('error', (err) => {
        const endTime = Date.now();
        clientSpan.end_time_unix_ms = endTime;
        clientSpan.duration_ms = Math.max(0, endTime - startTime);
        clientSpan.error = {
          name: err.name,
          message: err.message,
          stack: err.stack
        };
        exporter.enqueue(clientSpan);
      });

      return clientReq;
    };
  }

  function wrapGetMethod(protocol: 'http:' | 'https:') {
    return function patchedGet(this: unknown, ...args: any[]): ClientRequest {
      const req = (protocol === 'http:' ? http.request : https.request).apply(this, args as any);
      req.end();
      return req;
    };
  }

  http.request = wrapRequestMethod(http.request, 'http:');
  http.get = wrapGetMethod('http:') as typeof http.get;
  https.request = wrapRequestMethod(https.request, 'https:');
  https.get = wrapGetMethod('https:') as typeof https.get;

  // -------------------------------------------------------------
  // 2. Patch globalThis.fetch (for Node 18+)
  // -------------------------------------------------------------
  if (typeof globalThis.fetch === 'function') {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async function patchedFetch(
      input: string | URL | any,
      init?: any
    ): Promise<any> {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      // Skip collector requests
      if (urlStr.includes(collectorHost)) {
        return originalFetch(input, init);
      }

      const activeCtx = getActiveTraceContext();
      const parentSpan = getActiveSpan();

      const traceId = activeCtx ? activeCtx.trace_id : generateTraceId();
      const childSpanId = generateSpanId();
      const parentSpanId = parentSpan ? parentSpan.span_id : activeCtx?.span_id || null;

      const headers = new Headers(init?.headers || (typeof input === 'object' && 'headers' in input ? (input as Request).headers : {}));
      headers.set('traceparent', formatTraceparent(traceId, childSpanId));
      headers.set('x-tracing-id', traceId);
      if (parentSpanId) {
        headers.set('x-parent-id', parentSpanId);
      }

      const method = (init?.method || (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET')).toUpperCase();
      const startTime = Date.now();

      const clientSpan: Span = {
        trace_id: traceId,
        span_id: childSpanId,
        parent_span_id: parentSpanId,
        service_name: serviceName,
        runtime,
        span_kind: 'CLIENT',
        name: `${method} ${new URL(urlStr, 'http://localhost').pathname}`,
        start_time_unix_ms: startTime,
        end_time_unix_ms: 0,
        duration_ms: 0,
        http: {
          method,
          url: urlStr,
          route: new URL(urlStr, 'http://localhost').pathname
        }
      };

      try {
        const response = await originalFetch(input, { ...init, headers });
        const endTime = Date.now();
        clientSpan.end_time_unix_ms = endTime;
        clientSpan.duration_ms = Math.max(0, endTime - startTime);

        if (clientSpan.http) {
          clientSpan.http.status_code = response.status;
        }

        if (response.status >= 400) {
          clientSpan.error = {
            name: 'HttpError',
            message: `Outbound fetch failed with status ${response.status}`
          };
        }

        exporter.enqueue(clientSpan);
        return response;
      } catch (err: any) {
        const endTime = Date.now();
        clientSpan.end_time_unix_ms = endTime;
        clientSpan.duration_ms = Math.max(0, endTime - startTime);
        clientSpan.error = {
          name: err.name,
          message: err.message,
          stack: err.stack
        };
        exporter.enqueue(clientSpan);
        throw err;
      }
    };
  }
}
