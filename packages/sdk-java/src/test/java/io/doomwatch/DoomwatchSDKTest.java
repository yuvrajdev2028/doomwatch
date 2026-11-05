package io.doomwatch;

import io.doomwatch.context.TraceScope;
import io.doomwatch.model.Span;
import io.doomwatch.model.SpanKind;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class DoomwatchSDKTest {

    @AfterEach
    void tearDown() {
        Doomwatch.shutdown();
    }

    @Test
    void testSingletonInitialization() {
        Doomwatch sdk1 = Doomwatch.init("first-service");
        Doomwatch sdk2 = Doomwatch.init("second-service");

        assertSame(sdk1, sdk2);
        assertEquals("first-service", Doomwatch.getInstance().getConfig().getServiceName());
    }

    @Test
    void testStartSpanNestingAndDAG() {
        Doomwatch sdk = Doomwatch.init(DoomwatchConfig.builder("order-service")
                .collectorUrl("http://localhost:4000")
                .batchIntervalMs(100)
                .build());

        try (TraceScope rootScope = Doomwatch.startSpan("checkoutFlow", SpanKind.INTERNAL, Map.of("cart_id", "cart-123"))) {
            Span rootSpan = rootScope.getSpan();
            assertNotNull(rootSpan.getTraceId());
            assertNotNull(rootSpan.getSpanId());
            assertNull(rootSpan.getParentSpanId());

            try (TraceScope childScope = Doomwatch.startSpan("chargeCard", SpanKind.CLIENT, null)) {
                Span childSpan = childScope.getSpan();
                assertEquals(rootSpan.getTraceId(), childSpan.getTraceId());
                assertEquals(rootSpan.getSpanId(), childSpan.getParentSpanId());
            }
        }

        assertEquals(2, sdk.getExporter().getQueueSize());
    }
}
