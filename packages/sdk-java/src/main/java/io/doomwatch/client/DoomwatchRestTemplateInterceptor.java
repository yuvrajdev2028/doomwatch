package io.doomwatch.client;

import io.doomwatch.context.DoomwatchContext;
import io.doomwatch.exporter.DoomwatchExporter;
import io.doomwatch.model.*;
import io.doomwatch.redact.Sanitizer;
import io.doomwatch.w3c.W3CTraceContext;
import org.springframework.http.HttpRequest;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;

import java.io.IOException;
import java.net.URI;
import java.util.*;

public class DoomwatchRestTemplateInterceptor implements ClientHttpRequestInterceptor {

    private final String serviceName;
    private final DoomwatchExporter exporter;
    private final int maxBodyBytes;
    private final List<String> redactedKeys;
    private final String runtime;

    public DoomwatchRestTemplateInterceptor(
            String serviceName,
            DoomwatchExporter exporter,
            int maxBodyBytes,
            List<String> redactedKeys
    ) {
        this.serviceName = serviceName != null ? serviceName : "java-service";
        this.exporter = exporter != null ? exporter : new DoomwatchExporter();
        this.maxBodyBytes = maxBodyBytes;
        this.redactedKeys = redactedKeys != null ? redactedKeys : Collections.emptyList();
        this.runtime = "java-" + System.getProperty("java.version");
    }

    public DoomwatchRestTemplateInterceptor(String serviceName, DoomwatchExporter exporter) {
        this(serviceName, exporter, 4096, Collections.emptyList());
    }

    @Override
    public ClientHttpResponse intercept(
            HttpRequest request,
            byte[] body,
            ClientHttpRequestExecution execution
    ) throws IOException {
        URI uri = request.getURI();

        // Skip tracing calls destined to the Collector itself
        if (exporter.getEndpoint() != null &&
            uri.getHost() != null &&
            uri.getHost().equalsIgnoreCase(exporter.getEndpoint().getHost()) &&
            uri.getPath().contains("/v1/traces")) {
            return execution.execute(request, body);
        }

        TraceContext activeCtx = DoomwatchContext.getActiveTraceContext();
        Span activeSpan = DoomwatchContext.getActiveSpan();

        String traceId = activeCtx != null ? activeCtx.getTraceId() : W3CTraceContext.generateTraceId();
        String childSpanId = W3CTraceContext.generateSpanId();
        String parentSpanId = activeSpan != null ? activeSpan.getSpanId() : (activeCtx != null ? activeCtx.getSpanId() : null);

        String tpHeader = W3CTraceContext.formatTraceparent(traceId, childSpanId);
        if (!request.getHeaders().containsKey("traceparent")) {
            request.getHeaders().set("traceparent", tpHeader);
        }
        if (!request.getHeaders().containsKey("x-tracing-id")) {
            request.getHeaders().set("x-tracing-id", traceId);
        }

        long startTime = System.currentTimeMillis();
        Integer statusCode = null;
        Throwable error = null;
        ClientHttpResponse response = null;

        try {
            response = execution.execute(request, body);
            statusCode = response.getStatusCode().value();
            return response;
        } catch (IOException | RuntimeException e) {
            error = e;
            throw e;
        } finally {
            long endTime = System.currentTimeMillis();

            Span span = new Span();
            span.setTraceId(traceId);
            span.setSpanId(childSpanId);
            span.setParentSpanId(parentSpanId);
            span.setServiceName(serviceName);
            span.setRuntime(runtime);
            span.setSpanKind(SpanKind.CLIENT);
            span.setName(request.getMethod().name() + " " + (uri.getPath() != null ? uri.getPath() : "/"));
            span.setStartTimeUnixMs(startTime);
            span.setEndTimeUnixMs(endTime);
            span.setDurationMs(Math.max(0, endTime - startTime));

            HttpData httpData = new HttpData(request.getMethod().name(), uri.toString());
            httpData.setRoute(uri.getPath() != null ? uri.getPath() : "/");
            httpData.setStatusCode(statusCode);

            Map<String, Object> reqHeaders = new HashMap<>();
            request.getHeaders().forEach((k, v) -> reqHeaders.put(k, v.isEmpty() ? "" : v.get(0)));
            httpData.setRequestHeaders(Sanitizer.redactHeaders(reqHeaders));

            if (body != null && body.length > 0) {
                httpData.setRequestBody(Sanitizer.sanitizePayload(body, maxBodyBytes, redactedKeys));
            }

            span.setHttp(httpData);

            if (error != null) {
                span.setError(SpanError.fromThrowable(error));
            }

            exporter.enqueue(span);
        }
    }
}
