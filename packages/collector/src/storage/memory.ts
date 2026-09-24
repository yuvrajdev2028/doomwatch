import { Span, TraceFilter, TraceSummary, TraceDetails } from '@doomwatch/core';
import { StorageEngine } from './interface.js';

export class MemoryStorageEngine implements StorageEngine {
  readonly name = 'in-memory';
  private spansByTrace = new Map<string, Span[]>();
  private allSpans: Span[] = [];
  private healthy = true;

  async init(): Promise<void> {
    this.healthy = true;
  }

  async insertSpans(spans: Span[]): Promise<number> {
    for (const span of spans) {
      this.allSpans.push(span);
      let list = this.spansByTrace.get(span.trace_id);
      if (!list) {
        list = [];
        this.spansByTrace.set(span.trace_id, list);
      }
      list.push(span);
    }
    return spans.length;
  }

  async getTraces(filter: TraceFilter = {}): Promise<TraceSummary[]> {
    const summaries: TraceSummary[] = [];

    for (const [traceId, spans] of this.spansByTrace.entries()) {
      if (filter.trace_id && !traceId.includes(filter.trace_id)) {
        continue;
      }

      // Sort spans chronologically
      const sorted = [...spans].sort((a, b) => a.start_time_unix_ms - b.start_time_unix_ms);
      const rootSpan = sorted.find((s) => !s.parent_span_id) || sorted[0];

      const serviceNames = Array.from(new Set(sorted.map((s) => s.service_name)));
      const hasError = sorted.some((s) => Boolean(s.error) || (s.http?.status_code != null && s.http.status_code >= 400));
      const startTime = sorted[0].start_time_unix_ms;
      const endTime = Math.max(...sorted.map((s) => s.end_time_unix_ms));
      const totalDuration = endTime - startTime;
      const statusCode = rootSpan.http?.status_code;

      // Filter checks
      if (filter.service_name && !serviceNames.includes(filter.service_name)) {
        continue;
      }
      if (filter.has_error !== undefined && hasError !== filter.has_error) {
        continue;
      }
      if (filter.min_duration_ms !== undefined && totalDuration < filter.min_duration_ms) {
        continue;
      }
      if (filter.max_duration_ms !== undefined && totalDuration > filter.max_duration_ms) {
        continue;
      }
      if (filter.status_code !== undefined && statusCode !== filter.status_code) {
        continue;
      }
      if (filter.from_time_ms !== undefined && startTime < filter.from_time_ms) {
        continue;
      }
      if (filter.to_time_ms !== undefined && startTime > filter.to_time_ms) {
        continue;
      }

      summaries.push({
        trace_id: traceId,
        root_span_name: rootSpan.name,
        service_names: serviceNames,
        start_time_unix_ms: startTime,
        end_time_unix_ms: endTime,
        total_duration_ms: Math.max(0, totalDuration),
        span_count: sorted.length,
        has_error: hasError,
        status_code: statusCode
      });
    }

    // Sort by latest trace first
    summaries.sort((a, b) => b.start_time_unix_ms - a.start_time_unix_ms);

    const offset = filter.offset || 0;
    const limit = filter.limit || 50;
    return summaries.slice(offset, offset + limit);
  }

  async getTraceById(traceId: string): Promise<TraceDetails | null> {
    const spans = this.spansByTrace.get(traceId);
    if (!spans || spans.length === 0) {
      return null;
    }

    const sorted = [...spans].sort((a, b) => a.start_time_unix_ms - b.start_time_unix_ms);
    const rootSpan = sorted.find((s) => !s.parent_span_id) || sorted[0];
    const serviceNames = Array.from(new Set(sorted.map((s) => s.service_name)));
    const hasError = sorted.some((s) => Boolean(s.error) || (s.http?.status_code != null && s.http.status_code >= 400));
    const startTime = sorted[0].start_time_unix_ms;
    const endTime = Math.max(...sorted.map((s) => s.end_time_unix_ms));

    return {
      trace_id: traceId,
      root_span_name: rootSpan.name,
      service_names: serviceNames,
      start_time_unix_ms: startTime,
      end_time_unix_ms: endTime,
      total_duration_ms: Math.max(0, endTime - startTime),
      span_count: sorted.length,
      has_error: hasError,
      status_code: rootSpan.http?.status_code,
      spans: sorted
    };
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  async close(): Promise<void> {
    this.healthy = false;
    this.spansByTrace.clear();
    this.allSpans = [];
  }
}
