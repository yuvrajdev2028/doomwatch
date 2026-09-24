import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { Span } from '@doomwatch/core';

export interface ExporterConfig {
  collectorUrl: string;
  batchIntervalMs?: number;
  batchSize?: number;
  maxQueueCapacity?: number;
  debug?: boolean;
}

export class DoomwatchExporter {
  private queue: Span[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private collectorEndpoint: URL;
  private batchIntervalMs: number;
  private batchSize: number;
  private maxQueueCapacity: number;
  private debug: boolean;
  private lastErrorLogTime = 0;

  constructor(config: ExporterConfig) {
    const rawUrl = config.collectorUrl.replace(/\/+$/, '');
    this.collectorEndpoint = new URL(
      rawUrl.endsWith('/v1/traces') ? rawUrl : `${rawUrl}/v1/traces`
    );
    this.batchIntervalMs = config.batchIntervalMs || 1000;
    this.batchSize = config.batchSize || 50;
    this.maxQueueCapacity = config.maxQueueCapacity || 5000;
    this.debug = Boolean(config.debug);
  }

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {});
    }, this.batchIntervalMs);

    // Ensure timer doesn't keep node process alive unnecessarily
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  enqueue(span: Span): void {
    if (this.queue.length >= this.maxQueueCapacity) {
      // Overload protection: drop oldest
      this.queue.shift();
    }
    this.queue.push(span);

    if (this.queue.length >= this.batchSize && !this.isFlushing) {
      this.flush().catch(() => {});
    }
  }

  async flush(): Promise<void> {
    if (this.isFlushing || this.queue.length === 0) {
      return;
    }

    this.isFlushing = true;
    const batch = this.queue.splice(0, this.batchSize);

    try {
      await this.sendBatch(batch);
      if (this.debug) {
        console.log(`[Doomwatch SDK] Successfully exported ${batch.length} spans.`);
      }
    } catch (err: any) {
      // Throttled logging (at most once every 10 seconds)
      const now = Date.now();
      if (this.debug || now - this.lastErrorLogTime > 10000) {
        console.warn(`[Doomwatch SDK] Failed to export ${batch.length} spans to collector: ${err.message}`);
        this.lastErrorLogTime = now;
      }
      // Re-queue spans if capacity allows (fail-open)
      if (this.queue.length + batch.length <= this.maxQueueCapacity) {
        this.queue.unshift(...batch);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  private sendBatch(spans: Span[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({ spans });
      const isHttps = this.collectorEndpoint.protocol === 'https:';
      const client = isHttps ? https : http;

      const req = client.request(
        {
          protocol: this.collectorEndpoint.protocol,
          hostname: this.collectorEndpoint.hostname,
          port: this.collectorEndpoint.port || (isHttps ? 443 : 80),
          path: this.collectorEndpoint.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'User-Agent': 'Doomwatch-Node-SDK/0.1.0'
          },
          timeout: 4000
        },
        (res) => {
          // Consume response data to free socket
          res.resume();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Collector returned HTTP ${res.statusCode}`));
          }
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('Connection to Doomwatch Collector timed out'));
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(payload);
      req.end();
    });
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Final flush
    while (this.queue.length > 0) {
      await this.flush();
    }
  }

  getPendingCount(): number {
    return this.queue.length;
  }
}
