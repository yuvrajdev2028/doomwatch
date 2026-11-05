package io.doomwatch;

import io.doomwatch.context.DoomwatchContext;
import io.doomwatch.exporter.DoomwatchExporter;
import io.doomwatch.model.Span;
import io.doomwatch.model.SpanKind;
import io.doomwatch.model.TraceContext;
import io.doomwatch.servlet.DoomwatchServletFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.lang.reflect.Proxy;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

class DoomwatchServletFilterTest {

    @Test
    void testFilterExtractsTraceAndRecordsServerSpan() throws Exception {
        List<Span> enqueuedSpans = new ArrayList<>();
        DoomwatchExporter mockExporter = new DoomwatchExporter("http://localhost:4000") {
            @Override
            public void enqueue(Span span) {
                enqueuedSpans.add(span);
            }
        };

        DoomwatchServletFilter filter = new DoomwatchServletFilter("payment-service", mockExporter);

        Map<String, String> requestHeaders = new HashMap<>();
        requestHeaders.put("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");

        Map<String, String> responseHeaders = new HashMap<>();
        String[] capturedTraceInHandler = new String[1];

        HttpServletRequest req = (HttpServletRequest) Proxy.newProxyInstance(
                getClass().getClassLoader(),
                new Class<?>[]{HttpServletRequest.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "getMethod" -> "POST";
                    case "getRequestURI" -> "/charge";
                    case "getQueryString" -> null;
                    case "getHeader" -> requestHeaders.get(((String) args[0]).toLowerCase());
                    case "getHeaderNames" -> Collections.enumeration(requestHeaders.keySet());
                    default -> null;
                }
        );

        HttpServletResponse resp = (HttpServletResponse) Proxy.newProxyInstance(
                getClass().getClassLoader(),
                new Class<?>[]{HttpServletResponse.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "setHeader" -> {
                        responseHeaders.put((String) args[0], (String) args[1]);
                        yield null;
                    }
                    case "getStatus" -> 200;
                    default -> null;
                }
        );

        FilterChain chain = (request, response) -> {
            TraceContext active = DoomwatchContext.getActiveTraceContext();
            if (active != null) {
                capturedTraceInHandler[0] = active.getTraceId();
            }
        };

        filter.doFilter(req, resp, chain);

        // Ambient context inside handler
        assertEquals("4bf92f3577b34da6a3ce929d0e0e4736", capturedTraceInHandler[0]);

        // Response headers
        assertTrue(responseHeaders.containsKey("traceparent"));
        assertTrue(responseHeaders.containsKey("x-tracing-id"));
        assertEquals("4bf92f3577b34da6a3ce929d0e0e4736", responseHeaders.get("x-tracing-id"));

        // Enqueued span
        assertEquals(1, enqueuedSpans.size());
        Span span = enqueuedSpans.get(0);
        assertEquals("4bf92f3577b34da6a3ce929d0e0e4736", span.getTraceId());
        assertEquals("00f067aa0ba902b7", span.getParentSpanId());
        assertEquals(SpanKind.SERVER, span.getSpanKind());
        assertEquals("payment-service", span.getServiceName());
        assertEquals("POST /charge", span.getName());
        assertEquals(200, span.getHttp().getStatusCode());
    }
}
