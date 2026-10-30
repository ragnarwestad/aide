"""Aide's pytest suite keeps to the worker count the board gives a run
(core/tests/conftest.py answers what `-n auto`, from pytest.ini, means).

Every nested run sets PYTEST_XDIST_AUTO_NUM_WORKERS, so a run that falls
back to xdist's own answer starts three workers, not one per core.
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[6]


# One small, pure test that lives under core/tests, so the root conftest is
# loaded as it is for the whole suite.
PROBE = Path(__file__).with_name("test_same_env.py")
PROBE_TEST = f"{PROBE}::test_the_shims_stay_when_mise_cannot_say_where_they_point"


def _workers_created(**env):
    base = {k: v for k, v in os.environ.items() if k != "AIDE_TEST_WORKERS"}
    r = subprocess.run(
        [sys.executable, "-m", "pytest", "-p", "no:cacheprovider", PROBE_TEST],
        cwd=ROOT, env={**base, "PYTEST_XDIST_AUTO_NUM_WORKERS": "3", **env},
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-1000:]
    return next(line for line in r.stdout.splitlines() if line.startswith("created:"))


def test_the_suite_starts_no_more_workers_than_it_is_given_ac_3():
    assert _workers_created(AIDE_TEST_WORKERS="2") == "created: 2/2 workers"


@pytest.mark.parametrize("given", [None, "0", "abc"])
def test_without_a_usable_count_the_suite_keeps_its_default_ac_5(given):
    env = {} if given is None else {"AIDE_TEST_WORKERS": given}
    assert _workers_created(**env) == "created: 3/3 workers"
