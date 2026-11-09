"""Tests for `aide_find_spec_folder` (core/scripts/lib/spec-reference.sh),
the runner's one lookup of a spec's folder: the folder itself, else the
first `<id>-*`, in the active list, under `archive/`, or in either.
"""
import subprocess
from pathlib import Path

import pytest

LIB = Path(__file__).resolve().parents[7] / "core" / "scripts" / "lib" / "spec-reference.sh"


@pytest.fixture
def specs_root(tmp_path):
    (tmp_path / "744-x").mkdir()
    (tmp_path / "archive" / "700-y").mkdir(parents=True)
    (tmp_path / "archive" / "744-old").mkdir()
    return tmp_path


def find(root, spec_id, where=None):
    """What the lookup answers: whether it found one, the folder, and where it stands."""
    args = [str(root), spec_id] + ([where] if where else [])
    proc = subprocess.run(
        ["bash", "-c", 'set -u; source "$1"; shift; aide_find_spec_folder "$@"; rc=$?; '
                       'printf "%s|%s|%s" "$rc" "$found_folder" "$found_under"', "_", str(LIB), *args],
        capture_output=True, text=True,
    )
    rc, folder, under = proc.stdout.split("|")
    return rc == "0", folder, under


@pytest.mark.parametrize("spec_id", ["744", "744-x"])
def test_the_active_folder_is_found_by_its_number_or_its_name_AC_4(specs_root, spec_id):
    assert find(specs_root, spec_id) == (True, "744-x", "")


def test_an_archived_spec_is_not_found_among_the_active_ones_AC_4(specs_root):
    assert find(specs_root, "700", "active") == (False, "", "")
    assert find(specs_root, "700") == (False, "", "")


@pytest.mark.parametrize("where", ["archive", "any"])
def test_an_archived_spec_is_found_under_archive_AC_4(specs_root, where):
    assert find(specs_root, "700", where) == (True, "700-y", "archive/")


def test_any_prefers_the_active_folder_AC_4(specs_root):
    assert find(specs_root, "744", "any") == (True, "744-x", "")


@pytest.mark.parametrize("spec_id", ["new-0a1b2c3d", ""])
def test_a_key_with_no_folder_and_an_empty_id_find_nothing_AC_4(specs_root, spec_id):
    assert find(specs_root, spec_id, "any") == (False, "", "")
