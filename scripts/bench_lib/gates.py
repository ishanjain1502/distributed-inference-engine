from __future__ import annotations

ALLOWED_GATE_KEYS = {"error_rate", "p95_ttft_ms", "reject_rate"}

_SUMMARY_KEY = {
    "error_rate": "error_rate",
    "reject_rate": "reject_rate",
    "p95_ttft_ms": "ttft_p95_ms",
}


def parse_fail_on(spec: str | None) -> dict[str, float]:
    if spec is None or spec.strip() == "":
        return {}
    gates: dict[str, float] = {}
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "=" not in part:
            raise ValueError(f"invalid fail-on item (expected key=value): {part!r}")
        key, raw = part.split("=", 1)
        key = key.strip()
        if key not in ALLOWED_GATE_KEYS:
            raise ValueError(f"unknown fail-on key: {key!r}")
        gates[key] = float(raw.strip())
    return gates


def evaluate_gates(summary: dict, gates: dict[str, float]) -> list[str]:
    failures: list[str] = []
    for key, limit in gates.items():
        summary_key = _SUMMARY_KEY[key]
        actual = summary.get(summary_key)
        if actual is None:
            failures.append(f"{key}: no value in summary (limit {limit})")
            continue
        if actual > limit:
            failures.append(f"{key}: {actual} > {limit}")
    return failures

