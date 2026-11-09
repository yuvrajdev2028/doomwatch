import { DoomwatchExporter } from '../exporter.js';

export interface DatabaseInstrumentationOptions {
  enabled?: boolean;            // Master toggle for DB/cache (default: true)
  mongodb?: boolean;            // Enable MongoDB / Mongoose auto-instrumentation (default: true)
  postgres?: boolean;           // Enable PostgreSQL (pg) auto-instrumentation (default: true)
  redis?: boolean;              // Enable Redis auto-instrumentation (default: true)
  maxStatementBytes?: number;   // Maximum statement byte length before truncation (default: 2048)
}

export interface DatabasePatchOptions {
  serviceName: string;
  exporter: DoomwatchExporter;
  config?: boolean | DatabaseInstrumentationOptions;
}
