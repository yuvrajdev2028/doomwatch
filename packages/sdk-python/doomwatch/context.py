"""
Ambient Context Management using Python contextvars.
Preserves ambient trace context across asynchronous execution chains,
asyncio tasks, and callbacks without requiring manual argument passing.
"""

from contextvars import ContextVar
from contextlib import contextmanager
from typing import Optional, Generator
from .types import TraceContext, Span

_CURRENT_TRACE_CONTEXT: ContextVar[Optional[TraceContext]] = ContextVar(
    "doomwatch_trace_context", default=None
)
_CURRENT_SPAN: ContextVar[Optional[Span]] = ContextVar(
    "doomwatch_active_span", default=None
)


def get_active_trace_context() -> Optional[TraceContext]:
    """Retrieves the active TraceContext from ambient context."""
    return _CURRENT_TRACE_CONTEXT.get()


def set_active_trace_context(ctx: Optional[TraceContext]) -> None:
    """Sets the active TraceContext in ambient context."""
    _CURRENT_TRACE_CONTEXT.set(ctx)


def get_active_span() -> Optional[Span]:
    """Retrieves the currently executing Span from ambient context."""
    return _CURRENT_SPAN.get()


def set_active_span(span: Optional[Span]) -> None:
    """Sets the currently executing Span in ambient context."""
    _CURRENT_SPAN.set(span)


@contextmanager
def run_in_trace_context(
    trace_ctx: Optional[TraceContext],
    span: Optional[Span] = None
) -> Generator[None, None, None]:
    """
    Context manager that binds a TraceContext and Span to the current async/thread context.
    Automatically resets when exiting the context block.
    """
    token_ctx = _CURRENT_TRACE_CONTEXT.set(trace_ctx)
    token_span = _CURRENT_SPAN.set(span)
    try:
        yield
    finally:
        _CURRENT_TRACE_CONTEXT.reset(token_ctx)
        _CURRENT_SPAN.reset(token_span)
