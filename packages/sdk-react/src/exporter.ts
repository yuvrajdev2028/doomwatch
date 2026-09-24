import { Span } from '@doomwatch/core';

export interface BrowserExporterConfig {
  collectorUrl: string;
  batchIntervalMs?: number;
  batchSize?: number;
  maxQueueCapacity?: number;
  debug?: boolean;
}

export class BrowserSpanExporter {
  private queue: Span[] = [];
  private flushTimer: any = null;
  private isFlushing = false;
  private collectorEndpoint: string;
  private batchIntervalMs: number;
  private batchSize: number;
  private maxQueueCapacity: number;
  private debug: boolean;

  constructor(config: BrowserExporterConfig) {
    const rawUrl = config.collectorUrl.replace(/\/+$/, '');
    this.collectorEndpoint = rawUrl.endsWith('/v1/traces') ? rawUrl : `${rawUrl}/v1/traces`;
    this.batchIntervalMs = config.batchIntervalMs || 2000;
    this.batchSize = config.batchSize || 10;
    this.maxQueueCapacity = config.maxQueueCapacity || 1000;
    this.debug = Boolean(config.debug);

    this.registerUnloadHandlers();
  }

  start(): void {
    if (this.flushTimer != null) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {});
    }, this.batchIntervalMs);

    if (typeof this.flushTimer === 'object' && typeof this.flushTimer?.unref === 'function') {
      this.flushTimer.unref();
    }
  }

  enqueue(span: Span): void {
    if (this.queue.length >= this.maxQueueCapacity) {
      this.queue.shift(); // Drop oldest
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
        console.log(`[Doomwatch React SDK] Successfully exported ${batch.length} spans.`);
      }
    } catch (err: any) {
      if (this.debug) {
        console.warn(`[Doomwatch React SDK] Export failed: ${err.message}`);
      }
      // Re-queue spans if capacity allows
      if (this.queue.length + batch.length <= this.maxQueueCapacity) {
        this.queue.unshift(...batch);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  private async sendBatch(spans: Span[]): Promise<void> {
    const payload = JSON.stringify({ spans });

    if (typeof fetch === 'function') {
      const response = await fetch(this.collectorEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: payload,
        keepalive: true
      });

      if (!response.ok) {
        throw new Error(`Collector returned HTTP ${response.status}`);
      }
    }
  }

  /**
   * Registers pagehide & visibilitychange handlers to flush spans using navigator.sendBeacon
   * when the user closes or leaves the page.
   */
  private registerUnloadHandlers(): void {
    if (typeof window === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && this.queue.length > 0) {
        this.flushWithBeacon();
      }
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', () => this.flushWithBeacon());
  }

  private flushWithBeacon(): void {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.queue.length);
    const payload = JSON.stringify({ spans: batch });

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([payload], { type: 'application/json' });
      const sent = navigator.sendBeacon(this.collectorEndpoint, blob);
      if (!sent) {
        // Fallback to fetch with keepalive
        this.sendBatch(batch).catch(() => {});
      }
    } else {
      this.sendBatch(batch).catch(() => {});
    }
  }

  stop(): void {
    if (this.flushTimer != null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  getPendingCount(): number {
    return this.queue.length;
  }
}
