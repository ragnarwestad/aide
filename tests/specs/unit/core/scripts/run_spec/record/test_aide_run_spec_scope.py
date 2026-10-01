"""A run reaches its own spec folder and nothing else under the specs root:
writing, creating or deleting another spec's folder ends the step a scope
violation with those changes undone, whether the specs root is a
repository of its own or a folder tracked inside the project."""

import json
from ...conftest import READ_SPECS, git, run
from ..run_spec_fakes import specs_foreign_folder_claude
from ..run_spec_results import RESULT_OK
from ..run_spec_status_files import status_with_phase, tracked_specs_inside_project_workspace


def test_a_run_that_creates_another_spec_folder_is_downgraded_and_the_folder_discarded(
    runner, workspace, fake_claude
):
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    claude = specs_foreign_folder_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    assert "999-made-by-the-run" in out["error"], out
    assert "press Analyze again" in out["error"], out
    tree = git(workspace["specs"], "ls-tree", "-r", "--name-only", "aide/81-queue-and-runner")
    assert "999-made-by-the-run" not in tree, tree
    assert f"{workspace['folder']}/2-analysis.md" in tree, tree

def test_a_run_that_deletes_another_spec_folder_is_downgraded_and_the_folder_restored(
    runner, workspace, fake_claude
):
    other = workspace["specs"] / "80-neighbour"
    other.mkdir()
    (other / "1-description.md").write_text("# 80\n")
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "add a neighbour")
    status_with_phase(workspace, "create, analyze", ["| a | ⬜ | |"])
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'echo "written by the step" > "$PWD/new-code.txt"\n'
        + 'rm -rf "$specs/80-neighbour"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["terminalReason"] == "scope-violation", out
    assert "80-neighbour" in out["error"], out
    tree = git(workspace["specs"], "ls-tree", "-r", "--name-only", "aide/81-queue-and-runner")
    assert "80-neighbour/1-description.md" in tree, tree

def test_a_neighbour_archived_on_main_and_merged_in_is_not_the_steps_own_write(
    runner, workspace, fake_claude
):
    """Another spec is archived on the default branch while this step
    runs, and the step merges that branch in: the neighbour's move comes
    with the merge, and is the default branch's, not this step's."""
    other = workspace["specs"] / "80-neighbour"
    other.mkdir()
    (other / "1-description.md").write_text("# 80\n")
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "add a neighbour")
    status_with_phase(workspace, "create, analyze", ["| a | ⬜ | |"])
    main_specs = workspace["specs"]
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'echo "written by the step" > "$PWD/new-code.txt"\n'
        + f'mkdir -p "{main_specs}/archive" && git -C "{main_specs}" mv 80-neighbour archive/80-neighbour\n'
        + f'git -C "{main_specs}" commit -qm "archive the neighbour"\n'
        + 'git -C "$specs" merge -q --no-edit main\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out

def test_a_run_that_writes_only_its_own_folder_is_not_a_scope_violation(runner, workspace, fake_claude):
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    folder = workspace["folder"]
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'echo "analysis" >> "$specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out

def test_a_run_that_writes_only_its_own_folder_is_not_a_scope_violation_when_specs_are_tracked_inside_the_project(
    runner, fake_claude, tmp_path
):
    """REQ-2: specs TRACKED inside the project's own repository — the
    layout the description names, where `specs_repo == project_root`. An
    analyze step that writes only its own spec folder there must
    complete, not be downgraded because `git status` on the whole project
    worktree sees that folder's own legitimate change."""
    ws = tracked_specs_inside_project_workspace(tmp_path)
    folder = ws["folder"]
    claude = fake_claude(
        "cat > /dev/null\n"
        + f'echo "analysis" >> "$PWD/specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, ws, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out

def test_a_run_that_creates_another_spec_folder_is_downgraded_and_the_folder_discarded_when_specs_are_tracked_inside_the_project(
    runner, fake_claude, tmp_path
):
    """REQ-3: a foreign spec folder written under the same TRACKED,
    inside-the-project specs root is still caught and reverted —
    run-spec/record/specs-guard.sh's own existing behavior, now reached for this
    layout because the false positive that used to pre-empt it is gone."""
    ws = tracked_specs_inside_project_workspace(tmp_path)
    folder = ws["folder"]
    claude = fake_claude(
        "cat > /dev/null\n"
        + 'mkdir -p "$PWD/specs/999-made-by-the-run" && echo "# 999" > "$PWD/specs/999-made-by-the-run/1-description.md"\n'
        + f'echo "analysis" >> "$PWD/specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, ws, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    assert "999-made-by-the-run" in out["error"], out
    tree = git(ws["project"], "ls-tree", "-r", "--name-only", "aide/81-queue-and-runner")
    assert "999-made-by-the-run" not in tree, tree
    assert f"specs/{folder}/2-analysis.md" in tree, tree

def test_an_analyze_claim_that_changed_the_project_repo_is_downgraded_when_specs_are_tracked_inside_the_project(
    runner, fake_claude, tmp_path
):
    """REQ-4 regression: a step that writes a real project file OUTSIDE
    the specs root, in the tracked-inside-project layout, is still
    stopped — exactly as it is today."""
    ws = tracked_specs_inside_project_workspace(tmp_path)
    claude = fake_claude(
        "cat > /dev/null\n"
        + 'echo "written by the step" > "$PWD/new-code.txt"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, ws, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out


def test_an_analyze_that_commits_its_own_folder_is_not_a_scope_violation_when_specs_are_tracked_inside_the_project(
    runner, fake_claude, tmp_path
):
    """The HEAD half of the same rule. A session that COMMITS its own
    spec folder, where the specs live inside the project's repository,
    moves the project's HEAD — and "HEAD moved" was read as "the project
    changed", so every such analyze stopped on scope-violation with the
    plan it had written sitting on the branch (paceup 02, 2026-09-18).
    What moved is the step's own folder, which is the whole point of it."""
    ws = tracked_specs_inside_project_workspace(tmp_path)
    folder = ws["folder"]
    claude = fake_claude(
        "cat > /dev/null\n"
        + f'echo "analysis" >> "$PWD/specs/{folder}/2-analysis.md"\n'
        + f'git add "specs/{folder}" && git -c user.email=a@b -c user.name=a commit -qm "analysis"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, ws, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out


def test_an_analyze_that_commits_a_project_file_is_still_downgraded_when_specs_are_tracked_inside_the_project(
    runner, fake_claude, tmp_path
):
    """The same commit carrying a file OUTSIDE the specs root is the
    violation it always was: the exception is the step's own folder,
    never "anything, as long as it was committed"."""
    ws = tracked_specs_inside_project_workspace(tmp_path)
    claude = fake_claude(
        "cat > /dev/null\n"
        + 'echo "written by the step" > "$PWD/new-code.txt"\n'
        + 'git add new-code.txt && git -c user.email=a@b -c user.name=a commit -qm "code"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, ws, claude, command="analyze")
    assert rc == 0, out
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    # It says what was committed, in those words — not "uncommitted".
    assert "(committed: new-code.txt" in out["error"], out
