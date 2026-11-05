package io.doomwatch.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class TraceContext {

    @JsonProperty("trace_id")
    private String traceId;

    @JsonProperty("span_id")
    private String spanId;

    @JsonProperty("parent_span_id")
    private String parentSpanId;

    @JsonProperty("trace_flags")
    private String traceFlags = "01";

    public TraceContext() {}

    public TraceContext(String traceId, String spanId) {
        this(traceId, spanId, null, "01");
    }

    public TraceContext(String traceId, String spanId, String parentSpanId) {
        this(traceId, spanId, parentSpanId, "01");
    }

    public TraceContext(String traceId, String spanId, String parentSpanId, String traceFlags) {
        this.traceId = traceId;
        this.spanId = spanId;
        this.parentSpanId = parentSpanId;
        this.traceFlags = traceFlags != null ? traceFlags : "01";
    }

    public String getTraceId() { return traceId; }
    public void setTraceId(String traceId) { this.traceId = traceId; }

    public String getSpanId() { return spanId; }
    public void setSpanId(String spanId) { this.spanId = spanId; }

    public String getParentSpanId() { return parentSpanId; }
    public void setParentSpanId(String parentSpanId) { this.parentSpanId = parentSpanId; }

    public String getTraceFlags() { return traceFlags; }
    public void setTraceFlags(String traceFlags) { this.traceFlags = traceFlags; }
}
