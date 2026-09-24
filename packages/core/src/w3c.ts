/**
 * W3C Trace Context (traceparent) Parsing, Formatting, and ID Generation
 * Complies with W3C Recommendation: https://www.w3.org/TR/trace-context/
 */

import { TraceContext } from './types.js';

const TRACEPARENT_REGEX = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;
const ALL_ZEROS_32 = '00000000000000000000000000000000';
const ALL_ZEROS_16 = '0000000000000000';

/**
 * Generates cryptographically secure random bytes as a hex string.
 * Uses globalThis.crypto which is standard across Node.js 18+ and modern browsers.
 */
function randomHexString(numBytes: number): string {
  const bytes = new Uint8Array(numBytes);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Fallback if crypto is not available in unusual environments
    for (let i = 0; i < numBytes; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates a 128-bit (32 hex characters) trace ID.
 */
export function generateTraceId(): string {
  let id = randomHexString(16);
  while (id === ALL_ZEROS_32) {
    id = randomHexString(16);
  }
  return id;
}

/**
 * Generates a 64-bit (16 hex characters) span ID.
 */
export function generateSpanId(): string {
  let id = randomHexString(8);
  while (id === ALL_ZEROS_16) {
    id = randomHexString(8);
  }
  return id;
}

/**
 * Formats trace ID and span ID into a W3C traceparent header string.
 * Example: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
 */
export function formatTraceparent(traceId: string, spanId: string, sampled = true): string {
  const flags = sampled ? '01' : '00';
  return `00-${traceId}-${spanId}-${flags}`;
}

/**
 * Parses a W3C traceparent header string into a TraceContext.
 * Returns null if the header is invalid or all zeros.
 */
export function parseTraceparent(header?: string | null): TraceContext | null {
  if (!header || typeof header !== 'string') {
    return null;
  }

  const match = header.trim().match(TRACEPARENT_REGEX);
  if (!match) {
    return null;
  }

  const [, version, traceId, parentSpanId, flags] = match;

  // Version 00 is supported. Version ff is forbidden by spec.
  if (version === 'ff') {
    return null;
  }

  // Trace ID and Span ID must not be all zeros
  if (traceId === ALL_ZEROS_32 || parentSpanId === ALL_ZEROS_16) {
    return null;
  }

  return {
    trace_id: traceId.toLowerCase(),
    span_id: generateSpanId(), // create a new span id for current operation
    parent_span_id: parentSpanId.toLowerCase(),
    trace_flags: flags
  };
}

/**
 * Normalizes an incoming trace ID from legacy headers (e.g. UUIDs without dashes or with dashes).
 * Converts 36-char UUID to 32-char hex, or pads short strings to 32 chars.
 */
export function normalizeTraceId(rawId: string): string {
  const clean = rawId.replace(/-/g, '').toLowerCase();
  if (/^[0-9a-f]{32}$/.test(clean) && clean !== ALL_ZEROS_32) {
    return clean;
  }
  // If not valid 32 hex, generate a new one
  return generateTraceId();
}

/**
 * Extracts or creates a TraceContext from incoming HTTP headers.
 * 
 * Lookup Order:
 * 1. Standard W3C 'traceparent'
 * 2. Custom/Legacy 'x-tracing-id' (as specified in Doomwatch ideation)
 * 3. Fallback 'x-request-id'
 * 4. Generates a fresh root trace ID if no header is present (NEVER leaves blank!)
 */
export function extractOrGenerateTraceContext(
  headers: Record<string, string | string[] | undefined> = {}
): TraceContext {
  // Case-insensitive header lookup
  const normalizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value != null) {
      normalizedHeaders[key.toLowerCase()] = Array.isArray(value) ? value[0] : String(value);
    }
  }

  // 1. Try W3C traceparent
  const traceparent = normalizedHeaders['traceparent'];
  if (traceparent) {
    const parsed = parseTraceparent(traceparent);
    if (parsed) {
      return parsed;
    }
  }

  // 2. Try legacy x-tracing-id (Point 6 & 7 of ideation)
  const legacyTraceId = normalizedHeaders['x-tracing-id'] || normalizedHeaders['x-request-id'];
  if (legacyTraceId) {
    const traceId = normalizeTraceId(legacyTraceId);
    const parentSpanId = normalizedHeaders['x-parent-id'] || null;
    return {
      trace_id: traceId,
      span_id: generateSpanId(),
      parent_span_id: parentSpanId ? normalizeTraceId(parentSpanId).slice(0, 16) : null,
      trace_flags: '01'
    };
  }

  // 3. Fallback: Generate fresh root TraceContext
  return {
    trace_id: generateTraceId(),
    span_id: generateSpanId(),
    parent_span_id: null,
    trace_flags: '01'
  };
}
