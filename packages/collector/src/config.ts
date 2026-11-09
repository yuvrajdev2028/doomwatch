/**
 * Doomwatch Collector Configuration
 */

export interface CollectorConfig {
  port: number;
  mongoUri: string;
  mongoDbName: string;
  batchFlushIntervalMs: number;
  batchSize: number;
  corsOrigin: string;
  useMemoryFallback: boolean;
  ttlDays?: number;
}

function parseTtlDays(val?: string): number {
  if (!val || val.trim() === '') return 0;
  const parsed = Number(val);
  if (isNaN(parsed) || parsed <= 0) {
    console.warn(
      `[Doomwatch Collector] Warning: Invalid TTL_DAYS value '${val}'. Expected a positive number. Defaulting to 0 (no TTL / retention disabled).`
    );
    return 0;
  }
  return parsed;
}

export function loadConfig(): CollectorConfig {
  return {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 4000,
    mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/doomwatch',
    mongoDbName: process.env.MONGODB_DB_NAME || 'doomwatch',
    batchFlushIntervalMs: process.env.BATCH_FLUSH_INTERVAL_MS
      ? parseInt(process.env.BATCH_FLUSH_INTERVAL_MS, 10)
      : 500,
    batchSize: process.env.BATCH_SIZE ? parseInt(process.env.BATCH_SIZE, 10) : 50,
    corsOrigin: process.env.CORS_ORIGIN || '*',
    useMemoryFallback: process.env.USE_MEMORY_FALLBACK !== 'false',
    ttlDays: parseTtlDays(process.env.DOOMWATCH_TTL_DAYS || process.env.TTL_DAYS)
  };
}
