import asyncio
import unittest
from doomwatch.types import TraceContext, Span
from doomwatch.context import (
    get_active_trace_context,
    get_active_span,
    run_in_trace_context
)


class TestContextManagement(unittest.TestCase):
    def test_sync_context_propagation(self):
        self.assertIsNone(get_active_trace_context())
        self.assertIsNone(get_active_span())

        ctx = TraceContext(
            trace_id="4bf92f3577b34da6a3ce929d0e0e4736",
            span_id="00f067aa0ba902b7",
            parent_span_id=None
        )
        span = Span(
            trace_id=ctx.trace_id,
            span_id=ctx.span_id,
            parent_span_id=None,
            service_name="test-service",
            runtime="python-test",
            span_kind="SERVER",
            name="GET /test",
            start_time_unix_ms=1000,
            end_time_unix_ms=1050,
            duration_ms=50
        )

        with run_in_trace_context(ctx, span):
            self.assertEqual(get_active_trace_context(), ctx)
            self.assertEqual(get_active_span(), span)

            # Sub-function invocation retains context
            def nested():
                return get_active_trace_context().trace_id

            self.assertEqual(nested(), "4bf92f3577b34da6a3ce929d0e0e4736")

        # After exiting context manager, context is restored to None
        self.assertIsNone(get_active_trace_context())
        self.assertIsNone(get_active_span())

    def test_asyncio_context_propagation(self):
        ctx = TraceContext(
            trace_id="11112222333344445555666677778888",
            span_id="99990000aaaabbbb"
        )

        async def worker(task_id: int):
            await asyncio.sleep(0.01)
            active = get_active_trace_context()
            self.assertIsNotNone(active)
            return (task_id, active.trace_id)

        async def runner():
            with run_in_trace_context(ctx):
                res1, res2 = await asyncio.gather(worker(1), worker(2))
                self.assertEqual(res1, (1, "11112222333344445555666677778888"))
                self.assertEqual(res2, (2, "11112222333344445555666677778888"))

        asyncio.run(runner())


if __name__ == "__main__":
    unittest.main()
