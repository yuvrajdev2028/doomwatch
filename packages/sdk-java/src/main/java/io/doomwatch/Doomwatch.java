package io.doomwatch;

import io.doomwatch.context.DoomwatchContext;
import io.doomwatch.context.TraceScope;
import io.doomwatch.exporter.DoomwatchExporter;
import io.doomwatch.model.Span;
import io.doomwatch.model.SpanKind;
import io.doomwatch.model.TraceContext;
import io.doomwatch.w3c.W3CTraceContext;

import java.util.Map;
import java.util.logging.Logger;

public class Doomwatch {

    private static final Logger LOGGER = Logger.getLogger(Doomwatch.class.getName());
    private static volatile Doomwatch instance;

    private final DoomwatchConfig config;
    private final DoomwatchExporter exporter;
    private final String runtime;

    private Doomwatch(DoomwatchConfig config) {
        this.config = config;
        this.runtime = "java-" + System.getProperty("java.version");
        this.exporter = new DoomwatchExporter(
                config.getCollectorUrl(),
                config.getBatchIntervalMs(),
                config.getBatchSize(),
                config.getMaxQueueCapacity(),
                2,
                config.isDebug()
        );
        this.exporter.start();

        if (config.isDebug()) {
            LOGGER.info(String.format("[Doomwatch SDK] Initialized for service '%s' -> %s",
                    config.getServiceName(), config.getCollectorUrl()));
        }
    }

    public static synchronized Doomwatch init(DoomwatchConfig config) {
        if (instance == null) {
            instance = new Doomwatch(config);
        }
        return instance;
    }

    public static synchronized Doomwatch init(String serviceName) {
        return init(DoomwatchConfig.builder(serviceName).build());
    }

    public static Doomwatch getInstance() {
        return instance;
    }

    public DoomwatchConfig getConfig() {
        return config;
    }

    public DoomwatchExporter getExporter() {
        return exporter;
    }

    public static TraceContext getActiveTraceContext() {
        return DoomwatchContext.getActiveTraceContext();
    }

    public static Span getActiveSpan() {
        return DoomwatchContext.getActiveSpan();
    }

    /**
     * Starts an internal or custom span within the current trace context.
     * Use within a try-with-resources statement:
     * <pre>
     * try (TraceScope scope = Doomwatch.startSpan("processOrder")) {
     *     // business logic
     * }
     * </pre>
     */
    public static TraceScope startSpan(String name, SpanKind spanKind, Map<String, Object> metadata) {
        TraceContext activeCtx = getActiveTraceContext();
        Span activeSpan = getActiveSpan();

        String traceId = activeCtx != null ? activeCtx.getTraceId() : W3CTraceContext.generateTraceId();
        String childSpanId = W3CTraceContext.generateSpanId();
        String parentSpanId = activeSpan != null ? activeSpan.getSpanId() : (activeCtx != null ? activeCtx.getSpanId() : null);

        Doomwatch currentInstance = getInstance();
        String serviceName = currentInstance != null ? currentInstance.config.getServiceName() : "java-service";
        String runtime = currentInstance != null ? currentInstance.runtime : "java-" + System.getProperty("java.version");

        long startTime = System.currentTimeMillis();
        Span span = new Span();
        span.setTraceId(traceId);
        span.setSpanId(childSpanId);
        span.setParentSpanId(parentSpanId);
        span.setServiceName(serviceName);
        span.setRuntime(runtime);
        span.setSpanKind(spanKind != null ? spanKind : SpanKind.INTERNAL);
        span.setName(name);
        span.setStartTimeUnixMs(startTime);
        span.setMetadata(metadata);

        TraceContext newCtx = new TraceContext(
                traceId,
                childSpanId,
                parentSpanId,
                activeCtx != null ? activeCtx.getTraceFlags() : "01"
        );

        TraceScope parentScope = DoomwatchContext.withTraceContext(newCtx, span);

        return new TraceScope(activeCtx, activeSpan, span) {
            @Override
            public void close() {
                try {
                    long endTime = System.currentTimeMillis();
                    span.setEndTimeUnixMs(endTime);
                    span.setDurationMs(Math.max(0, endTime - startTime));

                    if (currentInstance != null && currentInstance.getExporter() != null) {
                        currentInstance.getExporter().enqueue(span);
                    }
                } finally {
                    parentScope.close();
                }
            }
        };
    }

    public static TraceScope startSpan(String name) {
        return startSpan(name, SpanKind.INTERNAL, null);
    }

    public static void flush() {
        if (instance != null && instance.exporter != null) {
            instance.exporter.flush();
        }
    }

    public static synchronized void shutdown() {
        if (instance != null) {
            if (instance.exporter != null) {
                instance.exporter.shutdown();
            }
            DoomwatchContext.clear();
            instance = null;
        }
    }
}
