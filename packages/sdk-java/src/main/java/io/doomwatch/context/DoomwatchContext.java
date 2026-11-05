package io.doomwatch.context;

import io.doomwatch.model.Span;
import io.doomwatch.model.TraceContext;

public final class DoomwatchContext {

    private static final ThreadLocal<TraceContext> CURRENT_CONTEXT = new ThreadLocal<>();
    private static final ThreadLocal<Span> CURRENT_SPAN = new ThreadLocal<>();

    private DoomwatchContext() {}

    public static TraceContext getActiveTraceContext() {
        return CURRENT_CONTEXT.get();
    }

    public static Span getActiveSpan() {
        return CURRENT_SPAN.get();
    }

    public static TraceScope withTraceContext(TraceContext context, Span span) {
        TraceContext prevCtx = CURRENT_CONTEXT.get();
        Span prevSpan = CURRENT_SPAN.get();

        CURRENT_CONTEXT.set(context);
        CURRENT_SPAN.set(span);

        return new TraceScope(prevCtx, prevSpan, span);
    }

    public static TraceScope withTraceContext(TraceContext context) {
        return withTraceContext(context, null);
    }

    static void restore(TraceContext prevContext, Span prevSpan) {
        if (prevContext != null) {
            CURRENT_CONTEXT.set(prevContext);
        } else {
            CURRENT_CONTEXT.remove();
        }

        if (prevSpan != null) {
            CURRENT_SPAN.set(prevSpan);
        } else {
            CURRENT_SPAN.remove();
        }
    }

    public static void clear() {
        CURRENT_CONTEXT.remove();
        CURRENT_SPAN.remove();
    }
}
