import { initGlobalContextManager, getActiveTraceContext, getActiveSpan } from './context.js';
import { DoomwatchExporter } from './exporter.js';
import { createDoomwatchMiddleware } from './middleware.js';
import { patchHttpClients } from './patch-http.js';
import {
  patchDatabaseDrivers,
  instrumentPgTarget,
  instrumentRedisTarget,
  instrumentMongoClient,
  DatabaseInstrumentationOptions
} from './db/index.js';

export interface DoomwatchNodeConfig {
  serviceName: string;
  collectorUrl?: string;
  environment?: string;
  maxBodyBytes?: number;
  batchIntervalMs?: number;
  batchSize?: number;
  redactedKeys?: string[];
  autoPatchHttp?: boolean;
  debug?: boolean;

  /**
   * Enable or disable automatic database and cache instrumentation.
   * Driven from config:
   * - Set to `false` to completely disable all DB & cache auto-instrumentation.
   * - Set to `true` (default) to enable all supported drivers (MongoDB, PostgreSQL, Redis).
   * - Or pass `DatabaseInstrumentationOptions` for fine-grained per-driver control.
   */
  instrumentDatabase?: boolean | DatabaseInstrumentationOptions;
}

export class DoomwatchNodeSdk {
  private static instance: DoomwatchNodeSdk | null = null;
  private exporter: DoomwatchExporter;
  private config: Required<Omit<DoomwatchNodeConfig, 'instrumentDatabase'>> & {
    instrumentDatabase: boolean | DatabaseInstrumentationOptions;
  };

  private constructor(config: DoomwatchNodeConfig) {
    this.config = {
      serviceName: config.serviceName,
      collectorUrl:
        config.collectorUrl || process.env.DOOMWATCH_COLLECTOR_URL || 'http://localhost:4000',
      environment: config.environment || process.env.NODE_ENV || 'development',
      maxBodyBytes: config.maxBodyBytes || 4096,
      batchIntervalMs: config.batchIntervalMs || 1000,
      batchSize: config.batchSize || 50,
      redactedKeys: config.redactedKeys || [],
      autoPatchHttp: config.autoPatchHttp !== false,
      debug: Boolean(config.debug),
      instrumentDatabase: config.instrumentDatabase !== undefined ? config.instrumentDatabase : true
    };

    // 1. Initialize OpenTelemetry ambient context manager
    initGlobalContextManager();

    // 2. Initialize background batch exporter
    this.exporter = new DoomwatchExporter({
      collectorUrl: this.config.collectorUrl,
      batchIntervalMs: this.config.batchIntervalMs,
      batchSize: this.config.batchSize,
      debug: this.config.debug
    });
    this.exporter.start();

    // 3. Auto-patch outgoing HTTP clients (http, https, fetch)
    if (this.config.autoPatchHttp) {
      patchHttpClients({
        serviceName: this.config.serviceName,
        collectorUrl: this.config.collectorUrl,
        exporter: this.exporter,
        maxBodyBytes: this.config.maxBodyBytes,
        redactedKeys: this.config.redactedKeys
      });
    }

    // 4. Auto-patch database and cache drivers if enabled in config
    if (this.config.instrumentDatabase !== false) {
      patchDatabaseDrivers({
        serviceName: this.config.serviceName,
        exporter: this.exporter,
        config: this.config.instrumentDatabase
      });
    }

    if (this.config.debug) {
      console.log(`[Doomwatch SDK] Initialized for service '${this.config.serviceName}' -> ${this.config.collectorUrl}`);
    }

    // 5. Hook process shutdown to flush remaining spans
    process.on('beforeExit', () => this.exporter.flush());
  }

  /**
   * Initializes Doomwatch for this Node.js process.
   * Call once at the root entry point of your application.
   */
  public static init(config: DoomwatchNodeConfig): DoomwatchNodeSdk {
    if (!DoomwatchNodeSdk.instance) {
      DoomwatchNodeSdk.instance = new DoomwatchNodeSdk(config);
    }
    return DoomwatchNodeSdk.instance;
  }

  public static getInstance(): DoomwatchNodeSdk {
    if (!DoomwatchNodeSdk.instance) {
      throw new Error('[Doomwatch SDK] Not initialized. Please call Doomwatch.init({ ... }) first.');
    }
    return DoomwatchNodeSdk.instance;
  }

  /**
   * Returns Express / Connect middleware for incoming HTTP request interception.
   */
  public middleware(serviceNameOverride?: string) {
    return createDoomwatchMiddleware({
      serviceName: serviceNameOverride || this.config.serviceName,
      exporter: this.exporter,
      maxBodyBytes: this.config.maxBodyBytes,
      redactedKeys: this.config.redactedKeys
    });
  }

  /**
   * Returns the current active trace ID from ambient context, or null if none active.
   */
  public getActiveTraceId(): string | null {
    const ctx = getActiveTraceContext();
    return ctx ? ctx.trace_id : null;
  }

  /**
   * Returns the current active span ID from ambient context, or null if none active.
   */
  public getActiveSpanId(): string | null {
    const ctx = getActiveTraceContext();
    return ctx ? ctx.span_id : null;
  }

  /**
   * Forces an immediate asynchronous flush of any queued spans to the collector.
   */
  public async flush(): Promise<void> {
    await this.exporter.flush();
  }

  /**
   * Stops background exporters and flushes remaining spans.
   */
  public async shutdown(): Promise<void> {
    await this.exporter.stop();
  }

  public static resetInstance(): void {
    if (DoomwatchNodeSdk.instance) {
      DoomwatchNodeSdk.instance.exporter.stop();
      DoomwatchNodeSdk.instance = null;
    }
  }

  public getExporter(): DoomwatchExporter {
    return this.exporter;
  }

  public instrumentPg(pg: any, serviceNameOverride?: string): void {
    if (this.config.instrumentDatabase === false) return;
    instrumentPgTarget(pg, {
      serviceName: serviceNameOverride || this.config.serviceName,
      exporter: this.exporter
    });
  }

  public instrumentRedis(redis: any, serviceNameOverride?: string): void {
    if (this.config.instrumentDatabase === false) return;
    instrumentRedisTarget(redis, {
      serviceName: serviceNameOverride || this.config.serviceName,
      exporter: this.exporter
    });
  }

  public instrumentMongoClient(client: any, serviceNameOverride?: string): void {
    if (this.config.instrumentDatabase === false) return;
    instrumentMongoClient(client, {
      serviceName: serviceNameOverride || this.config.serviceName,
      exporter: this.exporter
    });
  }
}

// Convenience namespace exports for the 2-line initialization experience:
// const doomwatch = require('@doomwatch/node');
// doomwatch.init({ serviceName: 'my-service' });
export const Doomwatch = {
  init: DoomwatchNodeSdk.init,
  getInstance: DoomwatchNodeSdk.getInstance,
  resetInstance: DoomwatchNodeSdk.resetInstance,
  middleware: (serviceNameOverride?: string) => DoomwatchNodeSdk.getInstance().middleware(serviceNameOverride),
  getActiveTraceId: () => DoomwatchNodeSdk.getInstance().getActiveTraceId(),
  getActiveSpanId: () => DoomwatchNodeSdk.getInstance().getActiveSpanId(),
  flush: () => DoomwatchNodeSdk.getInstance().flush(),
  shutdown: () => DoomwatchNodeSdk.getInstance().shutdown(),
  instrumentPg: (pg: any, serviceNameOverride?: string) => DoomwatchNodeSdk.getInstance().instrumentPg(pg, serviceNameOverride),
  instrumentRedis: (redis: any, serviceNameOverride?: string) => DoomwatchNodeSdk.getInstance().instrumentRedis(redis, serviceNameOverride),
  instrumentMongoClient: (client: any, serviceNameOverride?: string) => DoomwatchNodeSdk.getInstance().instrumentMongoClient(client, serviceNameOverride)
};
