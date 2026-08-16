from __future__ import annotations

import asyncio
from typing import Any

import httpx


def empty_stats_peaks() -> dict[str, float]:
    return {
        "max_session_capacity_pct": 0.0,
        "max_kv_cache_capacity_pct": 0.0,
    }


def merge_stats_peaks(a: dict[str, float], b: dict[str, float]) -> dict[str, float]:
    return {
        "max_session_capacity_pct": max(
            a.get("max_session_capacity_pct", 0.0),
            b.get("max_session_capacity_pct", 0.0),
        ),
        "max_kv_cache_capacity_pct": max(
            a.get("max_kv_cache_capacity_pct", 0.0),
            b.get("max_kv_cache_capacity_pct", 0.0),
        ),
    }


def update_peaks_from_response(peaks: dict[str, float], data: dict[str, Any]) -> None:
    cluster = data.get("cluster")
    if not isinstance(cluster, dict):
        return
    session_pct = cluster.get("session_capacity_pct")
    kv_pct = cluster.get("kv_cache_capacity_pct")
    if isinstance(session_pct, (int, float)):
        peaks["max_session_capacity_pct"] = max(
            peaks["max_session_capacity_pct"], float(session_pct)
        )
    if isinstance(kv_pct, (int, float)):
        peaks["max_kv_cache_capacity_pct"] = max(
            peaks["max_kv_cache_capacity_pct"], float(kv_pct)
        )


class StatsPoller:
    """Poll coordinator stats during a load level and track peak capacity %."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        base_url: str,
        interval_s: float,
    ) -> None:
        self._client = client
        self._url = f"{base_url.rstrip('/')}/coordinator/stats"
        self._interval_s = interval_s
        self.peaks = empty_stats_peaks()
        self._stop = asyncio.Event()
        self._task: asyncio.Task[None] | None = None

    async def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                resp = await self._client.get(self._url, timeout=5.0)
                if resp.status_code == 200:
                    data = resp.json()
                    if isinstance(data, dict):
                        update_peaks_from_response(self.peaks, data)
            except httpx.HTTPError:
                pass
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self._interval_s)
            except asyncio.TimeoutError:
                continue

    async def start(self) -> None:
        self._stop.clear()
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> dict[str, float]:
        self._stop.set()
        if self._task is not None:
            await self._task
            self._task = None
        return dict(self.peaks)
