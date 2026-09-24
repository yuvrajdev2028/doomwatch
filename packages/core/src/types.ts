/**
 * Doomwatch Core Data Types & Telemetry Contracts
 */

export type SpanKind = 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER' | 'INTERNAL';

export interface HttpData {
  method: string;
  url: string;
  route?: string;
  status_code?: number;
  request_headers?: Record<string, string | string[] | undefined>;
  request_body?: unknown;
  response_headers?: Record<string, string | string[] | undefined>;
  response_body?: unknown;
}

export interface SpanError {
  name: string;
  message: string;
  stack?: string;
}

export interface Span {
  trace_id: string;              // 32-character hexadecimal string (128-bit)
  span_id: string;               // 16-character hexadecimal string (64-bit)
  parent_span_id?: string | null;// 16-character hexadecimal string or null for root
  service_name: string;          // Originating service name (e.g., 'order-service')
  runtime: string;               // Environment/runtime (e.g., 'node-v20', 'python-fastapi')
  span_kind: SpanKind;           // Type of span (SERVER, CLIENT, etc.)
  name: string;                  // Descriptive name (e.g., 'POST /api/orders')
  start_time_unix_ms: number;    // Start timestamp in milliseconds since epoch
  end_time_unix_ms: number;      // End timestamp in milliseconds since epoch
  duration_ms: number;           // Duration in milliseconds (end - start)
  http?: HttpData;               // HTTP-specific metadata
  error?: SpanError | null;      // Error details if span failed
  metadata?: Record<string, unknown>; // Custom tags or attributes
}

export interface TraceContext {
  trace_id: string;
  span_id: string;
  parent_span_id?: string | null;
  trace_flags?: string; // '01' = sampled
}

export interface TraceSummary {
  trace_id: string;
  root_span_name?: string;
  service_names: string[];
  start_time_unix_ms: number;
  end_time_unix_ms: number;
  total_duration_ms: number;
  span_count: number;
  has_error: boolean;
  status_code?: number;
}

export interface TraceDetails extends TraceSummary {
  spans: Span[];
}

export interface TraceFilter {
  trace_id?: string;
  service_name?: string;
  has_error?: boolean;
  min_duration_ms?: number;
  max_duration_ms?: number;
  status_code?: number;
  from_time_ms?: number;
  to_time_ms?: number;
  limit?: number;
  offset?: number;
}

export interface IngestPayload {
  spans: Span[];
  sent_at_unix_ms?: number;
}

export interface DoomwatchConfig {
  collector_url: string;
  service_name: string;
  environment?: string;
  max_body_bytes?: number;      // Default: 4096 (4KB)
  batch_interval_ms?: number;   // Default: 1000ms
  batch_size?: number;          // Default: 50
  redacted_fields?: string[];   // Keys to redact from payloads
}
