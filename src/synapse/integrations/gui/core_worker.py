from __future__ import annotations

import asyncio
import threading
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from typing import TypeVar

from synapse.bootstrap import Application, build_application
from synapse.config import Settings

T = TypeVar("T")


class CoreWorker:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="synapse-gui-core",
        )
        self._application: Application | None = None
        self._start_lock = threading.Lock()

    def start(self) -> None:
        if self._application is not None:
            return
        with self._start_lock:
            if self._application is not None:
                return
            self._application = self._executor.submit(
                build_application,
                self._settings,
            ).result()

    def submit(self, operation: Callable[[Application], T]) -> Future[T]:
        self.start()
        application = self._application
        if application is None:
            raise RuntimeError("Core worker failed to start")
        return self._executor.submit(operation, application)

    async def run(self, operation: Callable[[Application], T]) -> T:
        return await asyncio.wrap_future(self.submit(operation))

    def close(self) -> None:
        application = self._application
        if application is not None:
            self._executor.submit(application.close).result()
            self._application = None
        self._executor.shutdown(wait=True, cancel_futures=False)
