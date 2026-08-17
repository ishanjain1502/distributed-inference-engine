from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from .client import check_coordinator, infer_once
from .metrics import RequestResult, aggregate
from .ramp import concurrency_levels


async def run_fixed(
    *,
    base_url: str,
    prompt: str,
    model: str,
    max_tokens: int,
    timeout_s: float,
    concurrency: int,
    requests: int,
    client: httpx.AsyncClient | None = None,
) -> tuple[list[RequestResult], float]:
    sem = asyncio.Semaphore(concurrency)
    results: list[RequestResult] = []

    async def one(shared_client: httpx.AsyncClient) -> RequestResult:
        async with sem:
            return await infer_once(
                shared_client,
                base_url=base_url,
                prompt=prompt,
                model=model,
                max_tokens=max_tokens,
                timeout_s=timeout_s,
            )

    if client is not None:
        wall_start = time.perf_counter()
        results = list(await asyncio.gather(*[one(client) for _ in range(requests)]))
        wall_clock_s = time.perf_counter() - wall_start
        return results, wall_clock_s

    pool_size = max(concurrency, 1) + 10
    limits = httpx.Limits(max_connections=pool_size)
    async with httpx.AsyncClient(limits=limits) as owned_client:
        await check_coordinator(owned_client, base_url)

        wall_start = time.perf_counter()
        results = list(
            await asyncio.gather(*[one(owned_client) for _ in range(requests)])
        )
        wall_clock_s = time.perf_counter() - wall_start
    return results, wall_clock_s


async def run_stress(
    *,
    base_url: str,
    prompt: str,
    model: str,
    max_tokens: int,
    timeout_s: float,
    step: int,
    max_concurrency: int,
    requests_per_step: int,
    stop_reject_rate: float,
) -> tuple[list[dict[str, Any]], list[RequestResult], float]:
    levels_out: list[dict[str, Any]] = []
    all_results: list[RequestResult] = []
    total_start = time.perf_counter()

    pool_size = max(max_concurrency, 1) + 10
    limits = httpx.Limits(max_connections=pool_size)
    async with httpx.AsyncClient(limits=limits) as client:
        await check_coordinator(client, base_url)

        for conc in concurrency_levels(step, max_concurrency):
            sem = asyncio.Semaphore(conc)

            async def one() -> RequestResult:
                async with sem:
                    return await infer_once(
                        client,
                        base_url=base_url,
                        prompt=prompt,
                        model=model,
                        max_tokens=max_tokens,
                        timeout_s=timeout_s,
                    )

            level_start = time.perf_counter()
            level_results = list(
                await asyncio.gather(*[one() for _ in range(requests_per_step)])
            )
            level_wall = time.perf_counter() - level_start
            summary = aggregate(level_results, level_wall)
            level_entry = {
                "concurrency": conc,
                "summary": summary,
            }
            levels_out.append(level_entry)
            all_results.extend(level_results)
            if summary["reject_rate"] >= stop_reject_rate:
                break

    total_wall = time.perf_counter() - total_start
    return levels_out, all_results, total_wall
