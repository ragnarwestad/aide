"""Validation of spec 361's REQ-9/10/12: the root pytest suite runs in
parallel by default, the runner it needs is pinned where every machine
that runs the gate installs from, and a content test fails loudly if
either regresses to serial — never a silent, unnoticed slowdown.

The `serial` marker and its own pass after the workers are gone: the
tests that measured wall-clock time were rewritten to tolerate a busy
host (a fixed clock for spans, generous kill windows), so the suite is
one parallel run and nothing more.
"""
import re
from pathlib import Path

ROOT = Path(__file__).parents[6]
REQUIREMENTS = ROOT / "requirements.txt"
PYTEST_INI = ROOT / "pytest.ini"
CONFTEST = ROOT / "tests" / "conftest.py"


def test_requirements_pins_pytest_xdist():
    text = REQUIREMENTS.read_text()
    assert re.search(r"^pytest-xdist==\S+$", text, re.MULTILINE), (
        "requirements.txt must pin pytest-xdist, the same way pytest itself is pinned"
    )


def test_pytest_ini_runs_in_parallel_by_default():
    text = PYTEST_INI.read_text()
    addopts = re.search(r"addopts\s*=\s*(.*?)(?=\n\[|\Z)", text, re.DOTALL)
    assert addopts, "pytest.ini must have an [pytest] addopts block"
    opts = addopts.group(1)
    assert "-n" in opts and "auto" in opts, (
        "addopts must pass -n auto so `.venv/bin/pytest` with no arguments is already parallel"
    )


def test_no_serial_pass_is_left():
    """One run, no second pass: the tests that needed a quiet host were
    the problem, and they were fixed at the source."""
    assert "serial" not in PYTEST_INI.read_text()
    assert "pytest_sessionfinish" not in CONFTEST.read_text()
    assert "AIDE_TEST_LOCK_HELD" not in CONFTEST.read_text()
