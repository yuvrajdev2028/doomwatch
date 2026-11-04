import unittest
from doomwatch.types import Span
from doomwatch.exporter import DoomwatchExporter


class TestExporter(unittest.TestCase):
    def test_enqueue_and_capacity_limit(self):
        exporter = DoomwatchExporter(
            collector_url="http://localhost:4000",
            max_queue_capacity=5,
            batch_size=2
        )

        for i in range(10):
            span = Span(
                trace_id=f"trace_{i}".ljust(32, "0"),
                span_id=f"span_{i}".ljust(16, "0"),
                parent_span_id=None,
                service_name="test",
                runtime="python",
                span_kind="INTERNAL",
                name=f"task_{i}",
                start_time_unix_ms=1000,
                end_time_unix_ms=1010,
                duration_ms=10
            )
            exporter.enqueue(span)

        # Capacity limit should prevent unbound growth
        self.assertLessEqual(len(exporter._queue), 5)
        # Oldest spans (0-4) should have been popped; latest (5-9) retained
        first_in_queue = exporter._queue[0]
        self.assertTrue(first_in_queue.name.startswith("task_5"))

    def test_endpoint_normalization(self):
        exp1 = DoomwatchExporter(collector_url="http://localhost:4000")
        self.assertEqual(exp1.endpoint, "http://localhost:4000/v1/traces")

        exp2 = DoomwatchExporter(collector_url="http://localhost:4000/v1/traces")
        self.assertEqual(exp2.endpoint, "http://localhost:4000/v1/traces")

        exp3 = DoomwatchExporter(collector_url="http://localhost:4000/")
        self.assertEqual(exp3.endpoint, "http://localhost:4000/v1/traces")


if __name__ == "__main__":
    unittest.main()
