import { generateTraceId, generateSpanId, Span } from '@doomwatch/core';
import { BrowserSpanExporter, BrowserExporterConfig } from './exporter.js';
import { patchBrowserHttp } from './interceptor.js';

export interface DoomwatchBrowserConfig {
  serviceName: string;
  collectorUrl: string;
  propagateToUrls?: (string | RegExp)[];
  batchIntervalMs?: number;
  batchSize?: number;
  debug?: boolean;
}

export class DoomwatchBrowserSdk {
  private static instance: DoomwatchBrowserSdk | null = null;
  private exporter: BrowserSpanExporter;
  private config: Required<DoomwatchBrowserConfig>;
  private activeTraceId: string | null = null;

  private constructor(config: DoomwatchBrowserConfig) {
    this.config = {
      serviceName: config.serviceName,
      collectorUrl: config.collectorUrl,
      propagateToUrls: config.propagateToUrls || [],
      batchIntervalMs: config.batchIntervalMs || 2000,
      batchSize: config.batchSize || 10,
      debug: Boolean(config.debug)
    };

    this.exporter = new BrowserSpanExporter({
      collectorUrl: this.config.collectorUrl,
      batchIntervalMs: this.config.batchIntervalMs,
      batchSize: this.config.batchSize,
      debug: this.config.debug
    });
    this.exporter.start();

    patchBrowserHttp({
      serviceName: this.config.serviceName,
      collectorUrl: this.config.collectorUrl,
      exporter: this.exporter,
      propagateToUrls: this.config.propagateToUrls,
      getActiveTraceId: () => this.activeTraceId
    });

    if (this.config.debug) {
      console.log(`[Doomwatch Browser SDK] Initialized for '${this.config.serviceName}' -> ${this.config.collectorUrl}`);
    }
  }

  public static init(config: DoomwatchBrowserConfig): DoomwatchBrowserSdk {
    if (!DoomwatchBrowserSdk.instance) {
      DoomwatchBrowserSdk.instance = new DoomwatchBrowserSdk(config);
    }
    return DoomwatchBrowserSdk.instance;
  }

  public static resetInstance(): void {
    if (DoomwatchBrowserSdk.instance) {
      DoomwatchBrowserSdk.instance.stop();
      DoomwatchBrowserSdk.instance = null;
    }
  }

  public static getInstance(): DoomwatchBrowserSdk {
    if (!DoomwatchBrowserSdk.instance) {
      throw new Error('[Doomwatch React SDK] Not initialized. Please initialize DoomwatchProvider or DoomwatchBrowser.init()');
    }
    return DoomwatchBrowserSdk.instance;
  }

  /**
   * Starts a correlated user interaction trace (e.g. "Checkout Flow")
   * Any API calls made while this interaction is active will automatically inherit this trace ID!
   */
  public startUserInteraction(actionName: string): { traceId: string; end: (error?: Error) => void } {
    const traceId = generateTraceId();
    const spanId = generateSpanId();
    const startTime = Date.now();
    this.activeTraceId = traceId;

    return {
      traceId,
      end: (error?: Error) => {
        const endTime = Date.now();
        const span: Span = {
          trace_id: traceId,
          span_id: spanId,
          parent_span_id: null,
          service_name: this.config.serviceName,
          runtime: 'browser',
          span_kind: 'INTERNAL',
          name: `UI: ${actionName}`,
          start_time_unix_ms: startTime,
          end_time_unix_ms: endTime,
          duration_ms: Math.max(0, endTime - startTime),
          error: error ? { name: error.name, message: error.message, stack: error.stack } : null
        };

        this.exporter.enqueue(span);
        if (this.activeTraceId === traceId) {
          this.activeTraceId = null;
        }
      }
    };
  }

  public getActiveTraceId(): string | null {
    return this.activeTraceId;
  }

  public async flush(): Promise<void> {
    await this.exporter.flush();
  }

  public stop(): void {
    this.exporter.stop();
  }
}

export const DoomwatchBrowser = {
  init: DoomwatchBrowserSdk.init,
  getInstance: DoomwatchBrowserSdk.getInstance,
  startUserInteraction: (name: string) => DoomwatchBrowserSdk.getInstance().startUserInteraction(name),
  getActiveTraceId: () => DoomwatchBrowserSdk.getInstance().getActiveTraceId(),
  flush: () => DoomwatchBrowserSdk.getInstance().flush()
};
