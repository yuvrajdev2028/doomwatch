"""
Doomwatch SDK for Python - Unified Observability & Distributed Tracing
"""

from .types import (
    Span,
    SpanKind,
    HttpData,
    SpanError,
    TraceContext,
    DoomwatchConfig
)
from .w3c import (
    generate_trace_id,
    generate_span_id,
    format_traceparent,
    parse_traceparent,
    normalize_trace_id,
    extract_or_generate_trace_context
)
from .context import (
    get_active_trace_context,
    get_active_span,
    run_in_trace_context,
    set_active_trace_context,
    set_active_span
)
from .redact import (
    redact_data,
    redact_headers,
    sanitize_payload
)
from .exporter import DoomwatchExporter
from .middleware import (
    DoomwatchASGIMiddleware,
    DoomwatchWSGIMiddleware,
    DoomwatchFlask
)
from .patch_http import patch_http_clients, unpatch_http_clients
from .sdk import Doomwatch

__all__ = [
    "Doomwatch",
    "Span",
    "SpanKind",
    "HttpData",
    "SpanError",
    "TraceContext",
    "DoomwatchConfig",
    "DoomwatchExporter",
    "DoomwatchASGIMiddleware",
    "DoomwatchWSGIMiddleware",
    "DoomwatchFlask",
    "generate_trace_id",
    "generate_span_id",
    "format_traceparent",
    "parse_traceparent",
    "normalize_trace_id",
    "extract_or_generate_trace_context",
    "get_active_trace_context",
    "get_active_span",
    "run_in_trace_context",
    "set_active_trace_context",
    "set_active_span",
    "redact_data",
    "redact_headers",
    "sanitize_payload",
    "patch_http_clients",
    "unpatch_http_clients",
]
