import {
  Span,
  generateSpanId,
  generateTraceId,
  formatTraceparent,
  redactHeaders,
  sanitizePayload
} from '@doomwatch/core';
import { BrowserSpanExporter } from './exporter.js';

export interface InterceptorOptions {
  serviceName: string;
  collectorUrl: string;
  exporter: BrowserSpanExporter;
  propagateToUrls?: (string | RegExp)[];
  maxBodyBytes?: number;
  getActiveTraceId?: () => string | null;
}

let isFetchPatched = false;
let isXhrPatched = false;
let activeOptions: InterceptorOptions | null = null;
let originalFetchBackup: any = null;
let originalXhrBackup: any = null;

export function resetBrowserHttpPatch(): void {
  if (typeof window !== 'undefined') {
    if (originalFetchBackup) {
      window.fetch = originalFetchBackup;
      isFetchPatched = false;
      originalFetchBackup = null;
    }
    if (originalXhrBackup) {
      window.XMLHttpRequest = originalXhrBackup;
      isXhrPatched = false;
      originalXhrBackup = null;
    }
  }
  activeOptions = null;
}

function shouldPropagate(url: string, propagateToUrls?: (string | RegExp)[]): boolean {
  if (!propagateToUrls || propagateToUrls.length === 0) {
    return true; // Default: propagate to all backend requests
  }
  return propagateToUrls.some((pattern) => {
    if (typeof pattern === 'string') {
      return url.includes(pattern);
    }
    return pattern.test(url);
  });
}

/**
 * Automatically patches window.fetch and window.XMLHttpRequest in the browser
 * to inject W3C traceparent and legacy x-tracing-id headers on all outgoing API calls.
 */
export function patchBrowserHttp(options: InterceptorOptions): void {
  if (typeof window === 'undefined') return;

  activeOptions = options;

  // -------------------------------------------------------------
  // 1. Patch window.fetch
  // -------------------------------------------------------------
  if (!isFetchPatched && typeof window.fetch === 'function') {
    isFetchPatched = true;
    originalFetchBackup = window.fetch;
    const originalFetch = window.fetch;

    window.fetch = async function patchedBrowserFetch(
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      if (!activeOptions) return originalFetch(input, init);
      const { serviceName, collectorUrl, exporter, propagateToUrls, getActiveTraceId } = activeOptions;
      const collectorOrigin = new URL(collectorUrl, window.location?.href || 'http://localhost').origin;

      const urlStr =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      // Skip collector requests to prevent infinite loops
      if (urlStr.includes(collectorOrigin) || urlStr.includes('/v1/traces')) {
        return originalFetch(input, init);
      }

      if (!shouldPropagate(urlStr, propagateToUrls)) {
        return originalFetch(input, init);
      }

      const activeTraceId = getActiveTraceId ? getActiveTraceId() : null;
      const traceId = activeTraceId || generateTraceId();
      const spanId = generateSpanId();

      // Setup headers
      const headers = new Headers(
        init?.headers || (typeof input === 'object' && 'headers' in input ? (input as Request).headers : {})
      );

      // Inject standard W3C header and legacy x-tracing-id
      headers.set('traceparent', formatTraceparent(traceId, spanId));
      headers.set('x-tracing-id', traceId);

      const method = (
        init?.method ||
        (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET')
      ).toUpperCase();

      const startTime = Date.now();
      const span: Span = {
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: null,
        service_name: serviceName,
        runtime: 'browser',
        span_kind: 'CLIENT',
        name: `${method} ${new URL(urlStr, window.location.href).pathname}`,
        start_time_unix_ms: startTime,
        end_time_unix_ms: 0,
        duration_ms: 0,
        http: {
          method,
          url: urlStr,
          route: new URL(urlStr, window.location.href).pathname
        }
      };

      try {
        const response = await originalFetch(input, { ...init, headers });
        const endTime = Date.now();
        span.end_time_unix_ms = endTime;
        span.duration_ms = Math.max(0, endTime - startTime);

        if (span.http) {
          span.http.status_code = response.status;
        }

        if (response.status >= 400) {
          span.error = {
            name: 'HttpError',
            message: `Frontend request failed with status ${response.status}`
          };
        }

        exporter.enqueue(span);
        return response;
      } catch (err: any) {
        const endTime = Date.now();
        span.end_time_unix_ms = endTime;
        span.duration_ms = Math.max(0, endTime - startTime);
        span.error = {
          name: err.name || 'NetworkError',
          message: err.message || 'Fetch failed'
        };
        exporter.enqueue(span);
        throw err;
      }
    };
  }

  // -------------------------------------------------------------
  // 2. Patch window.XMLHttpRequest
  // -------------------------------------------------------------
  if (!isXhrPatched && typeof window.XMLHttpRequest === 'function') {
    isXhrPatched = true;
    const OriginalXHR = window.XMLHttpRequest;

    function PatchedXHR(this: XMLHttpRequest) {
      const xhr = new OriginalXHR();
      let reqUrl = '';
      let reqMethod = 'GET';
      let startTime = 0;
      let traceId = '';
      let spanId = '';

      const originalOpen = xhr.open;
      xhr.open = function (method: string, url: string | URL, ...rest: any[]) {
        reqMethod = (method || 'GET').toUpperCase();
        reqUrl = typeof url === 'string' ? url : url.toString();
        return (originalOpen as any).apply(xhr, [method, url, ...rest]);
      };

      const originalSend = xhr.send;
      xhr.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
        if (!activeOptions) return originalSend.apply(xhr, [body]);
        const { serviceName, collectorUrl, exporter, propagateToUrls, getActiveTraceId } = activeOptions;
        const collectorOrigin = new URL(collectorUrl, window.location?.href || 'http://localhost').origin;

        // Skip collector requests
        if (reqUrl.includes(collectorOrigin) || reqUrl.includes('/v1/traces') || !shouldPropagate(reqUrl, propagateToUrls)) {
          return originalSend.apply(xhr, [body]);
        }

        const activeTraceId = getActiveTraceId ? getActiveTraceId() : null;
        traceId = activeTraceId || generateTraceId();
        spanId = generateSpanId();
        startTime = Date.now();

        // Inject headers
        xhr.setRequestHeader('traceparent', formatTraceparent(traceId, spanId));
        xhr.setRequestHeader('x-tracing-id', traceId);

        xhr.addEventListener('loadend', () => {
          const endTime = Date.now();
          const cleanPath = new URL(reqUrl, window.location.href).pathname;
          const span: Span = {
            trace_id: traceId,
            span_id: spanId,
            parent_span_id: null,
            service_name: serviceName,
            runtime: 'browser',
            span_kind: 'CLIENT',
            name: `${reqMethod} ${cleanPath}`,
            start_time_unix_ms: startTime,
            end_time_unix_ms: endTime,
            duration_ms: Math.max(0, endTime - startTime),
            http: {
              method: reqMethod,
              url: reqUrl,
              route: cleanPath,
              status_code: xhr.status
            }
          };

          if (xhr.status >= 400 || xhr.status === 0) {
            span.error = {
              name: 'XhrError',
              message: `XHR request failed with status ${xhr.status}`
            };
          }

          exporter.enqueue(span);
        });

        return originalSend.apply(xhr, [body]);
      };

      return xhr;
    }

    PatchedXHR.prototype = OriginalXHR.prototype;
    window.XMLHttpRequest = PatchedXHR as any;
  }
}
