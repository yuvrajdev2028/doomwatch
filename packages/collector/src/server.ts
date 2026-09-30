import http, { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { Span, TraceFilter } from '@doomwatch/core';
import { StorageEngine } from './storage/interface.js';
import { SpanBuffer } from './buffer.js';
import { CollectorConfig } from './config.js';
import { DASHBOARD_HTML } from './dashboard-html.js';

export class CollectorServer {
  private server: http.Server;
  private buffer: SpanBuffer;

  constructor(
    private config: CollectorConfig,
    private storage: StorageEngine
  ) {
    this.buffer = new SpanBuffer(
      this.storage,
      this.config.batchFlushIntervalMs,
      this.config.batchSize
    );
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  getBuffer(): SpanBuffer {
    return this.buffer;
  }

  getHttpServer(): http.Server {
    return this.server;
  }

  async start(): Promise<void> {
    await this.storage.init();
    this.buffer.start();

    return new Promise((resolve) => {
      this.server.listen(this.config.port, () => {
        console.log(`[Doomwatch Collector] Ingestion API running on http://localhost:${this.config.port}`);
        console.log(`[Doomwatch Collector] Storage Engine: ${this.storage.name}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await this.buffer.stop();
    await this.storage.close();
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private setCorsHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', this.config.corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-tracing-id, traceparent');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const host = req.headers.host || `localhost:${this.config.port}`;
    const parsedUrl = new URL(req.url || '/', `http://${host}`);
    const pathname = parsedUrl.pathname;

    try {
      // 1. Health check
      if (req.method === 'GET' && pathname === '/health') {
        const stats = this.buffer.getStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            storage: this.storage.name,
            healthy: this.storage.isHealthy(),
            buffer: stats,
            timestamp: Date.now()
          })
        );
        return;
      }

      // 2. Web Dashboard UI
      if (req.method === 'GET' && (pathname === '/' || pathname === '/dashboard')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(DASHBOARD_HTML);
        return;
      }

      // 3. Ingest Spans (POST /v1/traces or POST /v1/telemetry)
      if (req.method === 'POST' && (pathname === '/v1/traces' || pathname === '/v1/telemetry')) {
        const body = await this.readJsonBody(req);
        let spans: Span[] = [];

        if (Array.isArray(body)) {
          spans = body;
        } else if (body && Array.isArray((body as any).spans)) {
          spans = (body as any).spans;
        } else if (body && (body as any).trace_id) {
          spans = [body as Span];
        }

        if (spans.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No spans found in payload' }));
          return;
        }

        const enqueued = this.buffer.enqueue(spans);
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            accepted: enqueued,
            pending: this.buffer.getStats().pendingSpans
          })
        );
        return;
      }

      // 3. Query Traces (GET /v1/traces)
      if (req.method === 'GET' && pathname === '/v1/traces') {
        const query = parsedUrl.searchParams;
        const filter: TraceFilter = {
          trace_id: query.get('trace_id') || undefined,
          service_name: query.get('service') || query.get('service_name') || undefined,
          has_error: query.has('has_error') ? query.get('has_error') === 'true' : undefined,
          min_duration_ms: query.has('min_duration') ? parseInt(query.get('min_duration')!, 10) : undefined,
          max_duration_ms: query.has('max_duration') ? parseInt(query.get('max_duration')!, 10) : undefined,
          status_code: query.has('status_code') ? parseInt(query.get('status_code')!, 10) : undefined,
          from_time_ms: query.has('from') ? parseInt(query.get('from')!, 10) : undefined,
          to_time_ms: query.has('to') ? parseInt(query.get('to')!, 10) : undefined,
          limit: query.has('limit') ? parseInt(query.get('limit')!, 10) : 50,
          offset: query.has('offset') ? parseInt(query.get('offset')!, 10) : 0
        };

        const traces = await this.storage.getTraces(filter);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ traces, count: traces.length }));
        return;
      }

      // 4. Get Trace by ID (GET /v1/traces/:traceId)
      const traceIdMatch = pathname.match(/^\/v1\/traces\/([a-zA-Z0-9_-]+)$/);
      if (req.method === 'GET' && traceIdMatch) {
        const traceId = traceIdMatch[1];
        const trace = await this.storage.getTraceById(traceId);
        if (!trace) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Trace '${traceId}' not found` }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(trace));
        return;
      }

      // Unknown route
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Not found: ${req.method} ${pathname}` }));
    } catch (error: any) {
      console.error('[Doomwatch Collector] Handler error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message || 'Internal Server Error' }));
    }
  }

  private readJsonBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error('Malformed JSON payload'));
        }
      });
      req.on('error', reject);
    });
  }
}
