package io.doomwatch.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class Span {

    @JsonProperty("trace_id")
    private String traceId;

    @JsonProperty("span_id")
    private String spanId;

    @JsonProperty("parent_span_id")
    private String parentSpanId;

    @JsonProperty("service_name")
    private String serviceName;

    @JsonProperty("runtime")
    private String runtime;

    @JsonProperty("span_kind")
    private SpanKind spanKind;

    @JsonProperty("name")
    private String name;

    @JsonProperty("start_time_unix_ms")
    private long startTimeUnixMs;

    @JsonProperty("end_time_unix_ms")
    private long endTimeUnixMs;

    @JsonProperty("duration_ms")
    private long durationMs;

    @JsonProperty("http")
    private HttpData http;

    @JsonProperty("db")
    private DatabaseData db;

    @JsonProperty("error")
    private SpanError error;

    @JsonProperty("metadata")
    private Map<String, Object> metadata;

    public Span() {}

    public String getTraceId() { return traceId; }
    public void setTraceId(String traceId) { this.traceId = traceId; }

    public String getSpanId() { return spanId; }
    public void setSpanId(String spanId) { this.spanId = spanId; }

    public String getParentSpanId() { return parentSpanId; }
    public void setParentSpanId(String parentSpanId) { this.parentSpanId = parentSpanId; }

    public String getServiceName() { return serviceName; }
    public void setServiceName(String serviceName) { this.serviceName = serviceName; }

    public String getRuntime() { return runtime; }
    public void setRuntime(String runtime) { this.runtime = runtime; }

    public SpanKind getSpanKind() { return spanKind; }
    public void setSpanKind(SpanKind spanKind) { this.spanKind = spanKind; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public long getStartTimeUnixMs() { return startTimeUnixMs; }
    public void setStartTimeUnixMs(long startTimeUnixMs) { this.startTimeUnixMs = startTimeUnixMs; }

    public long getEndTimeUnixMs() { return endTimeUnixMs; }
    public void setEndTimeUnixMs(long endTimeUnixMs) { this.endTimeUnixMs = endTimeUnixMs; }

    public long getDurationMs() { return durationMs; }
    public void setDurationMs(long durationMs) { this.durationMs = durationMs; }

    public HttpData getHttp() { return http; }
    public void setHttp(HttpData http) { this.http = http; }

    public DatabaseData getDb() { return db; }
    public void setDb(DatabaseData db) { this.db = db; }

    public SpanError getError() { return error; }
    public void setError(SpanError error) { this.error = error; }

    public Map<String, Object> getMetadata() { return metadata; }
    public void setMetadata(Map<String, Object> metadata) { this.metadata = metadata; }
}
