package io.doomwatch;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class DoomwatchConfig {

    private final String serviceName;
    private final String collectorUrl;
    private final String environment;
    private final int maxBodyBytes;
    private final int batchIntervalMs;
    private final int batchSize;
    private final int maxQueueCapacity;
    private final List<String> redactedKeys;
    private final boolean debug;

    private DoomwatchConfig(Builder builder) {
        this.serviceName = builder.serviceName;
        this.collectorUrl = builder.collectorUrl;
        this.environment = builder.environment;
        this.maxBodyBytes = builder.maxBodyBytes;
        this.batchIntervalMs = builder.batchIntervalMs;
        this.batchSize = builder.batchSize;
        this.maxQueueCapacity = builder.maxQueueCapacity;
        this.redactedKeys = Collections.unmodifiableList(builder.redactedKeys);
        this.debug = builder.debug;
    }

    public static Builder builder(String serviceName) {
        return new Builder(serviceName);
    }

    public String getServiceName() { return serviceName; }
    public String getCollectorUrl() { return collectorUrl; }
    public String getEnvironment() { return environment; }
    public int getMaxBodyBytes() { return maxBodyBytes; }
    public int getBatchIntervalMs() { return batchIntervalMs; }
    public int getBatchSize() { return batchSize; }
    public int getMaxQueueCapacity() { return maxQueueCapacity; }
    public List<String> getRedactedKeys() { return redactedKeys; }
    public boolean isDebug() { return debug; }

    public static class Builder {
        private final String serviceName;
        private String collectorUrl = System.getenv("DOOMWATCH_COLLECTOR_URL") != null
                ? System.getenv("DOOMWATCH_COLLECTOR_URL") : "http://localhost:4000";
        private String environment = System.getenv("ENV") != null
                ? System.getenv("ENV") : "development";
        private int maxBodyBytes = 4096;
        private int batchIntervalMs = 1000;
        private int batchSize = 50;
        private int maxQueueCapacity = 5000;
        private List<String> redactedKeys = new ArrayList<>();
        private boolean debug = false;

        public Builder(String serviceName) {
            this.serviceName = serviceName != null ? serviceName : "java-service";
        }

        public Builder collectorUrl(String collectorUrl) {
            if (collectorUrl != null) this.collectorUrl = collectorUrl;
            return this;
        }

        public Builder environment(String environment) {
            if (environment != null) this.environment = environment;
            return this;
        }

        public Builder maxBodyBytes(int maxBodyBytes) {
            this.maxBodyBytes = maxBodyBytes;
            return this;
        }

        public Builder batchIntervalMs(int batchIntervalMs) {
            this.batchIntervalMs = batchIntervalMs;
            return this;
        }

        public Builder batchSize(int batchSize) {
            this.batchSize = batchSize;
            return this;
        }

        public Builder maxQueueCapacity(int maxQueueCapacity) {
            this.maxQueueCapacity = maxQueueCapacity;
            return this;
        }

        public Builder addRedactedKey(String key) {
            if (key != null) this.redactedKeys.add(key);
            return this;
        }

        public Builder debug(boolean debug) {
            this.debug = debug;
            return this;
        }

        public DoomwatchConfig build() {
            return new DoomwatchConfig(this);
        }
    }
}
