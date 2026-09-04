"""aide-run-spec: the throwaway checkout each run works in, and the per-root lock that keeps two runs out of each other.

One part of a suite that was one 7348-line file until 2026-09-04;
the tests are unchanged and keep their names. What they share sits
in conftest.py beside them.
"""

import json
import os
import pathlib
import re
import shlex
import shutil
import signal
import subprocess
import time
import pytest
from ..conftest import READ_SPECS, git, init_repo, run
from .run_spec_fakes import make_named_writing_claude, make_worktree_add_gate, probing_claude, specs_only_claude, writing_claude
from .run_spec_invoking import BRANCH, create, wait_until, worktrees
from .run_spec_origins import is_ancestor
from .run_spec_results import RESULT_BUDGET, RESULT_OK

def test_the_main_checkout_never_leaves_its_default_branch(runner, workspace, fake_claude):
    """The whole point. Two runs on the same repo pair are independent
    only if neither of them moves the shared tree."""
    claude, log = probing_claude(
        fake_claude, workspace,
        extra=(
            'echo "written by the step" > "$PWD/new-code.txt"\n'
            f'echo "analysis" > "$specs/{workspace["folder"]}/2-analysis.md"\n'
        ),
    )
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert log.read_text().split() == ["main", "main"], "during the run, both trees stay on main"
    assert git(workspace["project"], "rev-parse", "--abbrev-ref", "HEAD") == "main"
    assert git(workspace["specs"], "rev-parse", "--abbrev-ref", "HEAD") == "main"
    # And the work really did land on the branch, so this is not a test
    # that passes because nothing happened.
    assert "new-code.txt" in git(workspace["project"], "show", "--name-only", "--pretty=", BRANCH)

def test_the_worktree_specs_path_points_at_the_specs_worktree(runner, workspace, fake_claude):
    """A worktree of the PROJECT isolates nothing an analyze step writes:
    AIDE_SPECS_PATH is an absolute path into another repository, and it
    resolves to the shared checkout from inside a worktree just as well as
    from outside it."""
    seen = workspace["project"].parent / "specs-seen.txt"
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "%s\\n" "$specs" > {seen}\n'
        + f'echo "analysis" > "$specs/{workspace["folder"]}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    resolved = seen.read_text().strip()
    assert resolved.startswith(str(workspace["wtbase"])), resolved
    assert not resolved.startswith(str(workspace["specs"]) + "/"), "not the shared specs checkout"
    # What the step wrote there is committed on the branch in the specs
    # REPO — the worktree is a view of it, not a copy. Across the whole
    # branch, not just its last commit: the step's own content and the
    # `Workflow steps completed` line land in separate commits (spec 343).
    assert "2-analysis.md" in git(workspace["specs"], "log", "--name-only", "--pretty=", f"main..{BRANCH}")
    assert "2-analysis.md" not in git(workspace["specs"], "ls-tree", "-r", "--name-only", "main")

def test_the_specs_worktree_is_added_to_claude_as_a_directory(runner, workspace, fake_claude):
    """claude's session is confined to its cwd — the PROJECT worktree — and
    the specs worktree is a sibling of it, not a child. Without --add-dir
    an archive step (which moves the spec's folder) reports "sandbox only
    allows … the project" and does nothing; seen four times on
    2026-08-18. Every root the step may write in is handed over."""
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    argv = fake_claude.calls.read_text().split()
    added = [argv[i + 1] for i, a in enumerate(argv) if a == "--add-dir"]
    assert added, "no --add-dir at all"
    assert all(a.startswith(str(workspace["wtbase"])) for a in added), added
    assert any(a.endswith("/" + workspace["specs"].name) for a in added), added

def test_a_linked_dependency_is_available_inside_the_worktree(runner, workspace, fake_claude):
    """`git worktree add` checks out TRACKED files only, so every
    gitignored path is absent — in this repo that is `.venv` and
    `dashboard/node_modules`, without which pytest and bun both fail for a
    reason that has nothing to do with the change."""
    seen = workspace["project"].parent / "dep-seen.txt"
    claude = fake_claude(
        "cat > /dev/null\n"
        + f'cat "$PWD/deps/marker.txt" > {seen} 2>&1\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert seen.read_text().strip() == "the dependency tree"

def test_a_linked_dependency_is_never_staged_and_leaves_the_repo_unchanged(
    runner, workspace, fake_claude, origin
):
    """A `dir/` gitignore rule matches directories only, and a symlink is
    a file to git — so the link reads as untracked and `git add -A` would
    commit it. Two absolute-path symlinks on every spec branch is the
    small half; the large half is that every repo then counts as changed,
    so an analyze step that touched nothing in the project pushes a branch
    and a compare link anyway."""
    rc, out, _ = run(runner, workspace, specs_only_claude(fake_claude, workspace), push="branch")
    assert rc == 0, out
    roots = {r["root"]: r for r in out["repos"]}
    assert roots[str(workspace["project"])]["changedFiles"] == 0, "the link is not a change"
    assert git(origin["project"], "branch", "--list", BRANCH) == "", "and no branch is pushed"
    assert BRANCH in git(origin["specs"], "branch", "--list", BRANCH)

def test_the_reported_root_is_the_main_checkout_and_head_is_the_worktrees(
    runner, workspace, fake_claude
):
    """A worktree path is deleted when the run ends. Reported as `root` it
    would make the page's labels read as job ids, `isMerged` answer false
    forever, and Merge fail in a directory that no longer exists."""
    rc, out, _ = run(runner, workspace, writing_claude(fake_claude, workspace))
    assert rc == 0, out
    roots = {r["root"]: r for r in out["repos"]}
    assert set(roots) == {str(workspace["project"]), str(workspace["specs"])}
    for main, repo in roots.items():
        assert pathlib.Path(main).is_dir(), "a reported root must still exist afterwards"
        assert repo["worktree"].startswith(str(workspace["wtbase"])), repo
        # headAfter is the step's commit, read in the tree the work
        # happened in — not the default branch's HEAD.
        assert repo["headAfter"] == git(main, "rev-parse", BRANCH)
        assert repo["headAfter"] != git(main, "rev-parse", "main")

def test_no_worktree_survives_a_completed_run(runner, workspace, fake_claude):
    rc, out, _ = run(runner, workspace, writing_claude(fake_claude, workspace))
    assert rc == 0, out
    for repo in (workspace["project"], workspace["specs"]):
        assert worktrees(repo) == [str(repo)], "only the main worktree may remain"
    assert not list(workspace["wtbase"].glob("*/*/*")), "and nothing is left on disk"

def test_no_worktree_survives_a_budget_stop(runner, workspace, fake_claude):
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_BUDGET)}'; exit 1")
    rc, out, _ = run(runner, workspace, claude)
    assert out["terminalReason"] == "budget"
    assert worktrees(workspace["project"]) == [str(workspace["project"])]

def test_no_worktree_survives_a_deadline_kill(runner, workspace, fake_claude):
    claude = fake_claude("cat > /dev/null\ntrap '' TERM\nwhile true; do sleep 0.2; done")
    rc, out, _ = run(runner, workspace, claude, timeout_sec="8", kill_grace_sec="2")
    assert out["terminalReason"] == "timeout"
    assert worktrees(workspace["project"]) == [str(workspace["project"])]
    assert worktrees(workspace["specs"]) == [str(workspace["specs"])]

def test_no_worktree_survives_a_refusal_in_the_branch_block(runner, workspace, fake_claude):
    """The trap has to be installed BEFORE the first `worktree add`: a
    refusal between the two would orphan a worktree, and an orphan locks
    its branch out of every later run."""
    project = workspace["project"]
    git(project, "switch", "-q", "-c", BRANCH)
    (project / "contested.txt").write_text("the branch's version\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "branch side")
    git(project, "switch", "-q", "main")
    (project / "contested.txt").write_text("main's version\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "main side")

    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert worktrees(project) == [str(project)], "a refusal must clean up after itself"
    assert worktrees(workspace["specs"]) == [str(workspace["specs"])]

def test_a_leftover_worktree_at_another_path_is_swept_by_branch(
    runner, workspace, fake_claude, tmp_path
):
    """SIGKILL cannot be trapped, so a killed run leaves a checkout
    behind — and after `git worktree prune` a leftover at a DIFFERENT path
    still gives `fatal: '<branch>' is already used by worktree at …`.
    Sweeping this run's own path is therefore not enough."""
    orphan = tmp_path / "orphan-worktree"
    git(workspace["project"], "worktree", "add", "-q", "-b", BRANCH, str(orphan))
    assert len(worktrees(workspace["project"])) == 2

    rc, out, _ = run(runner, workspace, writing_claude(fake_claude, workspace), command="implement")
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert worktrees(workspace["project"]) == [str(workspace["project"])]

def test_a_run_that_leaves_a_root_untouched_deletes_the_empty_branch(
    runner, workspace, fake_claude
):
    """An analyze step commits nothing in the project, so the branch it
    cut there carries nothing — and a branch carrying nothing is a
    branch a later run can only trip over. Three runs were refused on
    2026-08-23 with `cannot create aide/<spec> in a worktree of`, and
    every one of those branches had to be deleted by hand, in two
    repositories each."""
    rc, out, _ = run(runner, workspace, specs_only_claude(fake_claude, workspace))
    assert rc == 0, out
    assert git(workspace["project"], "branch", "--list", BRANCH) == "", \
        "a branch with no commits on it must not outlive the run that cut it"
    assert BRANCH in git(workspace["specs"], "branch", "--list", BRANCH), \
        "and the root that DID get work keeps its branch"

def test_a_run_that_stops_early_deletes_its_empty_branches_too(runner, workspace, fake_claude):
    """The cleanup hangs off the same EXIT trap the worktree removal
    does, so it has to fire on every exit path. A run that stops before
    the step wrote anything leaves an empty branch in BOTH roots, which
    is the worst version of the leftover — two repositories to clean by
    hand for one spec."""
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_BUDGET)}'; exit 1")
    rc, out, _ = run(runner, workspace, claude)
    assert out["terminalReason"] == "budget", out
    for repo in (workspace["project"], workspace["specs"]):
        assert git(repo, "branch", "--list", BRANCH) == "", \
            f"{repo} kept an empty branch after a run that stopped early"

def test_a_second_run_for_the_same_spec_starts_from_a_clean_slate(
    runner, workspace, fake_claude
):
    """The reported symptom: run a step twice on one spec and the second
    run must get going, not refuse over its own leavings."""
    claude = specs_only_claude(fake_claude, workspace)
    rc1, out1, _ = run(runner, workspace, claude)
    assert rc1 == 0, out1
    rc2, out2, stdout2 = run(runner, workspace, claude)
    assert rc2 == 0, out2
    assert out2["terminalReason"] == "completed", out2
    assert "cannot create" not in stdout2

def test_a_branch_carrying_work_survives_a_run_that_adds_nothing_to_it(
    runner, workspace, fake_claude
):
    """The other half of the rule: only a branch that carries NOTHING is
    swept. An earlier step's commit, still unpushed, is the one thing
    this cleanup must never be able to lose — and `head did not move
    during THIS run` is not the same question as `this branch is
    empty`."""
    project = workspace["project"]
    git(project, "switch", "-q", "-c", BRANCH)
    (project / "from-the-earlier-step.txt").write_text("implement wrote this\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "an earlier step")
    earlier = git(project, "rev-parse", "HEAD")
    git(project, "switch", "-q", "main")

    rc, out, _ = run(runner, workspace, specs_only_claude(fake_claude, workspace))
    assert rc == 0, out
    assert BRANCH in git(project, "branch", "--list", BRANCH), "the branch must survive"
    assert is_ancestor(project, earlier, BRANCH), "and so must its commit"
