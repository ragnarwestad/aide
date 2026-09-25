"""A test's temp directories stay inside its own process's (tests/conftest.py)."""
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def test_the_temp_directory_is_one_made_for_this_test_process():
    assert os.path.basename(tempfile.gettempdir()).startswith("aide-pytest-")
    assert os.path.isdir(tempfile.gettempdir())


def test_a_script_the_test_starts_inherits_it():
    out = subprocess.run(["bash", "-c", 'printf %s "$TMPDIR"'], capture_output=True, text=True).stdout
    assert out == tempfile.gettempdir()


def test_that_directory_is_removed_when_the_process_exits():
    root = str(Path(__file__).resolve().parents[5])
    probe = (
        "import sys, os, tempfile; sys.path.insert(0, sys.argv[1]); import tests.conftest; "
        "os.mkdir(os.path.join(tempfile.gettempdir(), 'left-behind')); print(tempfile.gettempdir())"
    )
    own = subprocess.run(
        [sys.executable, "-c", probe, root], capture_output=True, text=True, check=True
    ).stdout.strip()
    assert os.path.basename(own).startswith("aide-pytest-")
    assert not os.path.exists(own)
