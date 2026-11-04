"""
Doomwatch Core Data Types & Telemetry Contracts for Python
"""

from dataclasses import dataclass, field, asdict
from typing import Dict, Any, Optional, Union, List, Literal

SpanKind = Literal['SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER', 'INTERNAL']


@dataclass
class HttpData:
    method: str
    url: str
    route: Optional[str] = None
    status_code: Optional[int] = None
    request_headers: Optional[Dict[str, Any]] = None
    request_body: Optional[Any] = None
    response_headers: Optional[Dict[str, Any]] = None
    response_body: Optional[Any] = None

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "method": self.method,
            "url": self.url
        }
        if self.route is not None:
            result["route"] = self.route
        if self.status_code is not None:
            result["status_code"] = self.status_code
        if self.request_headers is not None:
            result["request_headers"] = self.request_headers
        if self.request_body is not None:
            result["request_body"] = self.request_body
        if self.response_headers is not None:
            result["response_headers"] = self.response_headers
        if self.response_body is not None:
            result["response_body"] = self.response_body
        return result


@dataclass
class SpanError:
    name: str
    message: str
    stack: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "name": self.name,
            "message": self.message
        }
        if self.stack:
            result["stack"] = self.stack
        return result


@dataclass
class Span:
    trace_id: str                      # 32-character hexadecimal string (128-bit)
    span_id: str                       # 16-character hexadecimal string (64-bit)
    parent_span_id: Optional[str]      # 16-character hexadecimal string or None for root
    service_name: str                  # Originating service name (e.g., 'order-service')
    runtime: str                       # Environment/runtime (e.g., 'python-3.12')
    span_kind: SpanKind                # Type of span (SERVER, CLIENT, etc.)
    name: str                          # Descriptive name (e.g., 'POST /api/orders')
    start_time_unix_ms: int            # Start timestamp in milliseconds since epoch
    end_time_unix_ms: int              # End timestamp in milliseconds since epoch
    duration_ms: int                   # Duration in milliseconds (end - start)
    http: Optional[HttpData] = None    # HTTP-specific metadata
    error: Optional[SpanError] = None  # Error details if span failed
    metadata: Optional[Dict[str, Any]] = None # Custom tags or attributes

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "trace_id": self.trace_id,
            "span_id": self.span_id,
            "parent_span_id": self.parent_span_id,
            "service_name": self.service_name,
            "runtime": self.runtime,
            "span_kind": self.span_kind,
            "name": self.name,
            "start_time_unix_ms": self.start_time_unix_ms,
            "end_time_unix_ms": self.end_time_unix_ms,
            "duration_ms": self.duration_ms,
        }
        if self.http is not None:
            data["http"] = self.http.to_dict()
        if self.error is not None:
            data["error"] = self.error.to_dict()
        if self.metadata is not None:
            data["metadata"] = self.metadata
        return data


@dataclass
class TraceContext:
    trace_id: str
    span_id: str
    parent_span_id: Optional[str] = None
    trace_flags: str = "01"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "trace_id": self.trace_id,
            "span_id": self.span_id,
            "parent_span_id": self.parent_span_id,
            "trace_flags": self.trace_flags
        }


@dataclass
class DoomwatchConfig:
    service_name: str
    collector_url: str = "http://localhost:4000"
    environment: str = "development"
    max_body_bytes: int = 4096
    batch_interval_ms: int = 1000
    batch_size: int = 50
    redacted_keys: List[str] = field(default_factory=list)
    auto_patch_http: bool = True
    debug: bool = False
