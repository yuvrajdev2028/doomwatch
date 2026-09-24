/**
 * Payload Sanitization, Redaction & Truncation Utilities
 */

const DEFAULT_SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'authorization',
  'auth',
  'cookie',
  'set-cookie',
  'apikey',
  'api_key',
  'api-key',
  'x-api-key',
  'privatekey',
  'private_key',
  'creditcard',
  'credit_card',
  'cardnumber',
  'card_number',
  'cvv',
  'cvc',
  'ssn'
]);

const REDACTED_PLACEHOLDER = '[REDACTED]';
const DEFAULT_MAX_BODY_BYTES = 4096; // 4KB

/**
 * Checks if a key name matches any known sensitive patterns.
 */
function isSensitiveKey(key: string, customKeys?: string[]): boolean {
  const lower = key.toLowerCase().replace(/[-_]/g, '');
  if (DEFAULT_SENSITIVE_KEYS.has(lower)) {
    return true;
  }
  if (customKeys) {
    for (const custom of customKeys) {
      if (lower === custom.toLowerCase().replace(/[-_]/g, '')) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Recursively redacts sensitive fields from objects or arrays.
 */
export function redactData(data: unknown, customKeys?: string[], depth = 0): unknown {
  if (data == null || depth > 8) {
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactData(item, customKeys, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (isSensitiveKey(key, customKeys)) {
      sanitized[key] = REDACTED_PLACEHOLDER;
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = redactData(value, customKeys, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Redacts sensitive HTTP headers (e.g. Authorization, Cookie).
 */
export function redactHeaders(
  headers?: Record<string, string | string[] | undefined>
): Record<string, string | string[] | undefined> | undefined {
  if (!headers) return undefined;

  const sanitized: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (
      lower === 'authorization' ||
      lower === 'cookie' ||
      lower === 'set-cookie' ||
      lower.includes('token') ||
      lower.includes('secret') ||
      lower.includes('key')
    ) {
      sanitized[key] = REDACTED_PLACEHOLDER;
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Safely sanitizes and truncates a request/response payload to stay within size bounds.
 */
export function sanitizePayload(
  payload: unknown,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
  customRedactKeys?: string[]
): unknown {
  if (payload == null) {
    return null;
  }

  // 1. Redact sensitive values first
  const redacted = redactData(payload, customRedactKeys);

  // 2. Enforce byte length limits
  try {
    const serialized = typeof redacted === 'string' ? redacted : JSON.stringify(redacted);
    if (serialized && serialized.length > maxBytes) {
      return {
        _doomwatch_truncated: true,
        preview: serialized.slice(0, maxBytes),
        original_bytes: serialized.length,
        message: `Payload truncated because size (${serialized.length} bytes) exceeded maximum limit (${maxBytes} bytes)`
      };
    }
    return redacted;
  } catch {
    return '[Unserializable Payload]';
  }
}
