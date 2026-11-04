"""
ASGI Middleware for Doomwatch (FastAPI, Starlette, etc.)
"""

import sys
import time
import traceback
from typing import Optional, List, Dict, Any, Callable
from urllib.parse import parse_qs

from ..types import Span, HttpData, SpanError
from ..w3c import (
    extract_or_generate_trace_context,
    format_traceparent,
    TraceContext
)
from ..context import run_in_trace_context
from ..exporter import DoomwatchExporter
from ..redact import redact_headers, sanitize_payload


class DoomwatchASGIMiddleware:
    def __init__(
        self,
        app: Any,
        service_name: str,
        exporter: DoomwatchExporter,
        max_body_bytes: int = 4096,
        redacted_keys: Optional[List[str]] = None
    ):
        self.app = app
        self.service_name = service_name
        self.exporter = exporter
        self.max_body_bytes = max_body_bytes
        self.redacted_keys = redacted_keys
        self.runtime = f"python-{sys.version.split()[0]}"

    async def __call__(self, scope: Dict[str, Any], receive: Callable, send: Callable) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        # 1. Parse incoming HTTP headers
        raw_headers = scope.get("headers", [])
        incoming_headers: Dict[str, str] = {}
        for raw_k, raw_v in raw_headers:
            k = raw_k.decode("latin1").lower()
            v = raw_v.decode("latin1")
            incoming_headers[k] = v

        # 2. Extract incoming trace or create a fresh root context
        trace_ctx = extract_or_generate_trace_context(incoming_headers)

        method = scope.get("method", "GET").upper()
        path = scope.get("path", "/")
        query_string = scope.get("query_string", b"").decode("latin1")
        full_url = f"{path}?{query_string}" if query_string else path

        start_time = int(time.time() * 1000)
        status_code = 500
        response_headers: Dict[str, str] = {}
        response_body_chunks: List[bytes] = []
        response_bytes_captured = 0
        error_info: Optional[SpanError] = None

        span = Span(
            trace_id=trace_ctx.trace_id,
            span_id=trace_ctx.span_id,
            parent_span_id=trace_ctx.parent_span_id,
            service_name=self.service_name,
            runtime=self.runtime,
            span_kind="SERVER",
            name=f"{method} {path}",
            start_time_unix_ms=start_time,
            end_time_unix_ms=0,
            duration_ms=0,
            http=HttpData(
                method=method,
                url=full_url,
                route=path,
                request_headers=redact_headers(incoming_headers)
            )
        )

        async def send_wrapper(message: Dict[str, Any]) -> None:
            nonlocal status_code, response_bytes_captured
            msg_type = message.get("type")

            if msg_type == "http.response.start":
                status_code = message.get("status", 200)

                # Mutate headers to inject trace headers into response
                raw_resp_headers = list(message.get("headers", []))
                for raw_k, raw_v in raw_resp_headers:
                    response_headers[raw_k.decode("latin1").lower()] = raw_v.decode("latin1")

                tp_header = format_traceparent(trace_ctx.trace_id, trace_ctx.span_id)
                raw_resp_headers.append((b"traceparent", tp_header.encode("latin1")))
                raw_resp_headers.append((b"x-tracing-id", trace_ctx.trace_id.encode("latin1")))
                message["headers"] = raw_resp_headers

            elif msg_type == "http.response.body":
                body = message.get("body", b"")
                if body and response_bytes_captured < self.max_body_bytes:
                    response_body_chunks.append(body)
                    response_bytes_captured += len(body)

            await send(message)

        try:
            with run_in_trace_context(trace_ctx, span):
                await self.app(scope, receive, send_wrapper)
        except Exception as exc:
            error_info = SpanError(
                name=type(exc).__name__,
                message=str(exc),
                stack=traceback.format_exc()
            )
            raise
        finally:
            end_time = int(time.time() * 1000)
            span.end_time_unix_ms = end_time
            span.duration_ms = max(0, end_time - start_time)
            if span.http:
                span.http.status_code = status_code
                span.http.response_headers = redact_headers(response_headers)
                if response_body_chunks:
                    all_bytes = b"".join(response_body_chunks)
                    try:
                        decoded = all_bytes.decode("utf-8")
                        span.http.response_body = sanitize_payload(
                            decoded, self.max_body_bytes, self.redacted_keys
                        )
                    except Exception:
                        pass
            if error_info:
                span.error = error_info

            self.exporter.enqueue(span)
