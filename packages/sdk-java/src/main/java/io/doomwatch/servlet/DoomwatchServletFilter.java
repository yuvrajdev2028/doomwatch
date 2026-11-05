package io.doomwatch.servlet;

import io.doomwatch.context.DoomwatchContext;
import io.doomwatch.context.TraceScope;
import io.doomwatch.exporter.DoomwatchExporter;
import io.doomwatch.model.*;
import io.doomwatch.redact.Sanitizer;
import io.doomwatch.w3c.W3CTraceContext;
import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.util.*;

public class DoomwatchServletFilter implements Filter {

    private final String serviceName;
    private final DoomwatchExporter exporter;
    private final int maxBodyBytes;
    private final List<String> redactedKeys;
    private final String runtime;

    public DoomwatchServletFilter(
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

    public DoomwatchServletFilter(String serviceName, DoomwatchExporter exporter) {
        this(serviceName, exporter, 4096, Collections.emptyList());
    }

    @Override
    public void init(FilterConfig filterConfig) throws ServletException {}

    @Override
    public void doFilter(
            ServletRequest request,
            ServletResponse response,
            FilterChain chain
    ) throws IOException, ServletException {
        if (!(request instanceof HttpServletRequest httpRequest) ||
            !(response instanceof HttpServletResponse httpResponse)) {
            chain.doFilter(request, response);
            return;
        }

        // 1. Extract incoming headers
        Map<String, String> incomingHeaders = new HashMap<>();
        Enumeration<String> headerNames = httpRequest.getHeaderNames();
        if (headerNames != null) {
            while (headerNames.hasMoreElements()) {
                String name = headerNames.nextElement();
                incomingHeaders.put(name.toLowerCase(), httpRequest.getHeader(name));
            }
        }

        // 2. Extract or generate trace context
        TraceContext traceCtx = W3CTraceContext.extractOrGenerateTraceContext(incomingHeaders);

        // 3. Inject trace headers into response
        String tpHeader = W3CTraceContext.formatTraceparent(traceCtx.getTraceId(), traceCtx.getSpanId());
        httpResponse.setHeader("traceparent", tpHeader);
        httpResponse.setHeader("x-tracing-id", traceCtx.getTraceId());

        long startTime = System.currentTimeMillis();
        String method = httpRequest.getMethod();
        String uri = httpRequest.getRequestURI();
        String queryString = httpRequest.getQueryString();
        String fullUrl = queryString != null ? uri + "?" + queryString : uri;

        Span span = new Span();
        span.setTraceId(traceCtx.getTraceId());
        span.setSpanId(traceCtx.getSpanId());
        span.setParentSpanId(traceCtx.getParentSpanId());
        span.setServiceName(serviceName);
        span.setRuntime(runtime);
        span.setSpanKind(SpanKind.SERVER);
        span.setName(method + " " + uri);
        span.setStartTimeUnixMs(startTime);

        HttpData httpData = new HttpData(method, fullUrl);
        httpData.setRoute(uri);
        httpData.setRequestHeaders(Sanitizer.redactHeaders(incomingHeaders));
        span.setHttp(httpData);

        Throwable thrownError = null;
        try (TraceScope scope = DoomwatchContext.withTraceContext(traceCtx, span)) {
            chain.doFilter(request, response);
        } catch (Throwable t) {
            thrownError = t;
            if (t instanceof IOException ioEx) throw ioEx;
            if (t instanceof ServletException sEx) throw sEx;
            throw new ServletException(t);
        } finally {
            long endTime = System.currentTimeMillis();
            span.setEndTimeUnixMs(endTime);
            span.setDurationMs(Math.max(0, endTime - startTime));

            int statusCode = thrownError != null ? 500 : httpResponse.getStatus();
            span.getHttp().setStatusCode(statusCode);

            if (thrownError != null) {
                span.setError(SpanError.fromThrowable(thrownError));
            }

            exporter.enqueue(span);
        }
    }

    @Override
    public void destroy() {}
}
