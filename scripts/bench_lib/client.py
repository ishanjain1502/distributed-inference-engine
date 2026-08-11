from __future__ import annotations

import json
import time
import uuid
from typing import Any

import httpx

from .metrics import RequestResult


def parse_sse_data_line(line: str) -> dict[str, Any] | None:
    if not line.startswith("data: "):
        return None
    raw = line[6:].strip()
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    return data


async def infer_once(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    prompt: str,
    model: str,
    max_tokens: int,
    timeout_s: float,
) -> RequestResult:
    url = f"{base_url.rstrip('/')}/coordinator/infer"
    payload = {
        "conversation_id": str(uuid.uuid4()),
        "prompt": prompt,
        "model": model,
        "max_tokens": max_tokens,
    }
    start = time.perf_counter()
    ttft_ms: float | None = None
    tokens = 0
    try:
        async with client.stream(
            "POST",
            url,
            json=payload,
            timeout=timeout_s,
        ) as resp:
            status = resp.status_code
            if status != 200:
                # drain briefly for error body (optional)
                try:
                    await resp.aread()
                except Exception:
                    # Non-critical: body drain is best-effort before returning status.
                    pass
                duration_ms = (time.perf_counter() - start) * 1000.0
                return RequestResult(
                    status=status,
                    ttft_ms=None,
                    tokens=0,
                    duration_ms=duration_ms,
                    error=None,
                    rejected=status == 503,
                )
            stream_error: str | None = None
            async for line in resp.aiter_lines():
                data = parse_sse_data_line(line)
                if data is None:
                    continue
                if "error" in data:
                    err = data["error"]
                    stream_error = str(err) if err is not None else "unknown error"
                    continue
                if "token" in data:
                    tokens += 1
                    if ttft_ms is None:
                        ttft_ms = (time.perf_counter() - start) * 1000.0
            duration_ms = (time.perf_counter() - start) * 1000.0
            if stream_error is not None:
                return RequestResult(
                    status=0,
                    ttft_ms=ttft_ms,
                    tokens=tokens,
                    duration_ms=duration_ms,
                    error=stream_error,
                    rejected=False,
                )
            return RequestResult(
                status=200,
                ttft_ms=ttft_ms,
                tokens=tokens,
                duration_ms=duration_ms,
                error=None,
                rejected=False,
            )
    except httpx.TimeoutException:
        duration_ms = (time.perf_counter() - start) * 1000.0
        return RequestResult(
            status=0,
            ttft_ms=ttft_ms,
            tokens=tokens,
            duration_ms=duration_ms,
            error="timeout",
            rejected=False,
        )
    except httpx.ConnectError as e:
        duration_ms = (time.perf_counter() - start) * 1000.0
        return RequestResult(
            status=0,
            ttft_ms=None,
            tokens=0,
            duration_ms=duration_ms,
            error=f"connect: {e}",
            rejected=False,
        )
    except Exception as e:
        duration_ms = (time.perf_counter() - start) * 1000.0
        return RequestResult(
            status=0,
            ttft_ms=ttft_ms,
            tokens=tokens,
            duration_ms=duration_ms,
            error=str(e),
            rejected=False,
        )


async def check_coordinator(client: httpx.AsyncClient, base_url: str) -> None:
    url = f"{base_url.rstrip('/')}/coordinator/health"
    try:
        resp = await client.get(url, timeout=5.0)
    except httpx.HTTPError as e:
        raise RuntimeError(
            f"Coordinator unreachable at {url}. Is it running? ({e})"
        ) from e
    if resp.status_code != 200:
        raise RuntimeError(
            f"Coordinator health check failed: HTTP {resp.status_code} from {url}"
        )
