import unittest
from doomwatch.sdk import Doomwatch
from doomwatch.context import get_active_trace_context, get_active_span


class TestDoomwatchSDK(unittest.TestCase):
    def tearDown(self):
        Doomwatch.shutdown()

    def test_sdk_init_and_singleton(self):
        sdk1 = Doomwatch.init(
            service_name="payment-service",
            collector_url="http://localhost:4000",
            auto_patch_http=False
        )
        sdk2 = Doomwatch.init(
            service_name="different-name",
            collector_url="http://localhost:4000",
            auto_patch_http=False
        )
        self.assertIs(sdk1, sdk2)
        self.assertEqual(Doomwatch.get_instance().config.service_name, "payment-service")

    def test_start_span_context_manager(self):
        sdk = Doomwatch.init(
            service_name="checkout-service",
            collector_url="http://localhost:4000",
            auto_patch_http=False
        )

        with Doomwatch.start_span("calculate_total", metadata={"items": 3}) as span:
            self.assertEqual(span.name, "calculate_total")
            self.assertEqual(span.service_name, "checkout-service")
            self.assertEqual(span.span_kind, "INTERNAL")
            self.assertEqual(span.metadata, {"items": 3})
            self.assertIsNotNone(span.trace_id)
            self.assertIsNotNone(span.span_id)

            # Ambient context check
            active_ctx = Doomwatch.get_active_trace_context()
            self.assertIsNotNone(active_ctx)
            self.assertEqual(active_ctx.trace_id, span.trace_id)
            self.assertEqual(active_ctx.span_id, span.span_id)

            # Nested span should have parent_span_id set to parent span's span_id
            with Doomwatch.start_span("db_lookup") as child_span:
                self.assertEqual(child_span.trace_id, span.trace_id)
                self.assertEqual(child_span.parent_span_id, span.span_id)

        # Ambient context cleared after exiting outer span
        self.assertIsNone(Doomwatch.get_active_trace_context())
        self.assertIsNone(Doomwatch.get_active_span())

        # Check spans were enqueued
        self.assertEqual(len(sdk.exporter._queue), 2)
        # child_span was enqueued first upon exit
        self.assertEqual(sdk.exporter._queue[0].name, "db_lookup")
        self.assertEqual(sdk.exporter._queue[1].name, "calculate_total")


if __name__ == "__main__":
    unittest.main()
