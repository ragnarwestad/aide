"""Tests for `aide_find_spec_folder` (core/scripts/lib/spec-reference.sh),
the runner's one lookup of a spec's folder: the folder itself, else the
first `<id>-*`, in the active list, under `archive/`, or in either; and for
`aide_existing_spec` (core/scripts/lib/spec-commands/find-spec.sh), the
lookup the lifecycle commands share.
"""
import subprocess
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[7] / "core" / "scripts"
LIB = SCRIPTS / "lib" / "spec-reference.sh"


@pytest.fixture
def specs_root(tmp_path):
    (tmp_path / "744-x").mkdir()
    (tmp_path / "archive" / "700-y").mkdir(parents=True)
    (tmp_path / "archive" / "744-old").mkdir()
    (tmp_path / "archive" / "45-MEL-1234-fix").mkdir()
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


def existing(root, arg):
    """What the shared lifecycle lookup answers: its exit status and what it printed."""
    proc = subprocess.run(
        ["bash", "-c", 'set -u; source "$1/_aide-spec-lib.sh"; '
                       'source "$1/lib/spec-commands/find-spec.sh"; '
                       'aide_existing_spec "$2" "$3"',
                       "_", str(SCRIPTS), str(root), arg],
        capture_output=True, text=True,
    )
    return proc.returncode, proc.stdout.strip()


@pytest.mark.parametrize(("arg", "location"), [
    ("744-x", "744-x"),
    ("744", "744-x"),
    ("700-y", "archive/700-y"),
    ("700", "archive/700-y"),
    ("MEL-1234", "archive/45-MEL-1234-fix"),
    ("archive/700-y", "archive/700-y"),
])
def test_the_existing_spec_lookup_returns_the_actual_location(specs_root, arg, location):
    assert existing(specs_root, arg) == (0, location)


@pytest.mark.parametrize("arg", ["700-", "999", "999-none", "archive/999-none", ""])
def test_the_existing_spec_lookup_finds_nothing_for_a_missing_spec_or_a_prefix(specs_root, arg):
    assert existing(specs_root, arg) == (1, "")
