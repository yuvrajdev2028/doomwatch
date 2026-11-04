import unittest
from doomwatch.redact import (
    redact_data,
    redact_headers,
    sanitize_payload,
    REDACTED_PLACEHOLDER
)


class TestRedactAndSanitize(unittest.TestCase):
    def test_redact_sensitive_keys(self):
        payload = {
            "user": "alice",
            "password": "secret_password_123",
            "api_key": "xyz-999",
            "nested": {
                "token": "bearer-abc",
                "safe_field": 42,
                "list_data": [
                    {"credit_card": "4111-2222-3333-4444", "name": "Item"}
                ]
            }
        }
        redacted = redact_data(payload)
        self.assertEqual(redacted["user"], "alice")
        self.assertEqual(redacted["password"], REDACTED_PLACEHOLDER)
        self.assertEqual(redacted["api_key"], REDACTED_PLACEHOLDER)
        self.assertEqual(redacted["nested"]["token"], REDACTED_PLACEHOLDER)
        self.assertEqual(redacted["nested"]["safe_field"], 42)
        self.assertEqual(
            redacted["nested"]["list_data"][0]["credit_card"], REDACTED_PLACEHOLDER
        )
        self.assertEqual(redacted["nested"]["list_data"][0]["name"], "Item")

    def test_redact_headers(self):
        headers = {
            "Host": "api.example.com",
            "Authorization": "Bearer super-secret-token",
            "Cookie": "session_id=abcdef123456",
            "X-Custom-Secret": "my-secret",
            "Content-Type": "application/json"
        }
        redacted = redact_headers(headers)
        self.assertEqual(redacted["Host"], "api.example.com")
        self.assertEqual(redacted["Authorization"], REDACTED_PLACEHOLDER)
        self.assertEqual(redacted["Cookie"], REDACTED_PLACEHOLDER)
        self.assertEqual(redacted["X-Custom-Secret"], REDACTED_PLACEHOLDER)
        self.assertEqual(redacted["Content-Type"], "application/json")

    def test_sanitize_payload_truncation(self):
        small_payload = {"status": "ok", "message": "all good"}
        sanitized_small = sanitize_payload(small_payload, max_bytes=100)
        self.assertEqual(sanitized_small, small_payload)

        large_payload = {"data": "x" * 200}
        sanitized_large = sanitize_payload(large_payload, max_bytes=50)
        self.assertIsInstance(sanitized_large, dict)
        self.assertTrue(sanitized_large.get("_doomwatch_truncated"))
        self.assertIn("preview", sanitized_large)
        self.assertEqual(len(sanitized_large["preview"]), 50)


if __name__ == "__main__":
    unittest.main()
