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
) -> tuple[list[RequestResult], float]:
    sem = asyncio.Semaphore(concurrency)
    results: list[RequestResult] = []

    async with httpx.AsyncClient() as client:
        await check_coordinator(client, base_url)

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

        wall_start = time.perf_counter()
        results = list(await asyncio.gather(*[one() for _ in range(requests)]))
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

    async with httpx.AsyncClient() as client:
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
