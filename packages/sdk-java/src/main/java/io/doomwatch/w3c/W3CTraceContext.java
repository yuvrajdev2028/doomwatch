package io.doomwatch.w3c;

import io.doomwatch.model.TraceContext;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class W3CTraceContext {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final HexFormat HEX = HexFormat.of();
    private static final Pattern TRACEPARENT_PATTERN =
            Pattern.compile("^([0-9a-fA-F]{2})-([0-9a-fA-F]{32})-([0-9a-fA-F]{16})-([0-9a-fA-F]{2})$");

    public static final String ALL_ZEROS_32 = "00000000000000000000000000000000";
    public static final String ALL_ZEROS_16 = "0000000000000000";

    private W3CTraceContext() {}

    /**
     * Generates a 128-bit (32 hex characters) trace ID.
     */
    public static String generateTraceId() {
        byte[] bytes = new byte[16];
        String traceId;
        do {
            RANDOM.nextBytes(bytes);
            traceId = HEX.formatHex(bytes);
        } while (ALL_ZEROS_32.equals(traceId));
        return traceId;
    }

    /**
     * Generates a 64-bit (16 hex characters) span ID.
     */
    public static String generateSpanId() {
        byte[] bytes = new byte[8];
        String spanId;
        do {
            RANDOM.nextBytes(bytes);
            spanId = HEX.formatHex(bytes);
        } while (ALL_ZEROS_16.equals(spanId));
        return spanId;
    }

    /**
     * Formats trace ID and span ID into a W3C traceparent header string.
     */
    public static String formatTraceparent(String traceId, String spanId, boolean sampled) {
        String flags = sampled ? "01" : "00";
        return String.format("00-%s-%s-%s", traceId.toLowerCase(), spanId.toLowerCase(), flags);
    }

    public static String formatTraceparent(String traceId, String spanId) {
        return formatTraceparent(traceId, spanId, true);
    }

    /**
     * Parses a W3C traceparent header string into a TraceContext.
     * Returns null if the header is invalid, unparseable, or all zeros.
     */
    public static TraceContext parseTraceparent(String header) {
        if (header == null || header.isBlank()) {
            return null;
        }

        Matcher matcher = TRACEPARENT_PATTERN.matcher(header.trim());
        if (!matcher.matches()) {
            return null;
        }

        String version = matcher.group(1).toLowerCase();
        String traceId = matcher.group(2).toLowerCase();
        String parentSpanId = matcher.group(3).toLowerCase();
        String flags = matcher.group(4).toLowerCase();

        // Version ff is explicitly forbidden by W3C spec
        if ("ff".equals(version)) {
            return null;
        }

        // Trace ID and Span ID must not be all zeros
        if (ALL_ZEROS_32.equals(traceId) || ALL_ZEROS_16.equals(parentSpanId)) {
            return null;
        }

        return new TraceContext(traceId, generateSpanId(), parentSpanId, flags);
    }

    /**
     * Normalizes an incoming trace ID from legacy headers (e.g. UUIDs with or without hyphens).
     */
    public static String normalizeTraceId(String rawId) {
        if (rawId == null || rawId.isBlank()) {
            return generateTraceId();
        }
        String clean = rawId.replace("-", "").trim().toLowerCase();
        if (clean.length() == 32 && clean.matches("^[0-9a-f]{32}$") && !ALL_ZEROS_32.equals(clean)) {
            return clean;
        }
        return generateTraceId();
    }

    /**
     * Extracts or creates a TraceContext from incoming HTTP headers.
     * Lookup Order:
     * 1. Standard W3C 'traceparent'
     * 2. Custom/Legacy 'x-tracing-id'
     * 3. Fallback 'x-request-id'
     * 4. Generates a fresh root trace context (never blank)
     */
    public static TraceContext extractOrGenerateTraceContext(Map<String, ?> headers) {
        if (headers != null && !headers.isEmpty()) {
            String traceparent = findHeader(headers, "traceparent");
            if (traceparent != null) {
                TraceContext parsed = parseTraceparent(traceparent);
                if (parsed != null) {
                    return parsed;
                }
            }

            String legacyTraceId = findHeader(headers, "x-tracing-id");
            if (legacyTraceId == null) {
                legacyTraceId = findHeader(headers, "x-request-id");
            }

            if (legacyTraceId != null) {
                String traceId = normalizeTraceId(legacyTraceId);
                String parentSpanId = findHeader(headers, "x-parent-id");
                String normalizedParent = parentSpanId != null ? normalizeTraceId(parentSpanId).substring(0, 16) : null;
                return new TraceContext(traceId, generateSpanId(), normalizedParent, "01");
            }
        }

        // Fresh root trace context
        return new TraceContext(generateTraceId(), generateSpanId(), null, "01");
    }

    private static String findHeader(Map<String, ?> headers, String name) {
        for (Map.Entry<String, ?> entry : headers.entrySet()) {
            if (name.equalsIgnoreCase(entry.getKey())) {
                Object val = entry.getValue();
                if (val instanceof Iterable<?> iter) {
                    for (Object item : iter) {
                        return item != null ? item.toString() : null;
                    }
                } else if (val instanceof Object[] arr && arr.length > 0) {
                    return arr[0] != null ? arr[0].toString() : null;
                } else if (val != null) {
                    return val.toString();
                }
            }
        }
        return null;
    }
}
