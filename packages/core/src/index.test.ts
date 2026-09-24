import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateTraceId,
  generateSpanId,
  formatTraceparent,
  parseTraceparent,
  extractOrGenerateTraceContext,
  redactData,
  redactHeaders,
  sanitizePayload
} from './index.js';

describe('W3C Trace Context Utilities', () => {
  it('should generate valid 32-character hex trace ID', () => {
    const traceId = generateTraceId();
    assert.strictEqual(traceId.length, 32);
    assert.match(traceId, /^[0-9a-f]{32}$/);
    assert.notStrictEqual(traceId, '00000000000000000000000000000000');
  });

  it('should generate valid 16-character hex span ID', () => {
    const spanId = generateSpanId();
    assert.strictEqual(spanId.length, 16);
    assert.match(spanId, /^[0-9a-f]{16}$/);
    assert.notStrictEqual(spanId, '0000000000000000');
  });

  it('should format and parse valid traceparent header', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const spanId = '00f067aa0ba902b7';
    const formatted = formatTraceparent(traceId, spanId, true);
    assert.strictEqual(formatted, `00-${traceId}-${spanId}-01`);

    const parsed = parseTraceparent(formatted);
    assert.ok(parsed);
    assert.strictEqual(parsed.trace_id, traceId);
    assert.strictEqual(parsed.parent_span_id, spanId);
    assert.strictEqual(parsed.trace_flags, '01');
    assert.ok(parsed.span_id.length === 16);
  });

  it('should reject invalid or all-zeros traceparent', () => {
    assert.strictEqual(parseTraceparent('invalid-header'), null);
    assert.strictEqual(parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01'), null);
    assert.strictEqual(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01'), null);
    assert.strictEqual(parseTraceparent('ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'), null);
  });

  it('should fall back to legacy x-tracing-id header if present', () => {
    const ctx = extractOrGenerateTraceContext({
      'x-tracing-id': 'e2b3c4d5e6f708192a3b4c5d6e7f8091'
    });
    assert.strictEqual(ctx.trace_id, 'e2b3c4d5e6f708192a3b4c5d6e7f8091');
    assert.strictEqual(ctx.parent_span_id, null);
    assert.ok(ctx.span_id.length === 16);
  });

  it('should generate a fresh root trace context if no headers are provided (NEVER blank)', () => {
    const ctx = extractOrGenerateTraceContext({});
    assert.ok(ctx.trace_id.length === 32);
    assert.ok(ctx.span_id.length === 16);
    assert.strictEqual(ctx.parent_span_id, null);
  });
});

describe('Payload Redaction & Truncation', () => {
  it('should redact sensitive keys recursively', () => {
    const input = {
      username: 'alice',
      password: 'SuperSecretPassword123!',
      nested: {
        api_key: 'sk_live_99999',
        token: 'bearer abc',
        safeData: 42
      }
    };
    const result = redactData(input) as Record<string, any>;
    assert.strictEqual(result.username, 'alice');
    assert.strictEqual(result.password, '[REDACTED]');
    assert.strictEqual(result.nested.api_key, '[REDACTED]');
    assert.strictEqual(result.nested.token, '[REDACTED]');
    assert.strictEqual(result.nested.safeData, 42);
  });

  it('should redact sensitive headers', () => {
    const headers = {
      'content-type': 'application/json',
      authorization: 'Bearer secret_jwt',
      cookie: 'session_id=12345'
    };
    const sanitized = redactHeaders(headers);
    assert.strictEqual(sanitized?.['content-type'], 'application/json');
    assert.strictEqual(sanitized?.['authorization'], '[REDACTED]');
    assert.strictEqual(sanitized?.['cookie'], '[REDACTED]');
  });

  it('should truncate payloads exceeding byte limits', () => {
    const largeObject = { text: 'A'.repeat(5000) };
    const truncated = sanitizePayload(largeObject, 100) as Record<string, any>;
    assert.strictEqual(truncated._doomwatch_truncated, true);
    assert.ok(truncated.original_bytes > 5000);
  });
});
