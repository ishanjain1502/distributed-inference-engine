import asyncio
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from bench_lib.client import infer_once, parse_sse_data_line
from bench_lib.metrics import aggregate


def test_parse_sse_token_line():
    line = 'data: {"token":"Hi","finished":false}'
    data = parse_sse_data_line(line)
    assert data == {"token": "Hi", "finished": False}


def test_parse_sse_ignores_non_data():
    assert parse_sse_data_line(": keep-alive") is None
    assert parse_sse_data_line("") is None


def test_parse_sse_bad_json_returns_none():
    assert parse_sse_data_line("data: {not-json") is None


def test_sse_in_band_error_not_clean_success():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=b'data: {"error":"Worker decode failed"}\n\n',
        )

    async def run_once() -> None:
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as client:
            result = await infer_once(
                client,
                base_url="http://test",
                prompt="hello",
                model="tinyllama-1.1b",
                max_tokens=10,
                timeout_s=5.0,
            )
        assert result.error == "Worker decode failed"
        assert result.status == 0
        summary = aggregate([result], wall_clock_s=1.0)
        assert summary["error_rate"] == 1.0

    asyncio.run(run_once())
