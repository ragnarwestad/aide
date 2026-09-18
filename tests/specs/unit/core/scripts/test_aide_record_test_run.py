"""Tests for core/scripts/aide-record-test-run (spec 329): the ONLY
thing that runs a project's resolved test command and captures the
result — command, exit code, commit — so an exit code never travels
through the model on its way into a spec's record.

No AI is involved anywhere in this file: the whole point of the script
is that the exit code it writes is the real process exit code, not
something reported in prose.
"""
import json
import subprocess

import pytest


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-record-test-run"


def init_repo(path):
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "-C", str(path), "init", "-q", "-b", "main"], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.name", "Test"], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.email", "test@example.com"], check=True)
    (path / "README.md").write_text("start\n")
    subprocess.run(["git", "-C", str(path), "add", "README.md"], check=True)
    subprocess.run(["git", "-C", str(path), "commit", "-qm", "init"], check=True)
    return path


def head_commit(repo):
    return subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True, check=True,
    ).stdout.strip()


@pytest.fixture
def project(tmp_path):
    return init_repo(tmp_path / "proj")


@pytest.fixture
def specs_root(tmp_path):
    root = tmp_path / "specs"
    root.mkdir()
    (root / "81-x").mkdir()
    return root


def run(script, project, specs_root, folder, cmd, result_file=None):
    args = [
        str(script), "--project-dir", str(project), "--specs-root", str(specs_root),
        "--folder", folder, "--cmd", cmd,
    ]
    if result_file:
        args += ["--result-file", str(result_file)]
    proc = subprocess.run(args, capture_output=True, text=True)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line), proc.stdout


def run_many(script, project, specs_root, folder, cmds, result_file=None):
    args = [
        str(script), "--project-dir", str(project), "--specs-root", str(specs_root),
        "--folder", folder,
    ]
    for cmd in cmds:
        args += ["--cmd", cmd]
    if result_file:
        args += ["--result-file", str(result_file)]
    proc = subprocess.run(args, capture_output=True, text=True)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line), proc.stdout


def test_passing_command_records_exit_code_zero_and_the_real_commit(script, project, specs_root):
    rc, out, _ = run(script, project, specs_root, "81-x", "true")
    assert rc == 0, out
    assert out["ok"] is True
    assert out["exitCode"] == 0
    assert out["commit"] == head_commit(project)
    record = json.loads((specs_root / "81-x" / "test-run.json").read_text())
    assert record["exitCode"] == 0
    assert record["commit"] == head_commit(project)
    assert record["command"] == "true"


def test_failing_command_records_the_real_nonzero_exit_code(script, project, specs_root):
    rc, out, _ = run(script, project, specs_root, "81-x", "exit 3")
    assert rc == 3, out
    record = json.loads((specs_root / "81-x" / "test-run.json").read_text())
    assert record["exitCode"] == 3, record
    assert record["commit"] == head_commit(project)


def test_empty_command_records_null_exit_code_with_a_plain_words_note(script, project, specs_root):
    rc, out, _ = run(script, project, specs_root, "81-x", "")
    assert rc != 0, out
    record = json.loads((specs_root / "81-x" / "test-run.json").read_text())
    assert record["exitCode"] is None, record
    assert record["command"] is None, record
    assert record["note"], record
    assert "no test command" in record["note"], record


def test_refuses_without_project_dir(script, specs_root):
    proc = subprocess.run(
        [str(script), "--specs-root", str(specs_root), "--folder", "81-x", "--cmd", "true"],
        capture_output=True, text=True,
    )
    out = json.loads(proc.stdout.strip())
    assert proc.returncode == 2
    assert out["terminalReason"] == "refused"


def test_refuses_without_specs_root(script, project):
    proc = subprocess.run(
        [str(script), "--project-dir", str(project), "--folder", "81-x", "--cmd", "true"],
        capture_output=True, text=True,
    )
    out = json.loads(proc.stdout.strip())
    assert proc.returncode == 2
    assert out["terminalReason"] == "refused"


def test_refuses_without_folder(script, project, specs_root):
    proc = subprocess.run(
        [str(script), "--project-dir", str(project), "--specs-root", str(specs_root), "--cmd", "true"],
        capture_output=True, text=True,
    )
    out = json.loads(proc.stdout.strip())
    assert proc.returncode == 2
    assert out["terminalReason"] == "refused"


def test_refuses_when_the_spec_folder_does_not_exist(script, project, specs_root):
    rc, out, _ = run(script, project, specs_root, "99-missing", "true")
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert not (specs_root / "99-missing").exists()


def test_result_file_carries_the_same_json_as_stdout(script, project, specs_root, tmp_path):
    result_file = tmp_path / "result.json"
    rc, out, _ = run(script, project, specs_root, "81-x", "true", result_file=result_file)
    assert json.loads(result_file.read_text()) == out


# --- repeatable --cmd (spec 361, REQ-5) -------------------------------------
#
# A single --cmd must keep producing TODAY's exact record shape — this is
# what makes REQ-6 a regression lock: every assertion above, unmodified,
# is the no-scopes fallback path's own coverage.


def test_two_commands_produce_an_aggregate_record_with_a_commands_array(script, project, specs_root):
    rc, out, _ = run_many(script, project, specs_root, "81-x", ["true", "true"])
    assert rc == 0, out
    record = json.loads((specs_root / "81-x" / "test-run.json").read_text())
    assert record["command"] is None, record
    assert record["exitCode"] == 0, record
    assert record["commit"] == head_commit(project)
    assert record["commands"] == [
        {"command": "true", "exitCode": 0},
        {"command": "true", "exitCode": 0},
    ], record


def test_two_commands_where_one_fails_reports_a_nonzero_aggregate_and_names_both(
    script, project, specs_root,
):
    rc, out, _ = run_many(script, project, specs_root, "81-x", ["true", "exit 3"])
    assert rc != 0, out
    record = json.loads((specs_root / "81-x" / "test-run.json").read_text())
    assert record["commands"] == [
        {"command": "true", "exitCode": 0},
        {"command": "exit 3", "exitCode": 3},
    ], record
    assert record["exitCode"] != 0, record


def test_a_failing_first_command_does_not_skip_the_second(script, project, specs_root):
    """Every command runs regardless of an earlier failure, so a reader
    can see the status of every one — not just the first failure."""
    rc, out, _ = run_many(script, project, specs_root, "81-x", ["exit 1", "true"])
    record = json.loads((specs_root / "81-x" / "test-run.json").read_text())
    assert record["commands"] == [
        {"command": "exit 1", "exitCode": 1},
        {"command": "true", "exitCode": 0},
    ], record


def test_single_cmd_shape_is_unchanged_even_when_passed_through_the_repeatable_flag(
    script, project, specs_root,
):
    """REQ-6 regression lock: exactly one --cmd, however it is passed,
    keeps today's scalar shape — no `commands` array at all."""
    rc, out, _ = run_many(script, project, specs_root, "81-x", ["true"])
    assert rc == 0, out
    record = json.loads((specs_root / "81-x" / "test-run.json").read_text())
    assert record["command"] == "true"
    assert record["exitCode"] == 0
    assert "commands" not in record, record



def head_tree(repo):
    return subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD^{tree}"], capture_output=True, text=True, check=True,
    ).stdout.strip()


def recorded_tree(specs_root):
    return json.loads((specs_root / "81-x" / "test-run.json").read_text())["tree"]


def _linking_project(project, tmp_path):
    """A project whose manifest names `node_modules` as a worktree link,
    ignored with the trailing slash that does not match a symlink, and
    the link itself in place the way a run leaves it."""
    (project / ".aide").mkdir(exist_ok=True)
    (project / ".aide" / "project.yaml").write_text("name: demo\nworktreeLinks: node_modules\n")
    (project / ".gitignore").write_text("node_modules/\n")
    subprocess.run(["git", "-C", str(project), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(project), "commit", "-qm", "manifest"], check=True)
    deps = tmp_path / "deps"
    deps.mkdir()
    (project / "node_modules").symlink_to(deps)


def test_the_recorded_tree_leaves_out_a_worktree_link(script, project, specs_root, tmp_path):
    """A run's worktree links (`.venv`, `node_modules`) are symlinks the
    runner's commit never carries — and a `node_modules/` ignore rule,
    trailing slash and all, does not match one. Counted, they made the
    tree a run recorded differ from the tree that landed with nothing
    else between them (spec 480's archive, 2026-09-18)."""
    _linking_project(project, tmp_path)

    rc, out, _ = run(script, project, specs_root, "81-x", "true")

    assert rc == 0, out
    assert recorded_tree(specs_root) == head_tree(project)


def test_a_worktree_link_a_session_committed_leaves_the_tree_the_same(script, project, specs_root, tmp_path):
    """The same tree hashed before and after the session's own
    `git add -A` swept the link into a commit: the link is out either
    way, so one tree is one hash."""
    _linking_project(project, tmp_path)
    rc, out, _ = run(script, project, specs_root, "81-x", "true")
    before = recorded_tree(specs_root)
    subprocess.run(["git", "-C", str(project), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(project), "commit", "-qm", "swept the link in"], check=True)

    rc, out, _ = run(script, project, specs_root, "81-x", "true")

    assert rc == 0, out
    assert recorded_tree(specs_root) == before


def test_an_untracked_file_still_changes_the_recorded_tree(script, project, specs_root):
    """Only a symlink is left out: an untracked FILE is work the run
    tested, and a tree that forgot it would vouch for code it never saw."""
    (project / "new.txt").write_text("not committed yet\n")

    rc, out, _ = run(script, project, specs_root, "81-x", "true")

    assert rc == 0, out
    assert recorded_tree(specs_root) != head_tree(project)


def test_help_flag_prints_usage_and_exits_zero(script):
    result = subprocess.run([str(script), "--help"], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert "usage" in result.stdout.lower(), result.stdout
