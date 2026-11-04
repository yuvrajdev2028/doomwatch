"""
Auto-patching for outgoing HTTP clients in Python.
Automatically injects W3C traceparent and legacy x-tracing-id headers
and records CLIENT spans.
"""

import sys
import time
import traceback
from typing import Optional, List
from urllib.parse import urlparse
import urllib.request

from .types import Span, HttpData, SpanError
from .w3c import (
    generate_trace_id,
    generate_span_id,
    format_traceparent,
    parse_traceparent
)
from .context import get_active_trace_context, get_active_span
from .exporter import DoomwatchExporter
from .redact import redact_headers, sanitize_payload

_IS_PATCHED = False
_ORIGINAL_URLOPEN = None
_ORIGINAL_REQUESTS_SEND = None
_ORIGINAL_HTTPX_SEND = None
_ORIGINAL_HTTPX_ASYNC_SEND = None


def patch_http_clients(
    service_name: str,
    collector_url: str,
    exporter: DoomwatchExporter,
    max_body_bytes: int = 4096,
    redacted_keys: Optional[List[str]] = None
) -> None:
    """
    Patches urllib.request, requests, and httpx to automatically inject
    trace headers and record CLIENT spans.
    """
    global _IS_PATCHED, _ORIGINAL_URLOPEN, _ORIGINAL_REQUESTS_SEND
    global _ORIGINAL_HTTPX_SEND, _ORIGINAL_HTTPX_ASYNC_SEND

    if _IS_PATCHED:
        return
    _IS_PATCHED = True

    collector_parsed = urlparse(collector_url)
    collector_host = collector_parsed.netloc or collector_parsed.path
    runtime = f"python-{sys.version.split()[0]}"

    def _should_skip(url: str) -> bool:
        if not url:
            return True
        if "/v1/traces" in url or "/v1/telemetry" in url:
            return True
        parsed = urlparse(url)
        if collector_host and parsed.netloc and collector_host in parsed.netloc:
            return True
        return False

    # -------------------------------------------------------------
    # 1. Patch urllib.request.urlopen (Standard Library)
    # -------------------------------------------------------------
    _ORIGINAL_URLOPEN = urllib.request.urlopen

    def patched_urlopen(url_or_req, *args, **kwargs):
        if isinstance(url_or_req, urllib.request.Request):
            raw_url = url_or_req.full_url
            method = url_or_req.get_method()
            headers = dict(url_or_req.headers)
            body = url_or_req.data
        else:
            raw_url = str(url_or_req)
            method = kwargs.get("method") or "GET"
            headers = kwargs.get("headers") or {}
            body = kwargs.get("data")

        if _should_skip(raw_url):
            return _ORIGINAL_URLOPEN(url_or_req, *args, **kwargs)

        active_ctx = get_active_trace_context()
        active_span = get_active_span()

        trace_id = active_ctx.trace_id if active_ctx else generate_trace_id()
        child_span_id = generate_span_id()
        parent_span_id = active_span.span_id if active_span else (active_ctx.span_id if active_ctx else None)

        tp_header = format_traceparent(trace_id, child_span_id)

        # Inject headers into request
        if isinstance(url_or_req, urllib.request.Request):
            existing_headers_lower = {k.lower() for k in url_or_req.headers.keys()}
            if "traceparent" not in existing_headers_lower:
                url_or_req.add_header("traceparent", tp_header)
            if "x-tracing-id" not in existing_headers_lower:
                url_or_req.add_header("x-tracing-id", trace_id)
        else:
            headers = dict(headers)
            headers.setdefault("traceparent", tp_header)
            headers.setdefault("x-tracing-id", trace_id)
            kwargs["headers"] = headers

        start_time = int(time.time() * 1000)
        status_code = None
        error_info: Optional[SpanError] = None

        try:
            resp = _ORIGINAL_URLOPEN(url_or_req, *args, **kwargs)
            status_code = getattr(resp, "status", getattr(resp, "code", 200))
            return resp
        except urllib.error.HTTPError as http_err:
            status_code = http_err.code
            error_info = SpanError(
                name="HTTPError",
                message=str(http_err),
                stack=traceback.format_exc()
            )
            raise
        except Exception as exc:
            error_info = SpanError(
                name=type(exc).__name__,
                message=str(exc),
                stack=traceback.format_exc()
            )
            raise
        finally:
            end_time = int(time.time() * 1000)
            client_span = Span(
                trace_id=trace_id,
                span_id=child_span_id,
                parent_span_id=parent_span_id,
                service_name=service_name,
                runtime=runtime,
                span_kind="CLIENT",
                name=f"{method.upper()} {urlparse(raw_url).path or '/'}",
                start_time_unix_ms=start_time,
                end_time_unix_ms=end_time,
                duration_ms=max(0, end_time - start_time),
                http=HttpData(
                    method=method.upper(),
                    url=raw_url,
                    route=urlparse(raw_url).path or "/",
                    status_code=status_code,
                    request_headers=redact_headers(headers),
                    request_body=sanitize_payload(body, max_body_bytes, redacted_keys)
                ),
                error=error_info
            )
            exporter.enqueue(client_span)

    urllib.request.urlopen = patched_urlopen

    # -------------------------------------------------------------
    # 2. Patch requests.Session.send (if requests is installed)
    # -------------------------------------------------------------
    try:
        import requests.sessions
        _ORIGINAL_REQUESTS_SEND = requests.sessions.Session.send

        def patched_requests_send(session, request, *args, **kwargs):
            raw_url = request.url
            if _should_skip(raw_url):
                return _ORIGINAL_REQUESTS_SEND(session, request, *args, **kwargs)

            active_ctx = get_active_trace_context()
            active_span = get_active_span()

            trace_id = active_ctx.trace_id if active_ctx else generate_trace_id()
            child_span_id = generate_span_id()
            parent_span_id = active_span.span_id if active_span else (active_ctx.span_id if active_ctx else None)

            tp_header = format_traceparent(trace_id, child_span_id)

            if "traceparent" not in request.headers:
                request.headers["traceparent"] = tp_header
            if "x-tracing-id" not in request.headers:
                request.headers["x-tracing-id"] = trace_id

            start_time = int(time.time() * 1000)
            status_code = None
            error_info: Optional[SpanError] = None

            try:
                resp = _ORIGINAL_REQUESTS_SEND(session, request, *args, **kwargs)
                status_code = resp.status_code
                return resp
            except Exception as exc:
                error_info = SpanError(
                    name=type(exc).__name__,
                    message=str(exc),
                    stack=traceback.format_exc()
                )
                raise
            finally:
                end_time = int(time.time() * 1000)
                client_span = Span(
                    trace_id=trace_id,
                    span_id=child_span_id,
                    parent_span_id=parent_span_id,
                    service_name=service_name,
                    runtime=runtime,
                    span_kind="CLIENT",
                    name=f"{request.method.upper()} {urlparse(raw_url).path or '/'}",
                    start_time_unix_ms=start_time,
                    end_time_unix_ms=end_time,
                    duration_ms=max(0, end_time - start_time),
                    http=HttpData(
                        method=request.method.upper(),
                        url=raw_url,
                        route=urlparse(raw_url).path or "/",
                        status_code=status_code,
                        request_headers=redact_headers(dict(request.headers)),
                        request_body=sanitize_payload(request.body, max_body_bytes, redacted_keys)
                    ),
                    error=error_info
                )
                exporter.enqueue(client_span)

        requests.sessions.Session.send = patched_requests_send
    except ImportError:
        pass

    # -------------------------------------------------------------
    # 3. Patch httpx.Client.send & httpx.AsyncClient.send (if installed)
    # -------------------------------------------------------------
    try:
        import httpx
        _ORIGINAL_HTTPX_SEND = httpx.Client.send

        def patched_httpx_send(client, request, *args, **kwargs):
            raw_url = str(request.url)
            if _should_skip(raw_url):
                return _ORIGINAL_HTTPX_SEND(client, request, *args, **kwargs)

            active_ctx = get_active_trace_context()
            active_span = get_active_span()

            trace_id = active_ctx.trace_id if active_ctx else generate_trace_id()
            child_span_id = generate_span_id()
            parent_span_id = active_span.span_id if active_span else (active_ctx.span_id if active_ctx else None)

            tp_header = format_traceparent(trace_id, child_span_id)

            if "traceparent" not in request.headers:
                request.headers["traceparent"] = tp_header
            if "x-tracing-id" not in request.headers:
                request.headers["x-tracing-id"] = trace_id

            start_time = int(time.time() * 1000)
            status_code = None
            error_info: Optional[SpanError] = None

            try:
                resp = _ORIGINAL_HTTPX_SEND(client, request, *args, **kwargs)
                status_code = resp.status_code
                return resp
            except Exception as exc:
                error_info = SpanError(
                    name=type(exc).__name__,
                    message=str(exc),
                    stack=traceback.format_exc()
                )
                raise
            finally:
                end_time = int(time.time() * 1000)
                client_span = Span(
                    trace_id=trace_id,
                    span_id=child_span_id,
                    parent_span_id=parent_span_id,
                    service_name=service_name,
                    runtime=runtime,
                    span_kind="CLIENT",
                    name=f"{request.method.upper()} {urlparse(raw_url).path or '/'}",
                    start_time_unix_ms=start_time,
                    end_time_unix_ms=end_time,
                    duration_ms=max(0, end_time - start_time),
                    http=HttpData(
                        method=request.method.upper(),
                        url=raw_url,
                        route=urlparse(raw_url).path or "/",
                        status_code=status_code,
                        request_headers=redact_headers(dict(request.headers))
                    ),
                    error=error_info
                )
                exporter.enqueue(client_span)

        httpx.Client.send = patched_httpx_send
    except ImportError:
        pass


def unpatch_http_clients() -> None:
    """Restores original HTTP client implementations."""
    global _IS_PATCHED, _ORIGINAL_URLOPEN, _ORIGINAL_REQUESTS_SEND, _ORIGINAL_HTTPX_SEND
    if not _IS_PATCHED:
        return
    if _ORIGINAL_URLOPEN:
        urllib.request.urlopen = _ORIGINAL_URLOPEN
    try:
        import requests.sessions
        if _ORIGINAL_REQUESTS_SEND:
            requests.sessions.Session.send = _ORIGINAL_REQUESTS_SEND
    except ImportError:
        pass
    try:
        import httpx
        if _ORIGINAL_HTTPX_SEND:
            httpx.Client.send = _ORIGINAL_HTTPX_SEND
    except ImportError:
        pass
    _IS_PATCHED = False
