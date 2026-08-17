from __future__ import annotations

import platform
import subprocess
from pathlib import Path
from typing import Any

import httpx


def _read_cpu_linux() -> str | None:
    try:
        cpuinfo = Path("/proc/cpuinfo").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    for line in cpuinfo.splitlines():
        if line.lower().startswith("model name"):
            return line.split(":", 1)[1].strip()
    return None


def _read_ram_gb_linux() -> float | None:
    try:
        meminfo = Path("/proc/meminfo").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    for line in meminfo.splitlines():
        if line.startswith("MemTotal:"):
            parts = line.split()
            if len(parts) >= 2 and parts[1].isdigit():
                return round(int(parts[1]) / (1024 * 1024), 2)
    return None


def _git_sha() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    sha = result.stdout.strip()
    return sha or None


async def collect_environment(
    client: httpx.AsyncClient,
    base_url: str,
) -> dict[str, Any]:
    """Best-effort host and cluster metadata for reproducibility."""
    cpu = platform.processor()
    if not cpu and platform.system() == "Linux":
        cpu = _read_cpu_linux()

    env: dict[str, Any] = {
        "os": platform.system(),
        "platform": platform.platform(),
        "python_version": platform.python_version(),
        "cpu": cpu,
        "ram_gb": _read_ram_gb_linux(),
        "worker_count": None,
        "alive_worker_count": None,
        "git_sha": _git_sha(),
    }

    url = f"{base_url.rstrip('/')}/coordinator/health/workers"
    try:
        resp = await client.get(url, timeout=5.0)
        if resp.status_code == 200:
            workers = resp.json()
            if isinstance(workers, list):
                env["worker_count"] = len(workers)
                env["alive_worker_count"] = sum(
                    1
                    for w in workers
                    if isinstance(w, dict) and w.get("health", {}).get("alive")
                )
    except httpx.HTTPError:
        pass

    return env
