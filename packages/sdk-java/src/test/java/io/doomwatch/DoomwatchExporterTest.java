package io.doomwatch;

import io.doomwatch.exporter.DoomwatchExporter;
import io.doomwatch.model.Span;
import io.doomwatch.model.SpanKind;
import org.junit.jupiter.api.Test;

import java.net.URI;

import static org.junit.jupiter.api.Assertions.*;

class DoomwatchExporterTest {

    @Test
    void testEndpointNormalization() {
        DoomwatchExporter exp1 = new DoomwatchExporter("http://localhost:4000");
        assertEquals(URI.create("http://localhost:4000/v1/traces"), exp1.getEndpoint());

        DoomwatchExporter exp2 = new DoomwatchExporter("http://localhost:4000/v1/traces");
        assertEquals(URI.create("http://localhost:4000/v1/traces"), exp2.getEndpoint());

        DoomwatchExporter exp3 = new DoomwatchExporter("http://localhost:4000/");
        assertEquals(URI.create("http://localhost:4000/v1/traces"), exp3.getEndpoint());
    }

    @Test
    void testOverloadCapacityLimit() {
        DoomwatchExporter exporter = new DoomwatchExporter("http://localhost:4000", 1000, 50, 5, 2, false);

        for (int i = 0; i < 10; i++) {
            Span span = new Span();
            span.setTraceId("trace-" + i);
            span.setSpanId("span-" + i);
            span.setName("task-" + i);
            span.setSpanKind(SpanKind.INTERNAL);
            exporter.enqueue(span);
        }

        // Capacity is 5, so queue should never exceed 5
        assertEquals(5, exporter.getQueueSize());
    }
}
