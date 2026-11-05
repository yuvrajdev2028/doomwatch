package io.doomwatch.redact;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;

public final class Sanitizer {

    public static final String REDACTED_PLACEHOLDER = "[REDACTED]";
    public static final int DEFAULT_MAX_BODY_BYTES = 4096;

    private static final Set<String> DEFAULT_SENSITIVE_KEYS = Set.of(
            "password",
            "passwd",
            "secret",
            "token",
            "accesstoken",
            "access_token",
            "refreshtoken",
            "refresh_token",
            "authorization",
            "auth",
            "cookie",
            "setcookie",
            "apikey",
            "api_key",
            "xapikey",
            "privatekey",
            "private_key",
            "creditcard",
            "credit_card",
            "cardnumber",
            "card_number",
            "cvv",
            "cvc",
            "ssn"
    );

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private Sanitizer() {}

    public static boolean isSensitiveKey(String key, List<String> customKeys) {
        if (key == null) return false;
        String normalized = key.toLowerCase().replace("-", "").replace("_", "");
        if (DEFAULT_SENSITIVE_KEYS.contains(normalized)) {
            return true;
        }
        if (customKeys != null) {
            for (String custom : customKeys) {
                if (normalized.equals(custom.toLowerCase().replace("-", "").replace("_", ""))) {
                    return true;
                }
            }
        }
        return false;
    }

    public static Object redactData(Object data, List<String> customKeys, int depth) {
        if (data == null || depth > 8) {
            return data;
        }

        if (data instanceof Map<?, ?> map) {
            Map<String, Object> sanitized = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                String k = String.valueOf(entry.getKey());
                if (isSensitiveKey(k, customKeys)) {
                    sanitized.put(k, REDACTED_PLACEHOLDER);
                } else if (entry.getValue() instanceof Map<?, ?> || entry.getValue() instanceof Collection<?>) {
                    sanitized.put(k, redactData(entry.getValue(), customKeys, depth + 1));
                } else {
                    sanitized.put(k, entry.getValue());
                }
            }
            return sanitized;
        }

        if (data instanceof Collection<?> collection) {
            List<Object> sanitized = new ArrayList<>(collection.size());
            for (Object item : collection) {
                sanitized.add(redactData(item, customKeys, depth + 1));
            }
            return sanitized;
        }

        return data;
    }

    public static Map<String, Object> redactHeaders(Map<String, ?> headers) {
        if (headers == null) {
            return null;
        }
        Map<String, Object> sanitized = new LinkedHashMap<>();
        for (Map.Entry<String, ?> entry : headers.entrySet()) {
            String key = entry.getKey();
            String lower = key.toLowerCase();
            if (lower.equals("authorization")
                    || lower.equals("cookie")
                    || lower.equals("set-cookie")
                    || lower.equals("proxy-authorization")
                    || lower.contains("token")
                    || lower.contains("secret")
                    || lower.contains("key")) {
                sanitized.put(key, REDACTED_PLACEHOLDER);
            } else {
                sanitized.put(key, entry.getValue());
            }
        }
        return sanitized;
    }

    public static Object sanitizePayload(Object payload, int maxBytes, List<String> customKeys) {
        if (payload == null) {
            return null;
        }

        Object redacted = redactData(payload, customKeys, 0);

        try {
            String serialized;
            if (redacted instanceof String str) {
                serialized = str;
            } else if (redacted instanceof byte[] bytes) {
                serialized = new String(bytes);
            } else {
                serialized = OBJECT_MAPPER.writeValueAsString(redacted);
            }

            if (serialized.length() > maxBytes) {
                Map<String, Object> truncated = new LinkedHashMap<>();
                truncated.put("_doomwatch_truncated", true);
                truncated.put("preview", serialized.substring(0, maxBytes));
                truncated.put("original_bytes", serialized.length());
                truncated.put("message", String.format(
                        "Payload truncated because size (%d bytes) exceeded maximum limit (%d bytes)",
                        serialized.length(), maxBytes));
                return truncated;
            }
            return redacted;
        } catch (Exception e) {
            return "[Unserializable Payload]";
        }
    }
}
