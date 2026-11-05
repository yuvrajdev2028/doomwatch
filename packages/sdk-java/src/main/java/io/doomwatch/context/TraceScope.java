package io.doomwatch.context;

import io.doomwatch.model.Span;
import io.doomwatch.model.TraceContext;

public class TraceScope implements AutoCloseable {

    private final TraceContext previousContext;
    private final Span previousSpan;
    private final Span currentSpan;

    public TraceScope(TraceContext previousContext, Span previousSpan, Span currentSpan) {
        this.previousContext = previousContext;
        this.previousSpan = previousSpan;
        this.currentSpan = currentSpan;
    }

    public Span getSpan() {
        return currentSpan;
    }

    @Override
    public void close() {
        DoomwatchContext.restore(previousContext, previousSpan);
    }
}
