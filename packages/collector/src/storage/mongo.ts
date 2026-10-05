import { MongoClient, Db, Collection, Filter, Document } from 'mongodb';
import { Span, TraceFilter, TraceSummary, TraceDetails } from '@doomwatch/core';
import { StorageEngine } from './interface.js';

export class MongoStorageEngine implements StorageEngine {
  readonly name = 'mongodb';
  private client: MongoClient;
  private db!: Db;
  private spansCollection!: Collection<Span>;
  private connected = false;

  constructor(
    private uri: string,
    private dbName: string = 'doomwatch'
  ) {
    this.client = new MongoClient(this.uri, {
      connectTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 20
    });
  }

  async init(): Promise<void> {
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    this.spansCollection = this.db.collection<Span>('spans');

    // Create optimized indexes for high-throughput ingestion and fast query retrieval
    await Promise.all([
      this.spansCollection.createIndex({ trace_id: 1 }),
      this.spansCollection.createIndex({ service_name: 1, start_time_unix_ms: -1 }),
      this.spansCollection.createIndex({ start_time_unix_ms: -1 }),
      this.spansCollection.createIndex({ 'http.status_code': 1 }),
      this.spansCollection.createIndex({ error: 1 }, { sparse: true })
    ]);

    this.connected = true;
  }

  async insertSpans(spans: Span[]): Promise<number> {
    if (spans.length === 0) return 0;
    const result = await this.spansCollection.insertMany(spans, { ordered: false });
    return result.insertedCount;
  }

  async getTraces(filter: TraceFilter = {}): Promise<TraceSummary[]> {
    const matchStage: Record<string, unknown> = {};

    if (filter.trace_id) {
      matchStage.trace_id = filter.trace_id;
    }
    if (filter.service_name) {
      matchStage.service_name = filter.service_name;
    }
    if (filter.status_code !== undefined) {
      matchStage['http.status_code'] = filter.status_code;
    }
    if (filter.from_time_ms !== undefined || filter.to_time_ms !== undefined) {
      matchStage.start_time_unix_ms = {};
      if (filter.from_time_ms !== undefined) {
        (matchStage.start_time_unix_ms as Record<string, number>).$gte = filter.from_time_ms;
      }
      if (filter.to_time_ms !== undefined) {
        (matchStage.start_time_unix_ms as Record<string, number>).$lte = filter.to_time_ms;
      }
    }

    // Aggregation pipeline to group spans into traces
    const pipeline: Document[] = [
      { $match: matchStage },
      {
        $group: {
          _id: '$trace_id',
          start_time_unix_ms: { $min: '$start_time_unix_ms' },
          end_time_unix_ms: { $max: '$end_time_unix_ms' },
          span_count: { $sum: 1 },
          service_names: { $addToSet: '$service_name' },
          errors: {
            $addToSet: {
              $cond: [
                {
                  $or: [
                    {
                      $and: [
                        { $ne: [{ $type: '$error' }, 'missing'] },
                        { $ne: ['$error', null] }
                      ]
                    },
                    {
                      $and: [
                        { $isNumber: '$http.status_code' },
                        { $gte: ['$http.status_code', 400] }
                      ]
                    }
                  ]
                },
                true,
                false
              ]
            }
          },
          spans: { $push: '$$ROOT' }
        }
      },
      {
        $project: {
          trace_id: '$_id',
          start_time_unix_ms: 1,
          end_time_unix_ms: 1,
          total_duration_ms: { $subtract: ['$end_time_unix_ms', '$start_time_unix_ms'] },
          span_count: 1,
          service_names: 1,
          has_error: { $in: [true, '$errors'] },
          // Pick the root span or the earliest span
          root_span: {
            $first: {
              $filter: {
                input: '$spans',
                as: 's',
                cond: { $eq: ['$$s.parent_span_id', null] }
              }
            }
          },
          earliest_span: { $first: '$spans' }
        }
      }
    ];

    if (filter.has_error !== undefined) {
      pipeline.push({ $match: { has_error: filter.has_error } });
    }
    if (filter.min_duration_ms !== undefined) {
      pipeline.push({ $match: { total_duration_ms: { $gte: filter.min_duration_ms } } });
    }
    if (filter.max_duration_ms !== undefined) {
      pipeline.push({ $match: { total_duration_ms: { $lte: filter.max_duration_ms } } });
    }

    pipeline.push({ $sort: { start_time_unix_ms: -1 } });

    if (filter.offset) {
      pipeline.push({ $skip: filter.offset });
    }
    const limit = filter.limit || 50;
    pipeline.push({ $limit: limit });

    const results = await this.spansCollection.aggregate(pipeline).toArray();

    return results.map((item: any) => {
      const activeSpan = item.root_span || item.earliest_span;
      return {
        trace_id: item.trace_id,
        root_span_name: activeSpan?.name || 'unknown',
        service_names: item.service_names || [],
        start_time_unix_ms: item.start_time_unix_ms,
        end_time_unix_ms: item.end_time_unix_ms,
        total_duration_ms: Math.max(0, item.total_duration_ms || 0),
        span_count: item.span_count,
        has_error: item.has_error,
        status_code: activeSpan?.http?.status_code
      };
    });
  }

  async getTraceById(traceId: string): Promise<TraceDetails | null> {
    const spans = await this.spansCollection
      .find({ trace_id: traceId })
      .sort({ start_time_unix_ms: 1 })
      .toArray();

    if (spans.length === 0) {
      return null;
    }

    const rootSpan = spans.find((s) => !s.parent_span_id) || spans[0];
    const serviceNames = Array.from(new Set(spans.map((s) => s.service_name)));
    const hasError = spans.some((s) => Boolean(s.error) || (s.http?.status_code != null && s.http.status_code >= 400));
    const startTime = spans[0].start_time_unix_ms;
    const endTime = Math.max(...spans.map((s) => s.end_time_unix_ms));

    return {
      trace_id: traceId,
      root_span_name: rootSpan.name,
      service_names: serviceNames,
      start_time_unix_ms: startTime,
      end_time_unix_ms: endTime,
      total_duration_ms: Math.max(0, endTime - startTime),
      span_count: spans.length,
      has_error: hasError,
      status_code: rootSpan.http?.status_code,
      spans
    };
  }

  isHealthy(): boolean {
    return this.connected;
  }

  async close(): Promise<void> {
    this.connected = false;
    await this.client.close();
  }
}
