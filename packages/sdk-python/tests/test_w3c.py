import unittest
import re
from doomwatch.w3c import (
    generate_trace_id,
    generate_span_id,
    format_traceparent,
    parse_traceparent,
    normalize_trace_id,
    extract_or_generate_trace_context,
    ALL_ZEROS_32,
    ALL_ZEROS_16
)


class TestW3CTraceContext(unittest.TestCase):
    def test_generate_trace_id(self):
        trace_id = generate_trace_id()
        self.assertEqual(len(trace_id), 32)
        self.assertTrue(bool(re.match(r"^[0-9a-f]{32}$", trace_id)))
        self.assertNotEqual(trace_id, ALL_ZEROS_32)

    def test_generate_span_id(self):
        span_id = generate_span_id()
        self.assertEqual(len(span_id), 16)
        self.assertTrue(bool(re.match(r"^[0-9a-f]{16}$", span_id)))
        self.assertNotEqual(span_id, ALL_ZEROS_16)

    def test_format_and_parse_traceparent(self):
        trace_id = "4bf92f3577b34da6a3ce929d0e0e4736"
        span_id = "00f067aa0ba902b7"
        header = format_traceparent(trace_id, span_id, sampled=True)
        self.assertEqual(header, f"00-{trace_id}-{span_id}-01")

        parsed = parse_traceparent(header)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.trace_id, trace_id)
        self.assertEqual(parsed.parent_span_id, span_id)
        self.assertEqual(len(parsed.span_id), 16)
        self.assertNotEqual(parsed.span_id, span_id)  # generates new span id
        self.assertEqual(parsed.trace_flags, "01")

    def test_reject_invalid_traceparent(self):
        # Empty or non-string
        self.assertIsNone(parse_traceparent(""))
        self.assertIsNone(parse_traceparent(None))

        # Invalid format
        self.assertIsNone(parse_traceparent("invalid-header"))

        # Version ff is forbidden
        self.assertIsNone(
            parse_traceparent("ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
        )

        # All zeros trace_id
        self.assertIsNone(
            parse_traceparent(f"00-{ALL_ZEROS_32}-00f067aa0ba902b7-01")
        )

        # All zeros parent_span_id
        self.assertIsNone(
            parse_traceparent(f"00-4bf92f3577b34da6a3ce929d0e0e4736-{ALL_ZEROS_16}-01")
        )

    def test_normalize_trace_id(self):
        # Valid 36-char UUID with hyphens
        raw_uuid = "123e4567-e89b-12d3-a456-426614174000"
        normalized = normalize_trace_id(raw_uuid)
        self.assertEqual(normalized, "123e4567e89b12d3a456426614174000")

        # Invalid or short string generates fresh 32-char hex
        fresh = normalize_trace_id("short-id")
        self.assertEqual(len(fresh), 32)
        self.assertTrue(bool(re.match(r"^[0-9a-f]{32}$", fresh)))

    def test_extract_or_generate_trace_context(self):
        # 1. From standard traceparent
        headers_w3c = {
            "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
        }
        ctx = extract_or_generate_trace_context(headers_w3c)
        self.assertEqual(ctx.trace_id, "4bf92f3577b34da6a3ce929d0e0e4736")
        self.assertEqual(ctx.parent_span_id, "00f067aa0ba902b7")

        # 2. From legacy x-tracing-id
        headers_legacy = {
            "x-tracing-id": "123e4567-e89b-12d3-a456-426614174000",
            "x-parent-id": "abcdef1234567890abcdef1234567890"
        }
        ctx_legacy = extract_or_generate_trace_context(headers_legacy)
        self.assertEqual(ctx_legacy.trace_id, "123e4567e89b12d3a456426614174000")
        self.assertEqual(ctx_legacy.parent_span_id, "abcdef1234567890")

        # 3. No headers -> fresh root trace context (never None, never blank)
        ctx_fresh = extract_or_generate_trace_context({})
        self.assertIsNotNone(ctx_fresh.trace_id)
        self.assertEqual(len(ctx_fresh.trace_id), 32)
        self.assertIsNone(ctx_fresh.parent_span_id)


if __name__ == "__main__":
    unittest.main()
