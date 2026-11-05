package io.doomwatch;

import io.doomwatch.model.TraceContext;
import io.doomwatch.w3c.W3CTraceContext;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class W3CTraceContextTest {

    @Test
    void testGenerateTraceId() {
        String traceId = W3CTraceContext.generateTraceId();
        assertNotNull(traceId);
        assertEquals(32, traceId.length());
        assertTrue(traceId.matches("^[0-9a-f]{32}$"));
        assertNotEquals(W3CTraceContext.ALL_ZEROS_32, traceId);
    }

    @Test
    void testGenerateSpanId() {
        String spanId = W3CTraceContext.generateSpanId();
        assertNotNull(spanId);
        assertEquals(16, spanId.length());
        assertTrue(spanId.matches("^[0-9a-f]{16}$"));
        assertNotEquals(W3CTraceContext.ALL_ZEROS_16, spanId);
    }

    @Test
    void testFormatAndParseTraceparent() {
        String traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
        String spanId = "00f067aa0ba902b7";

        String header = W3CTraceContext.formatTraceparent(traceId, spanId, true);
        assertEquals("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01", header);

        TraceContext parsed = W3CTraceContext.parseTraceparent(header);
        assertNotNull(parsed);
        assertEquals(traceId, parsed.getTraceId());
        assertEquals(spanId, parsed.getParentSpanId());
        assertNotNull(parsed.getSpanId());
        assertEquals(16, parsed.getSpanId().length());
        assertNotEquals(spanId, parsed.getSpanId());
        assertEquals("01", parsed.getTraceFlags());
    }

    @Test
    void testRejectInvalidTraceparent() {
        assertNull(W3CTraceContext.parseTraceparent(null));
        assertNull(W3CTraceContext.parseTraceparent(""));
        assertNull(W3CTraceContext.parseTraceparent("invalid-header"));
        assertNull(W3CTraceContext.parseTraceparent("ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"));
        assertNull(W3CTraceContext.parseTraceparent("00-" + W3CTraceContext.ALL_ZEROS_32 + "-00f067aa0ba902b7-01"));
        assertNull(W3CTraceContext.parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-" + W3CTraceContext.ALL_ZEROS_16 + "-01"));
    }

    @Test
    void testNormalizeTraceId() {
        String uuid = "123e4567-e89b-12d3-a456-426614174000";
        assertEquals("123e4567e89b12d3a456426614174000", W3CTraceContext.normalizeTraceId(uuid));

        String generated = W3CTraceContext.normalizeTraceId("short");
        assertEquals(32, generated.length());
        assertTrue(generated.matches("^[0-9a-f]{32}$"));
    }

    @Test
    void testExtractOrGenerateTraceContext() {
        // 1. From W3C header
        Map<String, String> w3cHeaders = Map.of(
                "traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
        );
        TraceContext ctxW3c = W3CTraceContext.extractOrGenerateTraceContext(w3cHeaders);
        assertEquals("4bf92f3577b34da6a3ce929d0e0e4736", ctxW3c.getTraceId());
        assertEquals("00f067aa0ba902b7", ctxW3c.getParentSpanId());

        // 2. From legacy x-tracing-id
        Map<String, String> legacyHeaders = Map.of(
                "x-tracing-id", "123e4567-e89b-12d3-a456-426614174000",
                "x-parent-id", "abcdef1234567890abcdef1234567890"
        );
        TraceContext ctxLegacy = W3CTraceContext.extractOrGenerateTraceContext(legacyHeaders);
        assertEquals("123e4567e89b12d3a456426614174000", ctxLegacy.getTraceId());
        assertEquals("abcdef1234567890", ctxLegacy.getParentSpanId());

        // 3. No headers -> fresh context (never blank)
        TraceContext ctxFresh = W3CTraceContext.extractOrGenerateTraceContext(Map.of());
        assertNotNull(ctxFresh);
        assertNotNull(ctxFresh.getTraceId());
        assertEquals(32, ctxFresh.getTraceId().length());
        assertNull(ctxFresh.getParentSpanId());
    }
}
