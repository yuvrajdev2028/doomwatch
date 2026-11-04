"""
WSGI Middleware & Flask Extension for Doomwatch
"""

import sys
import time
import traceback
from typing import Optional, List, Dict, Any, Callable

from ..types import Span, HttpData, SpanError
from ..w3c import (
    extract_or_generate_trace_context,
    format_traceparent,
    TraceContext
)
from ..context import run_in_trace_context
from ..exporter import DoomwatchExporter
from ..redact import redact_headers, sanitize_payload


class DoomwatchWSGIMiddleware:
    """
    Standard WSGI middleware for tracing incoming requests across Flask, Django, etc.
    """
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

    def __call__(self, environ: Dict[str, Any], start_response: Callable) -> Any:
        # Extract headers from WSGI environ (HTTP_* keys)
        incoming_headers: Dict[str, str] = {}
        for k, v in environ.items():
            if k.startswith("HTTP_"):
                header_name = k[5:].replace("_", "-").lower()
                incoming_headers[header_name] = str(v)
            elif k in ("CONTENT_TYPE", "CONTENT_LENGTH"):
                header_name = k.replace("_", "-").lower()
                incoming_headers[header_name] = str(v)

        trace_ctx = extract_or_generate_trace_context(incoming_headers)

        method = environ.get("REQUEST_METHOD", "GET").upper()
        path = environ.get("PATH_INFO", "/")
        query_string = environ.get("QUERY_STRING", "")
        full_url = f"{path}?{query_string}" if query_string else path

        start_time = int(time.time() * 1000)
        status_code = 500
        captured_headers: Dict[str, str] = {}
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

        def custom_start_response(status: str, response_headers: List[tuple], exc_info=None):
            nonlocal status_code
            try:
                status_code = int(status.split()[0])
            except Exception:
                status_code = 200

            for h_k, h_v in response_headers:
                captured_headers[str(h_k).lower()] = str(h_v)

            tp_header = format_traceparent(trace_ctx.trace_id, trace_ctx.span_id)
            response_headers.append(("traceparent", tp_header))
            response_headers.append(("x-tracing-id", trace_ctx.trace_id))

            return start_response(status, response_headers, exc_info)

        try:
            with run_in_trace_context(trace_ctx, span):
                response_iterable = self.app(environ, custom_start_response)
                return response_iterable
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
                span.http.response_headers = redact_headers(captured_headers)
            if error_info:
                span.error = error_info

            self.exporter.enqueue(span)


class DoomwatchFlask:
    """Flask extension wrapper for DoomwatchWSGIMiddleware."""
    def __init__(
        self,
        app: Any = None,
        service_name: Optional[str] = None,
        exporter: Optional[DoomwatchExporter] = None,
        **kwargs
    ):
        if app is not None:
            self.init_app(app, service_name=service_name, exporter=exporter, **kwargs)

    def init_app(
        self,
        app: Any,
        service_name: Optional[str] = None,
        exporter: Optional[DoomwatchExporter] = None,
        **kwargs
    ) -> None:
        from ..sdk import Doomwatch
        sdk = Doomwatch.get_instance()
        svc = service_name or (sdk.config.service_name if sdk else "flask-app")
        exp = exporter or (sdk.exporter if sdk else DoomwatchExporter())
        app.wsgi_app = DoomwatchWSGIMiddleware(
            app.wsgi_app,
            service_name=svc,
            exporter=exp,
            **kwargs
        )
