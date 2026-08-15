"""Compose fleet must register two uniquely addressed workers."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")


def test_named_worker_services_exist() -> None:
    assert re.search(r"^  worker-1:\s*$", COMPOSE, re.M)
    assert re.search(r"^  worker-2:\s*$", COMPOSE, re.M)


def test_generic_worker_service_is_not_used() -> None:
    """A single `worker` service cannot be scaled: IDs and URLs would collide."""
    assert not re.search(r"^  worker:\s*$", COMPOSE, re.M)


def test_workers_advertise_unique_id_and_url() -> None:
    assert "WORKER_ID: worker-1" in COMPOSE
    assert "WORKER_ID: worker-2" in COMPOSE
    assert "WORKER_URL: http://worker-1:3001" in COMPOSE
    assert "WORKER_URL: http://worker-2:3001" in COMPOSE


def test_restart_policy_is_unless_stopped() -> None:
    assert "restart: unless-stopped" in COMPOSE


def test_coordinator_waits_for_both_workers() -> None:
    match = re.search(r"^  coordinator:\n(.*?)(?=^  [a-zA-Z0-9_-]+:|\Z)", COMPOSE, re.M | re.S)
    assert match is not None
    depends = match.group(1)
    assert re.search(r"^    depends_on:\n(?:      .*\n)*?      worker-1:", depends, re.M)
    assert re.search(r"^    depends_on:\n(?:      .*\n)*?      worker-2:", depends, re.M)
    assert "service_healthy" in depends
