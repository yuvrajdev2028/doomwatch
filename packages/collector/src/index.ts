#!/usr/bin/env node
import { loadConfig } from './config.js';
import { StorageEngine } from './storage/interface.js';
import { MongoStorageEngine } from './storage/mongo.js';
import { MemoryStorageEngine } from './storage/memory.js';
import { CollectorServer } from './server.js';

export * from './storage/interface.js';
export * from './storage/memory.js';
export * from './storage/mongo.js';
export * from './buffer.js';
export * from './server.js';
export * from './config.js';

async function bootstrap() {
  const config = loadConfig();
  let storage: StorageEngine;

  try {
    console.log(`[Doomwatch Collector] Attempting connection to MongoDB: ${config.mongoUri}...`);
    const mongoStorage = new MongoStorageEngine(config.mongoUri, config.mongoDbName);
    await mongoStorage.init();
    storage = mongoStorage;
    console.log('[Doomwatch Collector] Connected to MongoDB successfully.');
  } catch (err: any) {
    if (config.useMemoryFallback) {
      console.warn(`[Doomwatch Collector] MongoDB connection failed: ${err.message}`);
      console.warn('[Doomwatch Collector] Falling back to In-Memory storage engine for local development.');
      storage = new MemoryStorageEngine();
    } else {
      console.error('[Doomwatch Collector] Fatal: MongoDB connection failed and memory fallback is disabled.');
      process.exit(1);
    }
  }

  const server = new CollectorServer(config, storage);
  await server.start();

  const shutdown = async (signal: string) => {
    console.log(`\n[Doomwatch Collector] Received ${signal}. Gracefully stopping server and flushing spans...`);
    try {
      await server.stop();
      console.log('[Doomwatch Collector] Stopped gracefully.');
      process.exit(0);
    } catch (e) {
      console.error('[Doomwatch Collector] Error during shutdown:', e);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Auto-run if executed as main CLI script
if (import.meta.url.startsWith('file:') && process.argv[1] && process.argv[1].endsWith('index.js')) {
  bootstrap().catch((err) => {
    console.error('[Doomwatch Collector] Unhandled startup failure:', err);
    process.exit(1);
  });
}
