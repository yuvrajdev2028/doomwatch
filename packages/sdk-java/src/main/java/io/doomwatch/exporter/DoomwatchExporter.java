package io.doomwatch.exporter;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.doomwatch.model.Span;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Level;
import java.util.logging.Logger;

public class DoomwatchExporter {

    private static final Logger LOGGER = Logger.getLogger(DoomwatchExporter.class.getName());
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private final URI endpoint;
    private final int batchIntervalMs;
    private final int batchSize;
    private final int maxQueueCapacity;
    private final Duration requestTimeout;
    private final boolean debug;

    private final ConcurrentLinkedDeque<Span> queue = new ConcurrentLinkedDeque<>();
    private final HttpClient httpClient;
    private final AtomicBoolean isRunning = new AtomicBoolean(false);
    private final AtomicBoolean isFlushing = new AtomicBoolean(false);
    private ScheduledExecutorService scheduler;
    private long lastErrorLogTime = 0;

    public DoomwatchExporter(
            String collectorUrl,
            int batchIntervalMs,
            int batchSize,
            int maxQueueCapacity,
            int requestTimeoutSec,
            boolean debug
    ) {
        String raw = collectorUrl != null ? collectorUrl.replaceAll("/+$", "") : "http://localhost:4000";
        if (!raw.endsWith("/v1/traces")) {
            this.endpoint = URI.create(raw + "/v1/traces");
        } else {
            this.endpoint = URI.create(raw);
        }

        this.batchIntervalMs = Math.max(50, batchIntervalMs);
        this.batchSize = Math.max(1, batchSize);
        this.maxQueueCapacity = Math.max(1, maxQueueCapacity);
        this.requestTimeout = Duration.ofSeconds(Math.max(1, requestTimeoutSec));
        this.debug = debug;

        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(this.requestTimeout)
                .build();
    }

    public DoomwatchExporter(String collectorUrl) {
        this(collectorUrl, 1000, 50, 5000, 2, false);
    }

    public DoomwatchExporter() {
        this("http://localhost:4000");
    }

    public synchronized void start() {
        if (isRunning.compareAndSet(false, true)) {
            this.scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "doomwatch-exporter-worker");
                t.setDaemon(true);
                return t;
            });

            this.scheduler.scheduleWithFixedDelay(
                    this::flushBatch,
                    this.batchIntervalMs,
                    this.batchIntervalMs,
                    TimeUnit.MILLISECONDS
            );

            Runtime.getRuntime().addShutdownHook(new Thread(this::shutdown, "doomwatch-shutdown-hook"));
        }
    }

    public void enqueue(Span span) {
        if (span == null) return;

        // Overload protection: drop oldest if over capacity
        while (queue.size() >= maxQueueCapacity) {
            queue.pollFirst();
        }

        queue.addLast(span);

        if (queue.size() >= batchSize && scheduler != null && !scheduler.isShutdown()) {
            scheduler.execute(this::flushBatch);
        }
    }

    public void flush() {
        int pending = queue.size();
        int processed = 0;

        while (processed < pending && !queue.isEmpty()) {
            List<Span> batch = pollBatch();
            if (batch.isEmpty()) {
                break;
            }
            processed += batch.size();
            boolean success = sendBatch(batch);
            if (!success) {
                // If collector is unreachable, don't spin in retry loop
                break;
            }
        }
    }

    public synchronized void shutdown() {
        if (isRunning.compareAndSet(true, false)) {
            if (scheduler != null) {
                scheduler.shutdown();
                try {
                    if (!scheduler.awaitTermination(500, TimeUnit.MILLISECONDS)) {
                        scheduler.shutdownNow();
                    }
                } catch (InterruptedException e) {
                    scheduler.shutdownNow();
                    Thread.currentThread().interrupt();
                }
            }
            flush();
        }
    }

    private void flushBatch() {
        if (!isFlushing.compareAndSet(false, true)) {
            return;
        }
        try {
            while (!queue.isEmpty()) {
                List<Span> batch = pollBatch();
                if (batch.isEmpty()) {
                    break;
                }
                boolean success = sendBatch(batch);
                if (!success) {
                    break;
                }
            }
        } finally {
            isFlushing.set(false);
        }
    }

    private List<Span> pollBatch() {
        List<Span> batch = new ArrayList<>(batchSize);
        while (batch.size() < batchSize) {
            Span span = queue.pollFirst();
            if (span == null) {
                break;
            }
            batch.add(span);
        }
        return batch;
    }

    private boolean sendBatch(List<Span> batch) {
        try {
            Map<String, Object> payload = Map.of("spans", batch);
            byte[] body = OBJECT_MAPPER.writeValueAsBytes(payload);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(endpoint)
                    .timeout(requestTimeout)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (debug) {
                LOGGER.info(String.format("[Doomwatch Exporter] Exported %d spans (HTTP %d)",
                        batch.size(), response.statusCode()));
            }
            return true;
        } catch (Exception e) {
            long now = System.currentTimeMillis();
            if (debug || (now - lastErrorLogTime > 10000)) {
                LOGGER.log(Level.WARNING, String.format(
                        "[Doomwatch Exporter] Failed to export %d spans to %s: %s",
                        batch.size(), endpoint, e.getMessage()));
                lastErrorLogTime = now;
            }

            // Re-queue spans if capacity allows (fail-open)
            int remainingSpace = maxQueueCapacity - queue.size();
            if (remainingSpace > 0) {
                int toRequeue = Math.min(batch.size(), remainingSpace);
                for (int i = toRequeue - 1; i >= 0; i--) {
                    queue.addFirst(batch.get(i));
                }
            }
            return false;
        }
    }

    public int getQueueSize() {
        return queue.size();
    }

    public URI getEndpoint() {
        return endpoint;
    }
}
