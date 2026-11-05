package io.doomwatch;

import io.doomwatch.client.DoomwatchRestTemplateInterceptor;
import io.doomwatch.context.DoomwatchContext;
import io.doomwatch.context.TraceScope;
import io.doomwatch.exporter.DoomwatchExporter;
import io.doomwatch.model.Span;
import io.doomwatch.model.SpanKind;
import io.doomwatch.model.TraceContext;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpResponse;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class DoomwatchRestTemplateInterceptorTest {

    @Test
    void testInterceptorInjectsHeadersAndRecordsClientSpan() throws Exception {
        List<Span> enqueuedSpans = new ArrayList<>();
        DoomwatchExporter mockExporter = new DoomwatchExporter("http://localhost:4000") {
            @Override
            public void enqueue(Span span) {
                enqueuedSpans.add(span);
            }
        };

        DoomwatchRestTemplateInterceptor interceptor =
                new DoomwatchRestTemplateInterceptor("order-service", mockExporter);

        HttpHeaders headers = new HttpHeaders();
        URI uri = URI.create("http://payment-service:3002/charge");

        HttpRequest request = new HttpRequest() {
            @Override
            public HttpMethod getMethod() { return HttpMethod.POST; }
            @Override
            public URI getURI() { return uri; }
            @Override
            public HttpHeaders getHeaders() { return headers; }
            @Override
            public java.util.Map<String, Object> getAttributes() { return java.util.Collections.emptyMap(); }
        };

        ClientHttpResponse mockResponse = new ClientHttpResponse() {
            @Override
            public HttpStatus getStatusCode() { return HttpStatus.OK; }
            @Override
            public String getStatusText() { return "OK"; }
            @Override
            public void close() {}
            @Override
            public InputStream getBody() { return new ByteArrayInputStream(new byte[0]); }
            @Override
            public HttpHeaders getHeaders() { return new HttpHeaders(); }
        };

        ClientHttpRequestExecution execution = (req, body) -> mockResponse;

        TraceContext activeContext = new TraceContext("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7");

        try (TraceScope scope = DoomwatchContext.withTraceContext(activeContext)) {
            interceptor.intercept(request, "{\"amount\": 99}".getBytes(), execution);
        }

        // Outbound headers
        assertTrue(headers.containsKey("traceparent"));
        assertTrue(headers.containsKey("x-tracing-id"));
        assertEquals("4bf92f3577b34da6a3ce929d0e0e4736", headers.getFirst("x-tracing-id"));

        // Enqueued span
        assertEquals(1, enqueuedSpans.size());
        Span span = enqueuedSpans.get(0);
        assertEquals("4bf92f3577b34da6a3ce929d0e0e4736", span.getTraceId());
        assertEquals("00f067aa0ba902b7", span.getParentSpanId());
        assertEquals(SpanKind.CLIENT, span.getSpanKind());
        assertEquals("order-service", span.getServiceName());
        assertEquals("POST /charge", span.getName());
        assertEquals(200, span.getHttp().getStatusCode());
    }
}
