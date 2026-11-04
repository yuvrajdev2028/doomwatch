"""
Main Doomwatch SDK Entrypoint for Python Applications.
"""

import os
import sys
import time
from contextlib import contextmanager
from typing import Optional, List, Dict, Any, Generator

from .types import DoomwatchConfig, Span, SpanKind, TraceContext, SpanError
from .w3c import generate_trace_id, generate_span_id
from .context import (
    get_active_trace_context,
    get_active_span,
    run_in_trace_context,
    set_active_trace_context,
    set_active_span
)
from .exporter import DoomwatchExporter
from .patch_http import patch_http_clients, unpatch_http_clients


class Doomwatch:
    _instance: Optional["Doomwatch"] = None

    def __init__(self, config: DoomwatchConfig):
        self.config = config
        self.exporter = DoomwatchExporter(
            collector_url=config.collector_url,
            batch_interval_ms=config.batch_interval_ms,
            batch_size=config.batch_size,
            debug=config.debug
        )
        self.exporter.start()

        if config.auto_patch_http:
            patch_http_clients(
                service_name=config.service_name,
                collector_url=config.collector_url,
                exporter=self.exporter,
                max_body_bytes=config.max_body_bytes,
                redacted_keys=config.redacted_keys
            )

        if config.debug:
            print(
                f"[Doomwatch SDK] Initialized for service '{config.service_name}' "
                f"-> {config.collector_url}"
            )

    @classmethod
    def init(
        cls,
        service_name: str,
        collector_url: Optional[str] = None,
        environment: Optional[str] = None,
        max_body_bytes: int = 4096,
        batch_interval_ms: int = 1000,
        batch_size: int = 50,
        redacted_keys: Optional[List[str]] = None,
        auto_patch_http: bool = True,
        debug: bool = False
    ) -> "Doomwatch":
        """
        Initializes the singleton Doomwatch SDK for this Python application.
        Call once at the entry point of your service.
        """
        if cls._instance is not None:
            return cls._instance

        effective_collector = (
            collector_url
            or os.environ.get("DOOMWATCH_COLLECTOR_URL")
            or "http://localhost:4000"
        )
        effective_env = (
            environment
            or os.environ.get("ENV")
            or os.environ.get("ENVIRONMENT")
            or "development"
        )

        config = DoomwatchConfig(
            service_name=service_name,
            collector_url=effective_collector,
            environment=effective_env,
            max_body_bytes=max_body_bytes,
            batch_interval_ms=batch_interval_ms,
            batch_size=batch_size,
            redacted_keys=redacted_keys or [],
            auto_patch_http=auto_patch_http,
            debug=debug
        )

        cls._instance = cls(config)
        return cls._instance

    @classmethod
    def get_instance(cls) -> Optional["Doomwatch"]:
        """Returns the active Doomwatch singleton instance, if initialized."""
        return cls._instance

    @classmethod
    def get_active_trace_context(cls) -> Optional[TraceContext]:
        """Returns the current ambient TraceContext."""
        return get_active_trace_context()

    @classmethod
    def get_active_span(cls) -> Optional[Span]:
        """Returns the current ambient Span."""
        return get_active_span()

    @classmethod
    @contextmanager
    def start_span(
        cls,
        name: str,
        span_kind: SpanKind = "INTERNAL",
        metadata: Optional[Dict[str, Any]] = None
    ) -> Generator[Span, None, None]:
        """
        Context manager to manually start and record an internal or custom span.
        """
        active_ctx = get_active_trace_context()
        active_parent_span = get_active_span()

        trace_id = active_ctx.trace_id if active_ctx else generate_trace_id()
        child_span_id = generate_span_id()
        parent_span_id = (
            active_parent_span.span_id
            if active_parent_span
            else (active_ctx.span_id if active_ctx else None)
        )

        instance = cls.get_instance()
        service_name = instance.config.service_name if instance else "unknown-service"
        runtime = f"python-{sys.version.split()[0]}"

        start_time = int(time.time() * 1000)
        span = Span(
            trace_id=trace_id,
            span_id=child_span_id,
            parent_span_id=parent_span_id,
            service_name=service_name,
            runtime=runtime,
            span_kind=span_kind,
            name=name,
            start_time_unix_ms=start_time,
            end_time_unix_ms=0,
            duration_ms=0,
            metadata=metadata
        )

        new_ctx = TraceContext(
            trace_id=trace_id,
            span_id=child_span_id,
            parent_span_id=parent_span_id,
            trace_flags=active_ctx.trace_flags if active_ctx else "01"
        )

        error_info: Optional[SpanError] = None
        try:
            with run_in_trace_context(new_ctx, span):
                yield span
        except Exception as exc:
            import traceback
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
            if error_info:
                span.error = error_info

            if instance and instance.exporter:
                instance.exporter.enqueue(span)

    @classmethod
    def flush(cls) -> None:
        """Flushes all queued spans synchronously."""
        if cls._instance and cls._instance.exporter:
            cls._instance.exporter.flush()

    @classmethod
    def shutdown(cls) -> None:
        """Shuts down the exporter and resets global state."""
        if cls._instance:
            if cls._instance.exporter:
                cls._instance.exporter.shutdown()
            unpatch_http_clients()
            cls._instance = None
