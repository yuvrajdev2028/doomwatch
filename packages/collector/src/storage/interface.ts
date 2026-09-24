import { Span, TraceFilter, TraceSummary, TraceDetails } from '@doomwatch/core';

export interface StorageEngine {
  readonly name: string;
  init(): Promise<void>;
  insertSpans(spans: Span[]): Promise<number>;
  getTraces(filter: TraceFilter): Promise<TraceSummary[]>;
  getTraceById(traceId: string): Promise<TraceDetails | null>;
  isHealthy(): boolean;
  close(): Promise<void>;
}
