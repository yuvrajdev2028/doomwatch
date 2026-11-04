import asyncio
import unittest
from doomwatch.exporter import DoomwatchExporter
from doomwatch.middleware.asgi import DoomwatchASGIMiddleware
from doomwatch.middleware.wsgi import DoomwatchWSGIMiddleware
from doomwatch.context import get_active_trace_context


class TestMiddlewares(unittest.TestCase):
    def test_asgi_middleware(self):
        exporter = DoomwatchExporter(collector_url="http://localhost:4000")

        ambient_trace_id_in_handler = None

        async def dummy_app(scope, receive, send):
            nonlocal ambient_trace_id_in_handler
            ctx = get_active_trace_context()
            if ctx:
                ambient_trace_id_in_handler = ctx.trace_id

            await send({
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"content-type", b"application/json")]
            })
            await send({
                "type": "http.response.body",
                "body": b'{"status": "ok"}'
            })

        middleware = DoomwatchASGIMiddleware(
            dummy_app,
            service_name="payment-service",
            exporter=exporter
        )

        incoming_traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
        scope = {
            "type": "http",
            "method": "POST",
            "path": "/charge",
            "query_string": b"",
            "headers": [
                (b"traceparent", incoming_traceparent.encode("latin1")),
                (b"content-type", b"application/json")
            ]
        }

        sent_messages = []

        async def mock_receive():
            return {"type": "http.request", "body": b'{"amount": 100}'}

        async def mock_send(msg):
            sent_messages.append(msg)

        asyncio.run(middleware(scope, mock_receive, mock_send))

        # Check ambient context was active during handler execution
        self.assertEqual(ambient_trace_id_in_handler, "4bf92f3577b34da6a3ce929d0e0e4736")

        # Check response headers injected
        start_msg = next(m for m in sent_messages if m["type"] == "http.response.start")
        resp_headers = dict(start_msg["headers"])
        self.assertIn(b"traceparent", resp_headers)
        self.assertIn(b"x-tracing-id", resp_headers)
        self.assertEqual(
            resp_headers[b"x-tracing-id"].decode("latin1"),
            "4bf92f3577b34da6a3ce929d0e0e4736"
        )

        # Check SERVER span enqueued
        self.assertEqual(len(exporter._queue), 1)
        span = exporter._queue[0]
        self.assertEqual(span.span_kind, "SERVER")
        self.assertEqual(span.trace_id, "4bf92f3577b34da6a3ce929d0e0e4736")
        self.assertEqual(span.parent_span_id, "00f067aa0ba902b7")
        self.assertEqual(span.http.status_code, 200)
        self.assertEqual(span.service_name, "payment-service")

    def test_wsgi_middleware(self):
        exporter = DoomwatchExporter(collector_url="http://localhost:4000")

        def dummy_wsgi_app(environ, start_response):
            headers = [("Content-Type", "application/json")]
            start_response("201 Created", headers)
            return [b'{"created": true}']

        middleware = DoomwatchWSGIMiddleware(
            dummy_wsgi_app,
            service_name="order-service",
            exporter=exporter
        )

        environ = {
            "REQUEST_METHOD": "POST",
            "PATH_INFO": "/orders",
            "QUERY_STRING": "",
            "HTTP_TRACEPARENT": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            "CONTENT_TYPE": "application/json"
        }

        captured_status = None
        captured_headers = []

        def mock_start_response(status, response_headers, exc_info=None):
            nonlocal captured_status, captured_headers
            captured_status = status
            captured_headers.extend(response_headers)

        body = middleware(environ, mock_start_response)
        self.assertEqual(list(body), [b'{"created": true}'])
        self.assertEqual(captured_status, "201 Created")

        header_dict = dict(captured_headers)
        self.assertIn("traceparent", header_dict)
        self.assertIn("x-tracing-id", header_dict)
        self.assertEqual(header_dict["x-tracing-id"], "4bf92f3577b34da6a3ce929d0e0e4736")

        # Check SERVER span enqueued
        self.assertEqual(len(exporter._queue), 1)
        span = exporter._queue[0]
        self.assertEqual(span.span_kind, "SERVER")
        self.assertEqual(span.trace_id, "4bf92f3577b34da6a3ce929d0e0e4736")
        self.assertEqual(span.parent_span_id, "00f067aa0ba902b7")
        self.assertEqual(span.http.status_code, 201)
        self.assertEqual(span.service_name, "order-service")


if __name__ == "__main__":
    unittest.main()
