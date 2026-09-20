"""aide-run-spec: a project keeps nothing of Aide's in its repository (spec 512).

An untracked `.aide/project.yaml` in the main checkout is the dashboard's
derived copy of the settings it keeps for the project. A worktree carries
tracked files only, so the runner copies it in — and keeps it out of the
commit, out of the tree hash, and out of the main checkout's status.
The rule is stated once, in tests/fixtures/manifest-carry.json, and the
landing gate's copy (dashboard/test/serve/land-branch/gate-carries-manifest.test.ts)
is tested against the same table.
"""

import json
import pathlib
import subprocess

import pytest

from ..conftest import git, run
from .run_spec_invoking import BRANCH, worktrees
from .run_spec_fakes import probing_claude

ROWS = json.loads(
    (pathlib.Path(__file__).resolve().parents[5] / "fixtures" / "manifest-carry.json").read_text()
)["rows"]
MANIFEST = "name: proj\ntestCmd: make it\n"


def _project_with(workspace, row, excluded=True):
    """The main checkout in the state a row of the table names."""
    project = workspace["project"]
    if row["sourceHasManifest"]:
        (project / ".aide" / "project.yaml").write_text(MANIFEST)
        if row["trackedInTree"]:
            git(project, "add", "-f", ".aide/project.yaml")
            git(project, "commit", "-q", "-m", "track the manifest")
        else:
            # The dashboard's clone lists it in its own info/exclude. Left
            # out, the copy is untracked and NOT ignored, so only the
            # commit pathspec keeps it out of the branch.
            if excluded:
                with open(project / ".git" / "info" / "exclude", "a") as f:
                    f.write("/.aide/project.yaml\n")


def _run_probing(runner, workspace, fake_claude, lib):
    """A step that writes code and records what the manifest looked like
    from inside its worktree — the only moment the question can be asked."""
    seen = workspace["project"].parent / "manifest-seen.txt"
    claude, _ = probing_claude(
        fake_claude, workspace,
        extra=(
            'echo "written by the step" > "$PWD/new-code.txt"\n'
            f'echo "analysis" > "$specs/{workspace["folder"]}/2-analysis.md"\n'
            f'if [ -f "$PWD/.aide/project.yaml" ]; then\n'
            f'  bash -c \'source "{lib}"; aide_manifest_get testCmd "$PWD"\' > {seen}\n'
            f'else echo MISSING > {seen}; fi\n'
        ),
    )
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    return seen.read_text().strip()


@pytest.mark.parametrize("row", ROWS, ids=lambda r: r["name"])
def test_the_worktree_carries_the_manifest_by_the_rule_in_the_table(
    runner, workspace, fake_claude, workspace_root, row
):
    """(AC-5) tracked: left alone; untracked with a source: copied in;
    no source: nothing."""
    _project_with(workspace, row)
    lib = workspace_root / "core" / "scripts" / "_aide-spec-lib.sh"
    seen = _run_probing(runner, workspace, fake_claude, lib)
    if row["sourceHasManifest"]:
        assert seen == "make it"
    else:
        assert seen == "MISSING"


@pytest.mark.parametrize("row", ROWS, ids=lambda r: r["name"])
def test_the_branch_holds_the_manifest_only_when_the_project_tracks_it(
    runner, workspace, fake_claude, workspace_root, row
):
    """(AC-6) a copied manifest is never committed; a tracked one is."""
    _project_with(workspace, row, excluded=False)
    lib = workspace_root / "core" / "scripts" / "_aide-spec-lib.sh"
    _run_probing(runner, workspace, fake_claude, lib)
    tree = git(workspace["project"], "ls-tree", "-r", "--name-only", BRANCH).splitlines()
    assert ("new-code.txt" in tree), "the step's own work is committed"
    assert (".aide/project.yaml" in tree) is bool(row["trackedInTree"])


def test_the_main_checkout_is_as_it_was_and_the_worktree_is_gone(
    runner, workspace, fake_claude, workspace_root
):
    """(AC-6) nothing of the copy is left behind in the main checkout."""
    _project_with(workspace, ROWS[0])
    before = git(workspace["project"], "status", "--porcelain")
    lib = workspace_root / "core" / "scripts" / "_aide-spec-lib.sh"
    _run_probing(runner, workspace, fake_claude, lib)
    assert git(workspace["project"], "status", "--porcelain") == before
    assert worktrees(workspace["project"]) == [str(workspace["project"].resolve())] or len(
        worktrees(workspace["project"])
    ) == 1


def _tree_hash(workspace_root, tree):
    return subprocess.run(
        ["bash", "-c", 'source "$1"; aide_tree_hash "$2"', "_",
         str(workspace_root / "core" / "scripts" / "_aide-spec-lib.sh"), str(tree)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def test_the_tree_hash_leaves_an_untracked_manifest_out(workspace, workspace_root):
    """(AC-6) the hash of a worktree holding the copy equals the hash of
    the same worktree without it — and a tracked manifest still counts."""
    project = workspace["project"]
    without = _tree_hash(workspace_root, project)
    (project / ".aide" / "project.yaml").write_text(MANIFEST)
    with open(project / ".git" / "info" / "exclude", "a") as f:
        f.write("/.aide/project.yaml\n")
    # Ignored, so `git add -A` never sees it — the copy in a worktree is
    # untracked but NOT ignored by the worktree's own rules, so remove
    # the ignore to stand for that.
    (project / ".git" / "info" / "exclude").write_text("")
    assert _tree_hash(workspace_root, project) == without
    git(project, "add", "-f", ".aide/project.yaml")
    git(project, "commit", "-q", "-m", "track the manifest")
    assert _tree_hash(workspace_root, project) != without
