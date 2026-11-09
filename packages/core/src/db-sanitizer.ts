/**
 * Query Sanitization and PII Masking Utilities for Databases and Caches
 */

export interface SqlSanitizeResult {
  statement: string;
  operation: string;
  table?: string;
}

export interface RedisSanitizeResult {
  statement: string;
  operation: string;
  key?: string;
}

/**
 * Strips comments, parameterizes literals (strings, numbers, UUIDs),
 * normalizes whitespace, and truncates SQL statements.
 */
export function sanitizeSqlQuery(sql: string, maxBytes: number = 2048): SqlSanitizeResult {
  if (!sql || typeof sql !== 'string') {
    return { statement: '', operation: 'UNKNOWN' };
  }

  // Pre-truncate if absurdly large to safeguard event loop
  let text = sql.length > maxBytes * 2 ? sql.slice(0, maxBytes * 2) : sql;

  // 1. Strip comments
  text = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // multi-line comments
    .replace(/--[^\r\n]*/g, ' ');       // single-line comments

  // 2. Extract operation & table before parameterization
  const trimmed = text.trim();
  const firstWordMatch = trimmed.match(/^([a-zA-Z]+)/);
  const operation = firstWordMatch ? firstWordMatch[1].toUpperCase() : 'SQL';

  let table: string | undefined;
  if (/^SELECT\b/i.test(trimmed)) {
    const match = trimmed.match(/\bFROM\s+["`]?([a-zA-Z0-9_$.]+)["`]?/i);
    if (match) table = match[1];
  } else if (/^INSERT\s+INTO\b/i.test(trimmed)) {
    const match = trimmed.match(/\bINSERT\s+INTO\s+["`]?([a-zA-Z0-9_$.]+)["`]?/i);
    if (match) table = match[1];
  } else if (/^UPDATE\b/i.test(trimmed)) {
    const match = trimmed.match(/\bUPDATE\s+["`]?([a-zA-Z0-9_$.]+)["`]?/i);
    if (match) table = match[1];
  } else if (/^DELETE\s+FROM\b/i.test(trimmed)) {
    const match = trimmed.match(/\bDELETE\s+FROM\s+["`]?([a-zA-Z0-9_$.]+)["`]?/i);
    if (match) table = match[1];
  } else if (/^(?:CREATE|DROP|ALTER|TRUNCATE)\s+TABLE\b/i.test(trimmed)) {
    const match = trimmed.match(/\bTABLE\s+["`]?([a-zA-Z0-9_$.]+)["`]?/i);
    if (match) table = match[1];
  }

  // 3. Parameterize UUIDs
  text = text.replace(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, '?');

  // 4. Parameterize string literals: 'value' or "value"
  text = text.replace(/'(?:[^'\\]|\\.)*'/g, '?');
  text = text.replace(/"(?:[^"\\]|\\.)*"/g, '?');

  // 5. Parameterize hex values: 0x1234
  text = text.replace(/\b0x[0-9a-fA-F]+\b/g, '?');

  // 6. Parameterize numeric literals that stand alone or follow operators (=, >, <, commas, IN(...))
  text = text.replace(/(?<=[=<>!,\s(])\b\d+(?:\.\d+)?\b(?=[,\s);]|$)/g, '?');

  // 7. Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // 8. Truncate to maxBytes
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    const buf = Buffer.from(text, 'utf8');
    text = buf.subarray(0, maxBytes).toString('utf8') + '... [TRUNCATED]';
  }

  return {
    statement: text,
    operation,
    table
  };
}

/**
 * Recursively masks sensitive leaf values in MongoDB filter/command objects,
 * while preserving query operators ($in, $gt, $and, etc.) and schema keys.
 */
export function sanitizeMongoFilter(obj: unknown, maxBytes: number = 2048): string {
  if (obj === null || obj === undefined) return '{}';
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      return String(obj).slice(0, maxBytes);
    }
  }

  function mask(val: unknown): unknown {
    if (val === null || val === undefined) return val;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') {
      return '?';
    }
    if (val instanceof Date || (typeof val === 'object' && val.constructor && val.constructor.name === 'ObjectId')) {
      return '?';
    }
    if (Array.isArray(val)) {
      return val.map((item) => mask(item));
    }
    if (typeof val === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(val as Record<string, unknown>)) {
        if (key.startsWith('$')) {
          sanitized[key] = mask(value);
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)) {
          sanitized[key] = mask(value);
        } else if (Array.isArray(value)) {
          sanitized[key] = value.map((item) => mask(item));
        } else {
          sanitized[key] = '?';
        }
      }
      return sanitized;
    }
    return '?';
  }

  try {
    const masked = mask(obj);
    let serialized = JSON.stringify(masked);
    if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
      serialized = Buffer.from(serialized, 'utf8').subarray(0, maxBytes).toString('utf8') + '... [TRUNCATED]';
    }
    return serialized;
  } catch {
    return '{ "?" }';
  }
}

/**
 * Sanitizes Redis commands by retaining command names and keys,
 * while redacting payload values (e.g. SET, HSET, LPUSH).
 */
export function sanitizeRedisCommand(
  command: string,
  args: Array<unknown> = [],
  maxBytes: number = 2048
): RedisSanitizeResult {
  const operation = (command || 'COMMAND').toUpperCase();
  const safeArgs: string[] = [];

  const stringArgs = args.map((a) => {
    if (Buffer.isBuffer(a)) return '<Buffer>';
    if (typeof a === 'object' && a !== null) {
      try {
        return JSON.stringify(a);
      } catch {
        return '[Object]';
      }
    }
    return String(a);
  });

  const key = stringArgs[0];

  switch (operation) {
    case 'AUTH':
      safeArgs.push('[REDACTED]');
      break;

    case 'SET':
    case 'SETNX':
    case 'SETEX':
    case 'PSETEX':
      if (stringArgs.length > 0) safeArgs.push(stringArgs[0]); // Key
      if (stringArgs.length > 1) safeArgs.push('[REDACTED]');  // Value
      // If there are options like EX 60, keep them
      for (let i = 2; i < stringArgs.length; i++) {
        const arg = stringArgs[i];
        if (['EX', 'PX', 'NX', 'XX', 'KEEPTTL'].includes(arg.toUpperCase())) {
          safeArgs.push(arg);
          if (i + 1 < stringArgs.length) safeArgs.push(stringArgs[++i]);
        }
      }
      break;

    case 'HSET':
    case 'HMSET':
      if (stringArgs.length > 0) safeArgs.push(stringArgs[0]); // Key
      // Fields & values alternating: field [REDACTED]
      for (let i = 1; i < stringArgs.length; i += 2) {
        safeArgs.push(stringArgs[i]); // Field
        if (i + 1 < stringArgs.length) {
          safeArgs.push('[REDACTED]'); // Value
        }
      }
      break;

    case 'LPUSH':
    case 'RPUSH':
    case 'SADD':
    case 'ZADD':
      if (stringArgs.length > 0) safeArgs.push(stringArgs[0]); // Key
      for (let i = 1; i < stringArgs.length; i++) {
        safeArgs.push('[REDACTED]');
      }
      break;

    default:
      // Safe commands: GET, DEL, EXISTS, KEYS, TTL, HGET, HGETALL, etc.
      for (const arg of stringArgs) {
        safeArgs.push(arg);
      }
      break;
  }

  let statement = `${operation} ${safeArgs.join(' ')}`.trim();
  if (Buffer.byteLength(statement, 'utf8') > maxBytes) {
    statement = Buffer.from(statement, 'utf8').subarray(0, maxBytes).toString('utf8') + '... [TRUNCATED]';
  }

  return {
    statement,
    operation,
    key
  };
}
