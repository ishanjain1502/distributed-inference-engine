import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from bench_lib.ramp import concurrency_levels


def test_ramp_includes_max_even_if_not_multiple():
    assert concurrency_levels(step=8, max_concurrency=20) == [8, 16, 20]


def test_ramp_exact_multiple():
    assert concurrency_levels(step=4, max_concurrency=12) == [4, 8, 12]


def test_ramp_step_equals_max():
    assert concurrency_levels(step=5, max_concurrency=5) == [5]

