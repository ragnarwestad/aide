"""Reopening a spec, and resetting one: the branches each takes away,
what each refuses, and the boundary they draw under everything that ran
before.

Split out of test_aide_run_spec_records.py 2026-09-04; the tests are
unchanged and keep their names.
"""

import json
import pytest
from ..conftest import git, run
from .run_spec_fakes import specs_only_claude
from .run_spec_invoking import BRANCH
from .run_spec_origins import archive_the_spec, has_branch, make_branch, origin
from .run_spec_results import RESULT_OK
from .run_spec_status_files import (
    already_ran, recorded_line, reopen_line, reset_line, subject, with_status, write_raw_status,
)


def land_the_archive(workspace):
    """A runner cuts its worktree from origin's default branch, so an
    archive that origin has not seen is not the archive the run finds."""
    git(workspace["specs"], "push", "-q", "origin", "main")


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
    assert "unknown spec" in out["error"], out

def test_reopen_names_the_folder_not_its_archive_path(runner, workspace, fake_claude):
    """The branch, the worktree and the commit are named after the spec,
    and an archived folder resolving to `archive/<slug>` would name a
    branch `aide/archive/<slug>` — a different spec as far as every
    reader of the commit grammar is concerned."""
    archive_the_spec(workspace)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen", dry_run=True, reset_files=True)
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
    make_branch(workspace["project"], BRANCH)
    old_specs = make_branch(workspace["specs"], BRANCH)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen", reset_files=True)
    assert rc == 0, out
    # The run cuts its own branch of the same name from the default
    # branch, so what has to be gone is the earlier round's TIP — not the
    # name. A reopen writes spec files only, so the code root's branch
    # carries nothing and is deleted at the end of the run that cut it
    # (spec 215); the specs root keeps its own, cut from main.
    # The code root's leftover is simply gone: a reopen writes spec files
    # only, so the branch this run cut there carries nothing and is deleted
    # at the end of the run that cut it (spec 215).
    assert not has_branch(workspace["project"], BRANCH), "the leftover in the code root"
    # The specs root has the name again — the run's own branch, cut from the
    # default branch, carrying the reopen's commit and main's history.
    assert has_branch(workspace["specs"], BRANCH), "the run's own branch"
    reachable = git(workspace["specs"], "rev-list", BRANCH)
    assert old_specs in reachable, "the default branch's history is still there"
    assert git(workspace["specs"], "rev-parse", BRANCH) != old_specs, "a commit of its own"

@pytest.mark.parametrize("reset", [False, True], ids=["keep", "reset"])
def test_reopen_takes_the_branch_off_origin_in_both_roots(
    reset,
    runner, workspace, fake_claude, origin
):
    """The other two of the four places a branch hides. `push` is `none`
    here, so nothing puts it back — what the bare repos hold at the end
    is what the deletion left."""
    archive_the_spec(workspace)
    land_the_archive(workspace)
    for root in (workspace["project"], workspace["specs"]):
        make_branch(root, BRANCH)
        git(root, "push", "-q", "origin", BRANCH)
    for bare in (origin["project"], origin["specs"]):
        assert has_branch(bare, BRANCH), "staged: the branch is on origin"
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen", reset_files=reset or None)
    assert rc == 0, out
    for bare in (origin["project"], origin["specs"]):
        assert not has_branch(bare, BRANCH), f"{bare} still holds {BRANCH}"

@pytest.mark.parametrize("reset", [False, True], ids=["keep", "reset"])
def test_reopen_succeeds_when_the_branches_are_already_gone(
    reset,
    runner, workspace, fake_claude, origin
):
    """Every one of the four deletions tolerates "already gone": a spec
    whose branch was cleaned up by the landing that archived it is the
    normal case, not a failure."""
    archive_the_spec(workspace)
    land_the_archive(workspace)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen", reset_files=reset or None)
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

@pytest.mark.parametrize("reset", [False, True], ids=["keep", "reset"])
def test_reopen_leaves_the_earlier_rounds_commits_in_the_repository(
    reset,
    runner, workspace, fake_claude
):
    """The commits happened, and the archive is a record. What changes is
    what COUNTS them, never what is in the repository."""
    already_ran(workspace, ["create", "analyze", "implement", "archive"])
    archive_the_spec(workspace)
    before = git(workspace["specs"], "log", "--format=%s", "main")
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen", reset_files=reset or None)
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


# --- spec 511: reopen keeps the files unless asked to reset them ------------

FULL_FILES = {
    "0-README.md": "# Queue\n\nThe readme.\n",
    "2-analysis.md": "# Queue - Analysis\n\n## Mapping\n\n- `src/x.ts:1` — a round's work\n",
    "3-solution.md": "# Queue - Solution\n\n## Plan\n\n1. Done.\n",
}
ARCHIVED_STATUS = (
    "# Queue - Status\n\n## Tracking info\n\n"
    "- **Task:** `81-queue-and-runner/`\n"
    "- **Workflow steps completed:** create, analyze, implement, archive\n\n"
    "## Acceptance criteria\n\n| Criterion | Status | Note |\n|---|---|---|\n| AC-1 | ✅ | done |\n\n"
    "**Archived:** 2026-09-01\n"
)


def archived_with_files(workspace):
    folder = workspace["specs"] / workspace["folder"]
    for name, text in FULL_FILES.items():
        (folder / name).write_text(text)
    (folder / "4-status.md").write_text(ARCHIVED_STATUS)
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "a finished round")
    archive_the_spec(workspace)


def branch_file(root, name, workspace):
    return git(root, "show", f"{BRANCH}:{workspace['folder']}/{name}")


def test_a_reopen_without_reset_files_runs_no_model_and_keeps_the_files_AC_2(
    runner, workspace, fake_claude, origin
):
    archived_with_files(workspace)
    land_the_archive(workspace)
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude, command="reopen", push="branch")
    assert rc == 0, out
    assert out["ok"] is True and out["terminalReason"] == "completed", out
    assert out["tool"] == "none", out
    assert not fake_claude.calls.exists()
    specs = origin["specs"]
    for name, text in FULL_FILES.items():
        assert branch_file(specs, name, workspace) == text.rstrip("\n"), name
    status = branch_file(specs, "4-status.md", workspace)
    assert "| AC-1 | ✅ | done |" in status
    assert "- **Workflow steps completed:** create, analyze, implement\n" in status + "\n"
    assert "**Round boundary:**" in status and "**Reopened:**" not in status, status
    state = json.loads(branch_file(specs, "4-status.json", workspace))
    assert state["completedPhases"] == ["create", "analyze", "implement"], state


def test_a_reopen_with_reset_files_regenerates_three_files_and_stamps_reopened_AC_3(
    runner, workspace, fake_claude, origin
):
    """The reset mode runs no model either: aide-reopen-spec moves the folder
    back out of archive/ and aide-reset-spec writes the three files from the
    templates, the pair a model turn used to be asked to imitate."""
    archived_with_files(workspace)
    land_the_archive(workspace)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen", reset_files=True, push="branch")
    assert rc == 0, out
    assert not fake_claude.calls.exists(), "the reset mode runs no model"
    assert out["tool"] == "none", out
    specs = origin["specs"]
    # The two files a reset keeps, byte for byte.
    assert branch_file(specs, "0-README.md", workspace) == FULL_FILES["0-README.md"].rstrip("\n")
    # And the three it writes from the templates: the earlier round's own
    # text is gone.
    analysis = branch_file(specs, "2-analysis.md", workspace)
    assert FULL_FILES["2-analysis.md"].strip() not in analysis, analysis
    status = branch_file(specs, "4-status.md", workspace)
    assert "**Reopened:**" in status and "**Round boundary:**" not in status, status
    state = json.loads(branch_file(specs, "4-status.json", workspace))
    assert state["completedPhases"] == [], state


@pytest.mark.parametrize("reset", [False, True], ids=["keep", "reset"])
def test_a_reopen_leaves_no_leftover_commit_on_any_of_the_four_branches_AC_4(
    reset, runner, workspace, fake_claude, origin
):
    archived_with_files(workspace)
    land_the_archive(workspace)
    leftovers = {}
    for key in ("project", "specs"):
        root = workspace[key]
        git(root, "branch", BRANCH)
        git(root, "checkout", "-q", BRANCH)
        git(root, "commit", "-q", "--allow-empty", "-m", f"leftover in {key}")
        leftovers[key] = git(root, "rev-parse", "HEAD")
        git(root, "push", "-q", "origin", BRANCH)
        git(root, "checkout", "-q", "main")
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="reopen", reset_files=reset or None, push="branch")
    assert rc == 0, out
    for key, bare in (("project", origin["project"]), ("specs", origin["specs"])):
        for repo in (workspace[key], bare):
            reachable = git(repo, "rev-list", "--all")
            assert leftovers[key] not in reachable, f"{repo} still holds the leftover commit"


# --- what counts after a keep-Reopen ----------------------------------------


def keep_reopened(workspace, steps_line="create, analyze, implement"):
    """A spec as a landed keep-Reopen leaves it: active, its archive trail
    kept, a round boundary at the commit it was reopened from."""
    already_ran(workspace, ["create", "analyze", "implement", "archive"])
    boundary = git(workspace["specs"], "rev-parse", "--short", "HEAD")
    write_raw_status(
        workspace,
        "# Queue - Status\n\n## Tracking info\n\n"
        "- **Task:** `81-queue-and-runner/`\n"
        f"- **Workflow steps completed:** {steps_line}\n\n"
        "**Archived:** 2026-09-01\n\n"
        f"- **Round boundary:** 2026-09-19 (history before `{boundary}` does not count)\n",
    )
    return boundary


def state_of(workspace):
    return json.loads(branch_file(workspace["specs"], "4-status.json", workspace))


def test_archive_does_not_come_back_on_a_later_step_of_a_reopened_round_AC_2(
    runner, workspace, fake_claude
):
    keep_reopened(workspace)
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement"
    assert "archive" not in state_of(workspace)["completedPhases"]


def test_archive_counts_again_after_a_new_archive_commit_AC_2(runner, workspace, fake_claude):
    keep_reopened(workspace)
    already_ran(workspace, ["archive"])
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement, archive"
    assert "archive" in state_of(workspace)["completedPhases"]


def test_a_spec_never_reopened_keeps_archive_on_its_line_AC_2(runner, workspace, fake_claude):
    already_ran(workspace, ["create", "analyze", "implement", "archive"])
    write_raw_status(
        workspace,
        "# Queue - Status\n\n## Tracking info\n\n"
        "- **Task:** `81-queue-and-runner/`\n"
        "- **Workflow steps completed:** create, analyze, implement, archive\n",
    )
    claude = specs_only_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert recorded_line(workspace) == "create, analyze, implement, archive"
