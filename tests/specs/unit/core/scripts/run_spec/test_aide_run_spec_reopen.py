"""Reopening a spec, and resetting one: the branches each takes away,
what each refuses, and the boundary they draw under everything that ran
before.

Split out of test_aide_run_spec_records.py 2026-09-04; the tests are
unchanged and keep their names.
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
import pytest
import pytest
from ..conftest import READ_SPECS, git, run
from .run_spec_fakes import specs_only_claude
from .run_spec_invoking import BRANCH, create
from .run_spec_origins import archive_the_spec, has_branch, make_branch, origin
from .run_spec_results import RESULT_OK
from .run_spec_status_files import already_ran, recorded_line, reopen_line, reset_line, subject, with_status


def test_reopen_finds_a_spec_that_is_already_in_the_archive(runner, workspace, fake_claude):
    """The --spec gate checks `$specs_root/$spec_arg` and `$specs_root/*/`
    and nothing else, so an archived folder is "unknown spec" — which
    would refuse the one step that exists to un-archive it, before the
    skill ever ran."""
    archive_the_spec(workspace)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 0, out
    assert out["ok"] is True, out

def test_the_archive_is_opened_for_reopen_and_for_no_other_step(
    runner, workspace, fake_claude
):
    """An archived spec is not runnable. `reopen` is the exemption, the
    way `create` is the exemption from "the folder must already exist" —
    a named step, never a general relaxation of the gate."""
    archive_the_spec(workspace)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 2, out
    assert "Unknown spec" in out["error"], out

def test_reopen_names_the_folder_not_its_archive_path(runner, workspace, fake_claude):
    """The branch, the worktree and the commit are named after the spec,
    and an archived folder resolving to `archive/<slug>` would name a
    branch `aide/archive/<slug>` — a different spec as far as every
    reader of the commit grammar is concerned."""
    archive_the_spec(workspace)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen", dry_run=True)
    assert rc == 0, out
    assert out["prompt"].startswith("/aide-reopen 81"), out["prompt"]

def test_reopen_takes_the_leftover_branch_out_of_both_roots(
    runner, workspace, fake_claude
):
    """Incident 1: a local ref left behind in the main checkout, and the
    next run refused to start on a conflict nobody could see. Both roots
    — an analyze step writes only in the specs repo, and its branch is
    just as much in the way."""
    archive_the_spec(workspace)
    old_project = make_branch(workspace["project"], BRANCH)
    old_specs = make_branch(workspace["specs"], BRANCH)
    # The step leaves work in both roots — in the ARCHIVED folder, which
    # is where a reopen finds the spec. Since spec 215 a branch carrying
    # nothing is deleted at the end of the run that cut it, so a step
    # committing nothing would leave no branch of the run's own to look
    # for here.
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'echo "reopened" > "$PWD/new-code.txt"\n'
        + f'echo "reopened" > "$specs/archive/{workspace["folder"]}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 0, out
    # The run cuts its own branch of the same name from the default
    # branch, so what has to be gone is the earlier round's TIP — not the
    # name.
    for root, old in ((workspace["project"], old_project), (workspace["specs"], old_specs)):
        assert has_branch(root, BRANCH), "the run's own branch"
        reachable = git(root, "rev-list", BRANCH)
        base = git(root, "rev-parse", f"{old}")
        assert base in reachable, "the default branch's history is still there"

def test_reopen_takes_the_branch_off_origin_in_both_roots(
    runner, workspace, fake_claude, origin
):
    """The other two of the four places a branch hides. `push` is `none`
    here, so nothing puts it back — what the bare repos hold at the end
    is what the deletion left."""
    archive_the_spec(workspace)
    for root in (workspace["project"], workspace["specs"]):
        make_branch(root, BRANCH)
        git(root, "push", "-q", "origin", BRANCH)
    for bare in (origin["project"], origin["specs"]):
        assert has_branch(bare, BRANCH), "staged: the branch is on origin"
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 0, out
    for bare in (origin["project"], origin["specs"]):
        assert not has_branch(bare, BRANCH), f"{bare} still holds {BRANCH}"

def test_reopen_succeeds_when_the_branches_are_already_gone(
    runner, workspace, fake_claude, origin
):
    """Every one of the four deletions tolerates "already gone": a spec
    whose branch was cleaned up by the landing that archived it is the
    normal case, not a failure."""
    archive_the_spec(workspace)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 0, out
    assert out["ok"] is True, out

def test_reopen_refuses_when_the_spec_is_already_active(runner, workspace, fake_claude):
    """The spec is left exactly where the resolver found it — active,
    not archived — so the run must refuse before it does anything else."""
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 2, out
    assert "already active" in out["error"], out

def test_reopen_refusal_leaves_an_active_specs_branch_alone(
    runner, workspace, fake_claude, origin
):
    """The same four places incident 1 lost a branch in
    (test_reopen_takes_the_leftover_branch_out_of_both_roots and
    test_reopen_takes_the_branch_off_origin_in_both_roots) must survive a
    refused run untouched — proving the guard runs ahead of the
    branch-deletion block, not merely that the run exits nonzero."""
    for root in (workspace["project"], workspace["specs"]):
        make_branch(root, BRANCH)
        git(root, "push", "-q", "origin", BRANCH)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 2, out
    for root in (workspace["project"], workspace["specs"]):
        assert has_branch(root, BRANCH), f"{root} lost its local branch"
    for bare in (origin["project"], origin["specs"]):
        assert has_branch(bare, BRANCH), f"{bare} lost its branch"

def test_reset_accepts_an_active_spec_and_removes_remote_branches(
    runner, workspace, fake_claude, origin
):
    for root in (workspace["project"], workspace["specs"]):
        make_branch(root, BRANCH)
        git(root, "push", "-q", "origin", BRANCH)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reset")
    assert rc == 0, out
    for bare in (origin["project"], origin["specs"]):
        assert not has_branch(bare, BRANCH)

def test_reset_is_refused_for_an_archived_spec(runner, workspace, fake_claude):
    archive_the_spec(workspace)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reset")
    assert rc == 2, out
    assert "Unknown spec" in out["error"]

def test_reopen_leaves_the_earlier_rounds_commits_in_the_repository(
    runner, workspace, fake_claude
):
    """The commits happened, and the archive is a record. What changes is
    what COUNTS them, never what is in the repository."""
    already_ran(workspace, ["create", "analyze", "implement", "archive"])
    archive_the_spec(workspace)
    before = git(workspace["specs"], "log", "--format=%s", "main")
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen")
    assert rc == 0, out
    after = git(workspace["specs"], "log", "--format=%s", "main")
    assert before == after, "the default branch's history must not be rewritten"
    for step in ("create", "analyze", "implement", "archive"):
        assert subject(step, workspace["folder"]) in after

def test_the_reopen_boundary_takes_the_earlier_rounds_steps_off_the_line(
    runner, workspace, fake_claude
):
    """Incident 2: a reopened spec came back with the status file
    claiming four completed steps before anything had run."""
    already_ran(workspace, ["create", "analyze", "implement", "archive"])
    boundary = git(workspace["specs"], "rev-parse", "HEAD")
    with_status(workspace, reopened=boundary)
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert recorded_line(workspace) == "analyze"

def test_a_step_run_after_the_reopen_boundary_still_counts(
    runner, workspace, fake_claude
):
    """`--not <sha>` excludes what is REACHABLE from the mark, and a
    commit made after it is a descendant, never an ancestor. A boundary
    that hid the new round too would be the same bug pointing the other
    way."""
    already_ran(workspace, ["create", "analyze", "implement", "archive"])
    boundary = git(workspace["specs"], "rev-parse", "HEAD")
    with_status(workspace, reopened=boundary)
    already_ran(workspace, ["create"])
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze"

def test_the_reset_boundary_excludes_the_earlier_round(runner, workspace, fake_claude):
    already_ran(workspace, ["create", "analyze", "implement", "archive"])
    boundary = git(workspace["specs"], "rev-parse", "HEAD")
    with_status(workspace, reopened=boundary)
    status = workspace["specs"] / workspace["folder"] / "4-status.md"
    status.write_text(status.read_text().replace(reopen_line(boundary), reset_line(boundary)))
    git(workspace["specs"], "add", str(status))
    git(workspace["specs"], "commit", "-qm", "use reset boundary")
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert recorded_line(workspace) == "analyze"

def test_a_spec_that_has_never_been_reopened_counts_everything(
    runner, workspace, fake_claude
):
    """The boundary is OPTIONAL everywhere it is added: a spec with no
    mark — the overwhelming majority — takes the path it took before."""
    already_ran(workspace, ["create", "implement"])
    with_status(workspace)
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement"
