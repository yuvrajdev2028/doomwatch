import { DatabasePatchOptions, DatabaseInstrumentationOptions } from './types.js';
import { instrumentPgTarget, PgPatchOptions } from './patch-pg.js';
import { instrumentRedisTarget, RedisPatchOptions } from './patch-redis.js';
import { instrumentMongoClient, MongoPatchOptions } from './patch-mongo.js';

export * from './types.js';
export * from './patch-pg.js';
export * from './patch-redis.js';
export * from './patch-mongo.js';

let isPatched = false;

function safeDynamicImport(pkgName: string): Promise<any> {
  try {
    return Function('pkg', 'return import(pkg)')(pkgName);
  } catch {
    return Promise.reject(new Error(`Cannot import ${pkgName}`));
  }
}

/**
 * Automatically patches database and cache drivers (PostgreSQL, Redis, MongoDB)
 * based on configuration options.
 *
 * If `config` is `false` or `enabled: false`, this function immediately exits
 * without registering any hooks or modifying prototypes.
 */
export function patchDatabaseDrivers(options: DatabasePatchOptions): void {
  const { serviceName, exporter, config = true } = options;

  // 1. Single-flag check: If user disabled DB instrumentation, exit immediately.
  if (config === false) {
    return;
  }
  if (typeof config === 'object' && config.enabled === false) {
    return;
  }

  // 2. Check environment variable override
  const envOverride = process.env.DOOMWATCH_INSTRUMENT_DATABASE;
  if (envOverride === 'false' || envOverride === '0') {
    return;
  }

  if (isPatched) return;
  isPatched = true;

  const resolvedConfig: DatabaseInstrumentationOptions =
    typeof config === 'object' ? config : {};

  const maxStatementBytes = resolvedConfig.maxStatementBytes || 2048;

  // 3. PostgreSQL (pg) auto-patching
  if (resolvedConfig.postgres !== false) {
    try {
      safeDynamicImport('pg')
        .then((pgModule: any) => {
          const pg = pgModule.default || pgModule;
          if (pg.Client) instrumentPgTarget(pg.Client, { serviceName, exporter, maxStatementBytes });
          if (pg.Pool) instrumentPgTarget(pg.Pool, { serviceName, exporter, maxStatementBytes });
        })
        .catch(() => {
          // 'pg' not installed; silently skip
        });
    } catch {
      // Silently skip
    }
  }

  // 4. Redis (ioredis) auto-patching
  if (resolvedConfig.redis !== false) {
    try {
      safeDynamicImport('ioredis')
        .then((redisModule: any) => {
          const Redis = redisModule.default || redisModule;
          instrumentRedisTarget(Redis, { serviceName, exporter, maxStatementBytes });
        })
        .catch(() => {
          // 'ioredis' not installed; silently skip
        });
    } catch {
      // Silently skip
    }
  }

  // 5. MongoDB auto-patching
  if (resolvedConfig.mongodb !== false) {
    try {
      safeDynamicImport('mongodb')
        .then((mongoModule: any) => {
          const MongoClient = (mongoModule.default || mongoModule).MongoClient;
          if (MongoClient && MongoClient.prototype) {
            const originalConnect = MongoClient.prototype.connect;
            MongoClient.prototype.connect = function patchedConnect(this: any, ...args: any[]) {
              instrumentMongoClient(this, { serviceName, exporter, maxStatementBytes });
              return originalConnect.apply(this, args);
            };
          }
        })
        .catch(() => {
          // 'mongodb' not installed; silently skip
        });
    } catch {
      // Silently skip
    }
  }
}
