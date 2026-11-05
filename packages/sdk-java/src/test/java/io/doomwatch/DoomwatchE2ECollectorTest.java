package io.doomwatch;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import io.doomwatch.exporter.DoomwatchExporter;
import io.doomwatch.model.HttpData;
import io.doomwatch.model.Span;
import io.doomwatch.model.SpanKind;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class DoomwatchE2ECollectorTest {

    private static HttpServer server;
    private static int port;
    private static final List<Map<String, Object>> receivedPayloads = new ArrayList<>();
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @BeforeAll
    static void startMockCollector() throws Exception {
        receivedPayloads.clear();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        port = server.getAddress().getPort();

        server.createContext("/v1/traces", exchange -> {
            if ("POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                try (InputStream is = exchange.getRequestBody()) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> data = OBJECT_MAPPER.readValue(is, Map.class);
                    synchronized (receivedPayloads) {
                        receivedPayloads.add(data);
                    }
                }
                byte[] response = "{\"accepted\": 1, \"pending\": 0}".getBytes();
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(202, response.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(response);
                }
            } else {
                exchange.sendResponseHeaders(405, -1);
            }
        });

        server.start();
    }

    @AfterAll
    static void stopMockCollector() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void testExporterTransmitsSpansToCollector() {
        DoomwatchExporter exporter = new DoomwatchExporter(
                "http://127.0.0.1:" + port,
                50,
                2,
                100,
                2,
                false
        );
        exporter.start();

        Span span1 = new Span();
        span1.setTraceId("4bf92f3577b34da6a3ce929d0e0e4736");
        span1.setSpanId("00f067aa0ba902b7");
        span1.setParentSpanId(null);
        span1.setServiceName("java-order-service");
        span1.setRuntime("java-21");
        span1.setSpanKind(SpanKind.SERVER);
        span1.setName("POST /orders");
        span1.setStartTimeUnixMs(1700000000000L);
        span1.setEndTimeUnixMs(1700000000050L);
        span1.setDurationMs(50);
        span1.setHttp(new HttpData("POST", "http://127.0.0.1:8080/orders"));

        Span span2 = new Span();
        span2.setTraceId("4bf92f3577b34da6a3ce929d0e0e4736");
        span2.setSpanId("11a122b233c344d4");
        span2.setParentSpanId("00f067aa0ba902b7");
        span2.setServiceName("java-order-service");
        span2.setRuntime("java-21");
        span2.setSpanKind(SpanKind.CLIENT);
        span2.setName("POST /charge");
        span2.setStartTimeUnixMs(1700000000010L);
        span2.setEndTimeUnixMs(1700000000040L);
        span2.setDurationMs(30);
        span2.setHttp(new HttpData("POST", "http://payment-service:3002/charge"));

        exporter.enqueue(span1);
        exporter.enqueue(span2);

        exporter.flush();
        exporter.shutdown();

        assertFalse(receivedPayloads.isEmpty());
        Map<String, Object> payload = receivedPayloads.get(0);
        assertTrue(payload.containsKey("spans"));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> spans = (List<Map<String, Object>>) payload.get("spans");
        assertEquals(2, spans.size());

        assertEquals("4bf92f3577b34da6a3ce929d0e0e4736", spans.get(0).get("trace_id"));
        assertEquals("00f067aa0ba902b7", spans.get(0).get("span_id"));
        assertNull(spans.get(0).get("parent_span_id"));

        assertEquals("4bf92f3577b34da6a3ce929d0e0e4736", spans.get(1).get("trace_id"));
        assertEquals("11a122b233c344d4", spans.get(1).get("span_id"));
        assertEquals("00f067aa0ba902b7", spans.get(1).get("parent_span_id"));
    }
}
