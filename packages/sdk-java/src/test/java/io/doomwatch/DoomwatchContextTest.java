package io.doomwatch;

import io.doomwatch.context.DoomwatchContext;
import io.doomwatch.context.TraceScope;
import io.doomwatch.model.Span;
import io.doomwatch.model.TraceContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;

class DoomwatchContextTest {

    @AfterEach
    void tearDown() {
        DoomwatchContext.clear();
    }

    @Test
    void testContextScopeRestoration() {
        assertNull(DoomwatchContext.getActiveTraceContext());
        assertNull(DoomwatchContext.getActiveSpan());

        TraceContext ctx = new TraceContext("trace-1", "span-1");
        Span span = new Span();
        span.setTraceId("trace-1");
        span.setSpanId("span-1");

        try (TraceScope scope = DoomwatchContext.withTraceContext(ctx, span)) {
            assertEquals(ctx, DoomwatchContext.getActiveTraceContext());
            assertEquals(span, DoomwatchContext.getActiveSpan());

            TraceContext nestedCtx = new TraceContext("trace-1", "span-2", "span-1");
            Span nestedSpan = new Span();
            nestedSpan.setTraceId("trace-1");
            nestedSpan.setSpanId("span-2");

            try (TraceScope nestedScope = DoomwatchContext.withTraceContext(nestedCtx, nestedSpan)) {
                assertEquals(nestedCtx, DoomwatchContext.getActiveTraceContext());
                assertEquals(nestedSpan, DoomwatchContext.getActiveSpan());
            }

            assertEquals(ctx, DoomwatchContext.getActiveTraceContext());
            assertEquals(span, DoomwatchContext.getActiveSpan());
        }

        assertNull(DoomwatchContext.getActiveTraceContext());
        assertNull(DoomwatchContext.getActiveSpan());
    }

    @Test
    void testThreadIsolation() throws Exception {
        TraceContext mainCtx = new TraceContext("main-trace", "main-span");
        DoomwatchContext.withTraceContext(mainCtx);

        ExecutorService executor = Executors.newSingleThreadExecutor();
        Future<TraceContext> future = executor.submit(DoomwatchContext::getActiveTraceContext);
        TraceContext threadCtx = future.get(1, TimeUnit.SECONDS);
        executor.shutdown();

        assertNull(threadCtx, "New thread should have isolated context");
        assertEquals(mainCtx, DoomwatchContext.getActiveTraceContext());
    }
}
