package io.doomwatch;

import io.doomwatch.redact.Sanitizer;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class SanitizerTest {

    @Test
    void testRedactSensitiveKeys() {
        Map<String, Object> payload = Map.of(
                "user", "alice",
                "password", "secret123",
                "token", "bearer-token",
                "nested", Map.of(
                        "credit_card", "4111-2222-3333-4444",
                        "safe_field", 42
                )
        );

        @SuppressWarnings("unchecked")
        Map<String, Object> redacted = (Map<String, Object>) Sanitizer.redactData(payload, null, 0);

        assertEquals("alice", redacted.get("user"));
        assertEquals(Sanitizer.REDACTED_PLACEHOLDER, redacted.get("password"));
        assertEquals(Sanitizer.REDACTED_PLACEHOLDER, redacted.get("token"));

        @SuppressWarnings("unchecked")
        Map<String, Object> nested = (Map<String, Object>) redacted.get("nested");
        assertEquals(Sanitizer.REDACTED_PLACEHOLDER, nested.get("credit_card"));
        assertEquals(42, nested.get("safe_field"));
    }

    @Test
    void testRedactHeaders() {
        Map<String, Object> headers = Map.of(
                "Host", "api.example.com",
                "Authorization", "Bearer token-abc",
                "Cookie", "session=123",
                "X-Api-Key", "key-999"
        );

        Map<String, Object> redacted = Sanitizer.redactHeaders(headers);
        assertEquals("api.example.com", redacted.get("Host"));
        assertEquals(Sanitizer.REDACTED_PLACEHOLDER, redacted.get("Authorization"));
        assertEquals(Sanitizer.REDACTED_PLACEHOLDER, redacted.get("Cookie"));
        assertEquals(Sanitizer.REDACTED_PLACEHOLDER, redacted.get("X-Api-Key"));
    }

    @Test
    void testPayloadTruncation() {
        Map<String, Object> small = Map.of("status", "ok");
        Object sanitizedSmall = Sanitizer.sanitizePayload(small, 100, null);
        assertEquals(small, sanitizedSmall);

        String longStr = "x".repeat(300);
        Map<String, Object> large = Map.of("data", longStr);
        Object sanitizedLarge = Sanitizer.sanitizePayload(large, 50, null);

        assertTrue(sanitizedLarge instanceof Map<?, ?>);
        @SuppressWarnings("unchecked")
        Map<String, Object> truncated = (Map<String, Object>) sanitizedLarge;
        assertTrue((Boolean) truncated.get("_doomwatch_truncated"));
        assertNotNull(truncated.get("preview"));
        assertEquals(50, ((String) truncated.get("preview")).length());
    }
}
