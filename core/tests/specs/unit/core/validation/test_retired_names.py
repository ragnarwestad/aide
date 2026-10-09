"""Names that were removed from the repository stay removed: the manifest
skill, and three `.aide/config` keys that nothing reads. The names are built
from two parts so this file does not name them itself, and a plain
`git grep` over the repository comes back empty."""
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[6]

RETIRED = {
    "AC-2": ["aide-" + "manifest"],
    "AC-3": ["AIDE_" + "WORKTREE_LINKS", "AIDE_" + "PREVIEW_CMD", "AIDE_" + "TEST_SCOPE_"],
}
NAMES = [pytest.param(name, id=f"{name} ({ac})") for ac, names in RETIRED.items() for name in names]


@pytest.mark.parametrize("name", NAMES)
def test_no_tracked_path_names_a_retired_name(name):
    tracked = subprocess.run(
        ["git", "-C", str(REPO), "ls-files"],
        capture_output=True, text=True, check=True,
    ).stdout.splitlines()
    assert [p for p in tracked if name in p] == []


@pytest.mark.parametrize("name", NAMES)
def test_no_tracked_file_names_a_retired_name(name):
    # Exit 1 means no match; -I leaves binary files out.
    result = subprocess.run(
        ["git", "-C", str(REPO), "grep", "-l", "-I", "-F", "-e", name],
        capture_output=True, text=True,
    )
    assert result.returncode == 1, f"{name!r} is named in: {result.stdout.split()}"
