import { Span } from '@doomwatch/core';
import { StorageEngine } from './storage/interface.js';

export interface BufferStats {
  pendingSpans: number;
  totalIngested: number;
  totalFlushed: number;
  totalErrors: number;
}

export class SpanBuffer {
  private queue: Span[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private totalIngested = 0;
  private totalFlushed = 0;
  private totalErrors = 0;

  constructor(
    private storage: StorageEngine,
    private flushIntervalMs: number = 500,
    private maxBatchSize: number = 50,
    private maxQueueCapacity: number = 10000
  ) {}

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        console.error('[Doomwatch Buffer] Background flush error:', err);
      });
    }, this.flushIntervalMs);
  }

  enqueue(spans: Span[]): number {
    this.totalIngested += spans.length;

    // Guard against memory explosion under extreme overload: drop oldest if exceeding capacity
    const available = this.maxQueueCapacity - this.queue.length;
    if (available <= 0) {
      console.warn(`[Doomwatch Buffer] Queue capacity (${this.maxQueueCapacity}) reached. Dropping oldest spans.`);
      this.queue.splice(0, spans.length);
    }

    this.queue.push(...spans);

    // If batch size threshold is reached, trigger immediate flush
    if (this.queue.length >= this.maxBatchSize && !this.isFlushing) {
      this.flush().catch((err) => {
        console.error('[Doomwatch Buffer] Immediate batch flush error:', err);
      });
    }

    return spans.length;
  }

  async flush(): Promise<number> {
    if (this.isFlushing || this.queue.length === 0) {
      return 0;
    }

    this.isFlushing = true;
    const batch = this.queue.splice(0, this.maxBatchSize);

    try {
      const inserted = await this.storage.insertSpans(batch);
      this.totalFlushed += inserted;
      return inserted;
    } catch (error) {
      this.totalErrors++;
      console.error(`[Doomwatch Buffer] Failed to flush batch of ${batch.length} spans:`, error);
      // Put failed spans back at the front of queue if not at max capacity
      if (this.queue.length + batch.length <= this.maxQueueCapacity) {
        this.queue.unshift(...batch);
      }
      throw error;
    } finally {
      this.isFlushing = false;
    }
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush any remaining items in the queue before stopping
    while (this.queue.length > 0) {
      await this.flush();
    }
  }

  getStats(): BufferStats {
    return {
      pendingSpans: this.queue.length,
      totalIngested: this.totalIngested,
      totalFlushed: this.totalFlushed,
      totalErrors: this.totalErrors
    };
  }
}
