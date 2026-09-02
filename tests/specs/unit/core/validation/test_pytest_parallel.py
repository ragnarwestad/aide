"""Validation of spec 361's REQ-9/10/12: the root pytest suite runs in
parallel by default, the runner it needs is pinned where every machine
that runs the gate installs from, and a content test fails loudly if
either regresses to serial — never a silent, unnoticed slowdown.
"""
import re
from pathlib import Path

ROOT = Path(__file__).parents[5]

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
    assert "--dist=loadgroup" in opts, (
        "--dist=loadgroup is required for the serial marker's xdist_group to have any effect"
    )


def test_pytest_ini_registers_the_serial_marker():
    text = PYTEST_INI.read_text()
    assert re.search(r"^\s*serial:\s*\S", text, re.MULTILINE), (
        "the serial marker must be registered under markers=, or --strict-markers fails every use of it"
    )


def test_conftest_groups_serial_tests_via_xdist_group():
    text = CONFTEST.read_text()
    assert "pytest_collection_modifyitems" in text
    assert "xdist_group" in text
    assert "serial" in text
