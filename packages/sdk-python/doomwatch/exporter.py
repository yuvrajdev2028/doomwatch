"""
Background Batch Exporter for Doomwatch Spans
Transmits spans asynchronously to the Doomwatch Ingestion Collector.
"""

import atexit
import json
import logging
import threading
import time
import urllib.request
import urllib.error
from collections import deque
from typing import List, Optional
from urllib.parse import urlparse

from .types import Span

logger = logging.getLogger("doomwatch.exporter")


class DoomwatchExporter:
    def __init__(
        self,
        collector_url: str = "http://localhost:4000",
        batch_interval_ms: int = 1000,
        batch_size: int = 50,
        max_queue_capacity: int = 5000,
        request_timeout_sec: float = 2.0,
        debug: bool = False
    ):
        raw_url = collector_url.rstrip("/")
        if not raw_url.endswith("/v1/traces"):
            self.endpoint = f"{raw_url}/v1/traces"
        else:
            self.endpoint = raw_url

        self.batch_interval_sec = max(0.05, batch_interval_ms / 1000.0)
        self.batch_size = max(1, batch_size)
        self.max_queue_capacity = max_queue_capacity
        self.request_timeout_sec = request_timeout_sec
        self.debug = debug

        self._queue: deque[Span] = deque()
        self._lock = threading.Lock()
        self._wake_event = threading.Event()
        self._stop_event = threading.Event()
        self._worker_thread: Optional[threading.Thread] = None
        self._last_error_log_time = 0.0

        atexit.register(self.shutdown)

    def start(self) -> None:
        """Starts the background worker thread."""
        with self._lock:
            if self._worker_thread is not None and self._worker_thread.is_alive():
                return
            self._stop_event.clear()
            self._worker_thread = threading.Thread(
                target=self._worker_loop,
                name="doomwatch-exporter-worker",
                daemon=True
            )
            self._worker_thread.start()

    def enqueue(self, span: Span) -> None:
        """Enqueues a span for asynchronous batch transmission."""
        with self._lock:
            if len(self._queue) >= self.max_queue_capacity:
                # Drop oldest span if queue is over capacity (overload protection)
                self._queue.popleft()
            self._queue.append(span)
            should_wake = len(self._queue) >= self.batch_size

        if should_wake:
            self._wake_event.set()

    def flush(self) -> None:
        """Synchronously flushes all pending spans in the queue."""
        with self._lock:
            pending_count = len(self._queue)

        processed = 0
        while processed < pending_count:
            with self._lock:
                if not self._queue:
                    break
                batch: List[Span] = []
                while self._queue and len(batch) < self.batch_size:
                    batch.append(self._queue.popleft())

            if not batch:
                break

            processed += len(batch)
            success = self._send_batch(batch)
            if not success:
                # If collector is unreachable, avoid infinite retry loop
                break

    def shutdown(self, timeout_sec: float = 1.0) -> None:
        """Flushes remaining spans and stops the exporter worker thread."""
        self._stop_event.set()
        self._wake_event.set()
        self.flush()

        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=timeout_sec)

    def _worker_loop(self) -> None:
        while not self._stop_event.is_set():
            # Wait for wake signal or batch interval timeout
            self._wake_event.wait(timeout=self.batch_interval_sec)
            self._wake_event.clear()

            while not self._stop_event.is_set():
                with self._lock:
                    if not self._queue:
                        break
                    batch: List[Span] = []
                    while self._queue and len(batch) < self.batch_size:
                        batch.append(self._queue.popleft())

                if not batch:
                    break

                success = self._send_batch(batch)
                if not success:
                    break

    def _send_batch(self, batch: List[Span]) -> bool:
        try:
            payload = json.dumps({"spans": [s.to_dict() for s in batch]}).encode("utf-8")
            req = urllib.request.Request(
                url=self.endpoint,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=self.request_timeout_sec) as resp:
                status = resp.status
                if self.debug:
                    logger.info(
                        "[Doomwatch Exporter] Successfully exported %d spans (HTTP %d)",
                        len(batch),
                        status
                    )
                return True
        except Exception as exc:
            now = time.time()
            if self.debug or (now - self._last_error_log_time > 10.0):
                logger.warning(
                    "[Doomwatch Exporter] Failed to export %d spans to %s: %s",
                    len(batch),
                    self.endpoint,
                    exc
                )
                self._last_error_log_time = now

            # Re-queue failed batch if within capacity (fail-open)
            with self._lock:
                remaining_space = self.max_queue_capacity - len(self._queue)
                if remaining_space > 0:
                    for s in reversed(batch[:remaining_space]):
                        self._queue.appendleft(s)
            return False
