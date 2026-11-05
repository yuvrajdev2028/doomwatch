package io.doomwatch.client;

import io.doomwatch.context.DoomwatchContext;
import io.doomwatch.exporter.DoomwatchExporter;
import io.doomwatch.model.*;
import io.doomwatch.w3c.W3CTraceContext;
import java.net.URI;
import java.net.http.HttpRequest;

public final class DoomwatchHttpClientHelper {

    private DoomwatchHttpClientHelper() {}

    public static class ClientSpanRecorder implements AutoCloseable {
        private final Span span;
        private final DoomwatchExporter exporter;
        private final long startTime;

        public ClientSpanRecorder(Span span, DoomwatchExporter exporter, long startTime) {
            this.span = span;
            this.exporter = exporter;
            this.startTime = startTime;
        }

        public void recordResponse(int statusCode) {
            if (span.getHttp() != null) {
                span.getHttp().setStatusCode(statusCode);
            }
        }

        public void recordError(Throwable error) {
            if (error != null) {
                span.setError(SpanError.fromThrowable(error));
            }
        }

        @Override
        public void close() {
            long endTime = System.currentTimeMillis();
            span.setEndTimeUnixMs(endTime);
            span.setDurationMs(Math.max(0, endTime - startTime));
            if (exporter != null) {
                exporter.enqueue(span);
            }
        }
    }

    public static ClientSpanRecorder instrument(
            HttpRequest.Builder builder,
            String method,
            URI uri,
            String serviceName,
            DoomwatchExporter exporter
    ) {
        TraceContext activeCtx = DoomwatchContext.getActiveTraceContext();
        Span activeSpan = DoomwatchContext.getActiveSpan();

        String traceId = activeCtx != null ? activeCtx.getTraceId() : W3CTraceContext.generateTraceId();
        String childSpanId = W3CTraceContext.generateSpanId();
        String parentSpanId = activeSpan != null ? activeSpan.getSpanId() : (activeCtx != null ? activeCtx.getSpanId() : null);

        String tpHeader = W3CTraceContext.formatTraceparent(traceId, childSpanId);
        builder.header("traceparent", tpHeader);
        builder.header("x-tracing-id", traceId);

        long startTime = System.currentTimeMillis();

        Span span = new Span();
        span.setTraceId(traceId);
        span.setSpanId(childSpanId);
        span.setParentSpanId(parentSpanId);
        span.setServiceName(serviceName != null ? serviceName : "java-service");
        span.setRuntime("java-" + System.getProperty("java.version"));
        span.setSpanKind(SpanKind.CLIENT);
        span.setName(method + " " + (uri.getPath() != null ? uri.getPath() : "/"));
        span.setStartTimeUnixMs(startTime);

        HttpData httpData = new HttpData(method, uri.toString());
        httpData.setRoute(uri.getPath() != null ? uri.getPath() : "/");
        span.setHttp(httpData);

        return new ClientSpanRecorder(span, exporter, startTime);
    }
}
