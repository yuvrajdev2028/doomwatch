import http.server
import json
import threading
import unittest
from doomwatch.types import Span, TraceContext, HttpData
from doomwatch.exporter import DoomwatchExporter


class MockCollectorHandler(http.server.BaseHTTPRequestHandler):
    received_payloads = []

    def do_POST(self):
        if self.path == "/v1/traces":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode("utf-8"))
            self.received_payloads.append(data)
            self.send_response(202)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"accepted": 1, "pending": 0}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Suppress logging output during tests
        pass


class TestE2ECollectorIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        MockCollectorHandler.received_payloads = []
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), MockCollectorHandler)
        cls.port = cls.server.server_port
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_exporter_transmits_valid_spans_to_collector(self):
        exporter = DoomwatchExporter(
            collector_url=f"http://127.0.0.1:{self.port}",
            batch_interval_ms=50,
            batch_size=2
        )
        exporter.start()

        span1 = Span(
            trace_id="4bf92f3577b34da6a3ce929d0e0e4736",
            span_id="00f067aa0ba902b7",
            parent_span_id=None,
            service_name="python-order-service",
            runtime="python-3.12",
            span_kind="SERVER",
            name="POST /orders",
            start_time_unix_ms=1700000000000,
            end_time_unix_ms=1700000000050,
            duration_ms=50,
            http=HttpData(
                method="POST",
                url="http://127.0.0.1:8000/orders",
                route="/orders",
                status_code=201
            )
        )

        span2 = Span(
            trace_id="4bf92f3577b34da6a3ce929d0e0e4736",
            span_id="11a122b233c344d4",
            parent_span_id="00f067aa0ba902b7",
            service_name="python-order-service",
            runtime="python-3.12",
            span_kind="CLIENT",
            name="POST /charge",
            start_time_unix_ms=1700000000010,
            end_time_unix_ms=1700000000040,
            duration_ms=30,
            http=HttpData(
                method="POST",
                url="http://payment-service:3002/charge",
                route="/charge",
                status_code=200
            )
        )

        exporter.enqueue(span1)
        exporter.enqueue(span2)

        exporter.flush()
        exporter.shutdown()

        self.assertGreaterEqual(len(MockCollectorHandler.received_payloads), 1)
        batch = MockCollectorHandler.received_payloads[0]
        self.assertIn("spans", batch)
        spans = batch["spans"]
        self.assertEqual(len(spans), 2)

        # Verify DAG causality
        self.assertEqual(spans[0]["trace_id"], "4bf92f3577b34da6a3ce929d0e0e4736")
        self.assertEqual(spans[0]["span_id"], "00f067aa0ba902b7")
        self.assertIsNone(spans[0]["parent_span_id"])

        self.assertEqual(spans[1]["trace_id"], "4bf92f3577b34da6a3ce929d0e0e4736")
        self.assertEqual(spans[1]["span_id"], "11a122b233c344d4")
        self.assertEqual(spans[1]["parent_span_id"], "00f067aa0ba902b7")


if __name__ == "__main__":
    unittest.main()
