import io
import unittest
import urllib.request
from doomwatch.types import TraceContext
from doomwatch.context import run_in_trace_context
from doomwatch.exporter import DoomwatchExporter
from doomwatch.patch_http import patch_http_clients, unpatch_http_clients


class MockHttpResponse:
    def __init__(self, status=200, body=b"OK"):
        self.status = status
        self.code = status
        self._body = io.BytesIO(body)

    def read(self, *args):
        return self._body.read(*args)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass


class TestPatchHttp(unittest.TestCase):
    def setUp(self):
        self.exporter = DoomwatchExporter(collector_url="http://localhost:4000")
        patch_http_clients(
            service_name="order-service",
            collector_url="http://localhost:4000",
            exporter=self.exporter
        )

    def tearDown(self):
        unpatch_http_clients()

    def test_outbound_http_header_injection_and_client_span(self):
        captured_req = None
        orig_mock_fn = None

        # Replace internal urlopen with a mock responder
        def mock_urlopen(req, *args, **kwargs):
            nonlocal captured_req
            captured_req = req
            return MockHttpResponse(status=200, body=b'{"charged": true}')

        import doomwatch.patch_http as ph
        orig_mock_fn = ph._ORIGINAL_URLOPEN
        ph._ORIGINAL_URLOPEN = mock_urlopen

        try:
            active_ctx = TraceContext(
                trace_id="4bf92f3577b34da6a3ce929d0e0e4736",
                span_id="00f067aa0ba902b7"
            )

            with run_in_trace_context(active_ctx):
                req = urllib.request.Request("http://payment-service:8080/charge", method="POST")
                resp = urllib.request.urlopen(req)

            self.assertIsNotNone(captured_req)
            headers_lower = {k.lower(): v for k, v in captured_req.headers.items()}
            self.assertIn("traceparent", headers_lower)
            self.assertIn("x-tracing-id", headers_lower)
            self.assertEqual(
                headers_lower["x-tracing-id"],
                "4bf92f3577b34da6a3ce929d0e0e4736"
            )

            # Check that CLIENT span was enqueued
            self.assertEqual(len(self.exporter._queue), 1)
            span = self.exporter._queue[0]
            self.assertEqual(span.span_kind, "CLIENT")
            self.assertEqual(span.trace_id, "4bf92f3577b34da6a3ce929d0e0e4736")
            self.assertEqual(span.parent_span_id, "00f067aa0ba902b7")
            self.assertEqual(span.http.status_code, 200)
            self.assertEqual(span.service_name, "order-service")

        finally:
            ph._ORIGINAL_URLOPEN = orig_mock_fn


if __name__ == "__main__":
    unittest.main()
