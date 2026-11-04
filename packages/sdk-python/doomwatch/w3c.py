"""
W3C Trace Context (traceparent) Parsing, Formatting, and ID Generation
Complies with W3C Recommendation: https://www.w3.org/TR/trace-context/
"""

import re
import secrets
from typing import Dict, Any, Optional
from .types import TraceContext

TRACEPARENT_REGEX = re.compile(
    r"^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$",
    re.IGNORECASE
)
ALL_ZEROS_32 = "0" * 32
ALL_ZEROS_16 = "0" * 16


def generate_trace_id() -> str:
    """Generates a 128-bit (32 hex characters) trace ID."""
    trace_id = secrets.token_hex(16).lower()
    while trace_id == ALL_ZEROS_32:
        trace_id = secrets.token_hex(16).lower()
    return trace_id


def generate_span_id() -> str:
    """Generates a 64-bit (16 hex characters) span ID."""
    span_id = secrets.token_hex(8).lower()
    while span_id == ALL_ZEROS_16:
        span_id = secrets.token_hex(8).lower()
    return span_id


def format_traceparent(trace_id: str, span_id: str, sampled: bool = True) -> str:
    """
    Formats trace ID and span ID into a W3C traceparent header string.
    Example: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    """
    flags = "01" if sampled else "00"
    return f"00-{trace_id.lower()}-{span_id.lower()}-{flags}"


def parse_traceparent(header: Optional[str]) -> Optional[TraceContext]:
    """
    Parses a W3C traceparent header string into a TraceContext.
    Returns None if the header is invalid, unparseable, or all zeros.
    """
    if not header or not isinstance(header, str):
        return None

    header = header.strip()
    match = TRACEPARENT_REGEX.match(header)
    if not match:
        return None

    version, trace_id, parent_span_id, flags = match.groups()

    # Version 00 is supported. Version ff is forbidden by spec.
    if version.lower() == "ff":
        return None

    trace_id = trace_id.lower()
    parent_span_id = parent_span_id.lower()

    if trace_id == ALL_ZEROS_32 or parent_span_id == ALL_ZEROS_16:
        return None

    return TraceContext(
        trace_id=trace_id,
        span_id=generate_span_id(),
        parent_span_id=parent_span_id,
        trace_flags=flags
    )


def normalize_trace_id(raw_id: str) -> str:
    """
    Normalizes an incoming trace ID from legacy headers (e.g. UUIDs with or without dashes).
    Converts 36-char UUID to 32-char hex if valid, or generates a new trace ID.
    """
    clean = raw_id.replace("-", "").strip().lower()
    if len(clean) == 32 and re.match(r"^[0-9a-f]{32}$", clean) and clean != ALL_ZEROS_32:
        return clean
    return generate_trace_id()


def extract_or_generate_trace_context(
    headers: Optional[Dict[str, Any]] = None
) -> TraceContext:
    """
    Extracts or creates a TraceContext from incoming HTTP headers.

    Lookup Order:
    1. Standard W3C 'traceparent'
    2. Custom/Legacy 'x-tracing-id'
    3. Fallback 'x-request-id'
    4. Generates a fresh root trace context if no header is present (NEVER leaves blank!)
    """
    normalized_headers: Dict[str, str] = {}
    if headers:
        for k, v in headers.items():
            if v is not None:
                if isinstance(v, (list, tuple)) and len(v) > 0:
                    normalized_headers[k.lower()] = str(v[0])
                else:
                    normalized_headers[k.lower()] = str(v)

    # 1. Try W3C traceparent
    traceparent = normalized_headers.get("traceparent")
    if traceparent:
        parsed = parse_traceparent(traceparent)
        if parsed:
            return parsed

    # 2. Try legacy x-tracing-id or x-request-id
    legacy_trace_id = normalized_headers.get("x-tracing-id") or normalized_headers.get("x-request-id")
    if legacy_trace_id:
        trace_id = normalize_trace_id(legacy_trace_id)
        parent_span_id = normalized_headers.get("x-parent-id")
        return TraceContext(
            trace_id=trace_id,
            span_id=generate_span_id(),
            parent_span_id=normalize_trace_id(parent_span_id)[:16] if parent_span_id else None,
            trace_flags="01"
        )

    # 3. Fresh root trace context
    return TraceContext(
        trace_id=generate_trace_id(),
        span_id=generate_span_id(),
        parent_span_id=None,
        trace_flags="01"
    )
