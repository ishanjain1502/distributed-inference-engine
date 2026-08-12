from __future__ import annotations


def concurrency_levels(step: int, max_concurrency: int) -> list[int]:
    if step < 1:
        raise ValueError("step must be >= 1")
    if max_concurrency < 1:
        raise ValueError("max_concurrency must be >= 1")
    levels: list[int] = []
    n = step
    while n < max_concurrency:
        levels.append(n)
        n += step
    levels.append(max_concurrency)
    return levels

