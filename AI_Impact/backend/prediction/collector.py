"""
AI Impact Kit — Live Data Collector for Prediction
Runs as an async background task, sampling a single sensor at regular intervals.
"""

import asyncio
from datetime import datetime
from sensors.client import fetch_sensor


class DataCollector:
    """Collects time-series data from a single sensor."""

    def __init__(self, sensor_name: str, duration_sec: int = 300, interval_sec: float = 1.0):
        self.sensor_name = sensor_name
        self.duration_sec = duration_sec
        self.interval_sec = interval_sec
        self.data: list[dict] = []      # [{"timestamp": ..., "value": ...}, ...]
        self.status: str = "idle"       # idle | collecting | complete | cancelled | error
        self.progress: float = 0.0
        self.error: str | None = None
        self._task: asyncio.Task | None = None

    @property
    def total_samples(self) -> int:
        return int(self.duration_sec / self.interval_sec)

    def start(self):
        """Launch the collection as a background asyncio task."""
        self.status = "collecting"
        self.data = []
        self.progress = 0.0
        self._task = asyncio.create_task(self._run())

    def cancel(self):
        """Cancel the running collection."""
        self.status = "cancelled"
        if self._task:
            self._task.cancel()

    async def _run(self):
        try:
            for i in range(self.total_samples):
                if self.status == "cancelled":
                    break

                result = await fetch_sensor(self.sensor_name)
                value = result.get("value")
                if value is not None:
                    self.data.append({
                        "timestamp": datetime.utcnow().isoformat(),
                        "value": float(value),
                    })

                self.progress = round((i + 1) / self.total_samples * 100, 1)
                await asyncio.sleep(self.interval_sec)

            if self.status != "cancelled":
                self.status = "complete"

        except asyncio.CancelledError:
            self.status = "cancelled"
        except Exception as exc:
            self.status = "error"
            self.error = str(exc)

    def get_values(self) -> list[float]:
        """Return just the numeric values (for model input)."""
        return [d["value"] for d in self.data]

    def get_timestamps(self) -> list[str]:
        """Return just the timestamp strings."""
        return [d["timestamp"] for d in self.data]

    def to_dict(self) -> dict:
        return {
            "sensor": self.sensor_name,
            "status": self.status,
            "progress": self.progress,
            "total_samples": self.total_samples,
            "collected_count": len(self.data),
            "data": self.data,
            "error": self.error,
        }
