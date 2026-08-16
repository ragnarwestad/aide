"""Tests for core/scripts/aide-run-spec — the one-shot headless runner
(spec 81, slice 81b).

Criteria 1-4. No test here calls the real Claude CLI: a fake binary on
AIDE_CLAUDE_BIN records its argv and prints a canned result, so the
default suite stays free (pytest.ini deselects the paid markers for the
same reason).

The script's job is the GUARDS, not the invocation — an unguarded
`claude -p` is one line and needs no script. So most of this file is
about what it REFUSES to do, and about leaving the machine in a state
the next run can start from.
"""
import json
import os
import pathlib
import subprocess
import time

import pytest


@pytest.fixture
def runner(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-run-spec"


def git(repo, *args):
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def init_repo(path):
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "-C", str(path), "init", "-q", "-b", "main"], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.name", "Test"], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.email", "test@example.com"], check=True)
    (path / "README.md").write_text("start\n")
    subprocess.run(["git", "-C", str(path), "add", "README.md"], check=True)
    subprocess.run(["git", "-C", str(path), "commit", "-qm", "init"], check=True)
    return path


@pytest.fixture
def workspace(tmp_path):
    """A project repo plus a SEPARATE specs repo, the way a real aide
    project is laid out (AIDE_SPECS_PATH in .aide/config)."""
    project = init_repo(tmp_path / "proj")
    specs = init_repo(tmp_path / "specs")
    (specs / "81-queue-and-runner").mkdir()
    (specs / "81-queue-and-runner" / "1-description.md").write_text("# Queue - Description\n")
    subprocess.run(["git", "-C", str(specs), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(specs), "commit", "-qm", "add spec"], check=True)
    (project / ".aide").mkdir()
    (project / ".aide" / "config").write_text(f"AIDE_SPECS_PATH={specs}\n")
    # -f: the user's global gitignore covers .aide/config, and an
    # untracked file would read as a dirty tree here.
    subprocess.run(["git", "-C", str(project), "add", "-f", ".aide/config"], check=True)
    subprocess.run(["git", "-C", str(project), "commit", "-qm", "add config"], check=True)
    return {"project": project, "specs": specs, "folder": "81-queue-and-runner"}


RESULT_OK = {
    "type": "result", "subtype": "success", "is_error": False,
    "session_id": "ee80227f-510c-45e9-bfbf-c5124f7761c0",
    "total_cost_usd": 0.5357, "num_turns": 1, "terminal_reason": "completed",
    "result": "done",
}
RESULT_BUDGET = {
    "type": "result", "subtype": "error_max_budget_usd", "is_error": True,
    "session_id": "f632eed3-5d7a-40f2-bb40-e3ad6139b8d7",
    "total_cost_usd": 0.2030, "terminal_reason": "budget_exhausted",
    "errors": ["Reached maximum budget ($0.2)"],
}


@pytest.fixture
def fake_claude(tmp_path):
    """Factory for a stand-in `claude`. Records argv, then behaves as
    asked."""
    calls = tmp_path / "claude-calls.txt"

    def make(body: str):
        path = tmp_path / "fake-claude"
        path.write_text(
            "#!/usr/bin/env bash\n"
            f'printf "%s\\n" "$*" >> {calls}\n'
            f'printf "%s\\n" "$PWD" >> {tmp_path / "claude-cwd.txt"}\n'
            f"{body}\n"
        )
        path.chmod(0o755)
        return path

    make.calls = calls  # type: ignore[attr-defined]
    make.cwd_log = tmp_path / "claude-cwd.txt"  # type: ignore[attr-defined]
    return make


def run(runner, ws, claude=None, **kwargs):
    """Invoke the runner; return (returncode, parsed json line, stdout)."""
    args = [str(kwargs.pop("runner_path", runner))]
    defaults = {
        "--project-dir": str(ws["project"]),
        "--command": "analyze",
        "--spec": ws["folder"],
        "--budget-usd": "3",
        "--timeout-sec": "30",
        "--permission-mode": "acceptEdits",
        "--result-file": str(ws["project"].parent / "result.json"),
    }
    for key, value in kwargs.items():
        flag = "--" + key.replace("_", "-")
        if value is None:
            defaults.pop(flag, None)
        elif value is True:
            defaults[flag] = None
        else:
            defaults[flag] = str(value)
    for flag, value in defaults.items():
        args.append(flag)
        if value is not None:
            args.append(value)
    env = dict(os.environ)
    if claude:
        env["AIDE_CLAUDE_BIN"] = str(claude)
    proc = subprocess.run(args, capture_output=True, text=True, env=env)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line), proc.stdout


# --- Criterion 1: the dry run ------------------------------------------------

def test_dry_run_prints_the_argv_it_would_use_and_spawns_nothing(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")  # would fail loudly if it were called
    rc, out, _ = run(
        runner, workspace, claude,
        command="implement", budget_usd="3", timeout_sec="1200",
        permission_mode="bypassPermissions", dry_run=True,
    )
    assert rc == 0
    argv = out["argv"]
    assert argv[0] == str(claude), "the claude path must be resolved, never a bare name"
    assert "-p" in argv
    assert argv[argv.index("--output-format") + 1] == "json"
    assert argv[argv.index("--max-budget-usd") + 1] == "3"
    assert argv[argv.index("--permission-mode") + 1] == "bypassPermissions"
    # The spec ID is the folder's numeric prefix.
    assert out["prompt"] == "/aide-implement 81"
    assert not fake_claude.calls.exists(), "a dry run must not invoke claude"


# --- Criterion 2: the refusals -----------------------------------------------

def test_refuses_a_dirty_project_tree(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    (workspace["project"] / "scratch.txt").write_text("uncommitted\n")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 2
    assert out["ok"] is False
    assert "dirty" in out["error"]
    assert not fake_claude.calls.exists()


def test_refuses_a_dirty_specs_root(runner, workspace, fake_claude):
    """The specs repo is where /aide-analyze actually writes — a check
    that only looks at the project misses the repo that matters."""
    claude = fake_claude("exit 1")
    (workspace["specs"] / "stray.md").write_text("uncommitted\n")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 2
    assert "dirty" in out["error"]
    assert "specs" in out["error"].lower() or str(workspace["specs"]) in out["error"]
    assert not fake_claude.calls.exists()


@pytest.mark.parametrize(
    "kwargs,fragment",
    [
        ({"budget_usd": None}, "budget"),
        ({"permission_mode": None}, "permission"),
        ({"timeout_sec": None}, "timeout"),
        ({"result_file": None}, "result-file"),
        ({"command": "review"}, "command"),
        ({"spec": "99-nope"}, "spec"),
    ],
)
def test_refuses_bad_arguments(runner, workspace, fake_claude, kwargs, fragment):
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude, **kwargs)
    assert rc == 2, out
    assert out["ok"] is False
    assert fragment in out["error"].lower()
    assert not fake_claude.calls.exists()


def test_refuses_a_directory_that_is_not_a_git_repo(runner, workspace, fake_claude, tmp_path):
    claude = fake_claude("exit 1")
    plain = tmp_path / "plain"
    plain.mkdir()
    rc, out, _ = run(runner, {**workspace, "project": plain}, claude)
    assert rc == 2
    assert "git" in out["error"].lower()


# --- Criterion 3: carrying the result through --------------------------------

def test_a_successful_run_carries_cost_session_and_subtype(runner, workspace, fake_claude):
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert out["ok"] is True
    assert out["terminalReason"] == "completed"
    assert out["subtype"] == "success"
    assert out["sessionId"] == RESULT_OK["session_id"]
    assert out["costUsd"] == pytest.approx(0.5357)
    assert out["costMeasured"] is True
    roots = {r["root"]: r for r in out["repos"]}
    assert str(workspace["project"]) in roots
    assert str(workspace["specs"]) in roots


def test_the_run_happens_inside_the_project_not_the_callers_directory(runner, workspace, fake_claude):
    """A skill resolves the project from its working directory. The
    first real job ran with the server's cwd and analysed the wrong
    repository — it cost $0.45 to find out, so it gets a test."""
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert fake_claude.cwd_log.read_text().strip() == str(workspace["project"].resolve())


def test_survives_its_own_file_being_replaced_mid_run(runner, workspace, fake_claude, tmp_path):
    """An aide `implement` step reinstalls aide, which copies this very
    script over itself. Bash reads a script incrementally from disk, so
    without a private copy the runner dies mid-job — measured on the
    first end-to-end run, eight minutes in, after the work had already
    succeeded."""
    copy = tmp_path / "aide-run-spec-under-test"
    copy.write_bytes(pathlib.Path(runner).read_bytes())
    copy.chmod(0o755)
    # The shared library lives beside the script; the copy resolves it
    # from the ORIGINAL directory, so give this stand-in one too.
    (tmp_path / "_aide-spec-lib.sh").write_bytes(
        (pathlib.Path(runner).parent / "_aide-spec-lib.sh").read_bytes()
    )
    # The fake claude overwrites the running script, exactly as the
    # installer would.
    claude = fake_claude(
        "cat > /dev/null\n"
        f'printf "#!/bin/bash\\necho REPLACED\\n" > {copy}\n'
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, runner_path=copy)
    assert rc == 0, out
    assert out["terminalReason"] == "completed", "the run must finish even though its file was replaced"
    assert copy.read_text().startswith("#!/bin/bash"), "the replacement really happened"


def test_budget_exhausted_is_stopped_not_a_generic_failure(runner, workspace, fake_claude):
    """A cap-stop is a common, healthy outcome under tight caps. It must
    be distinguishable from an agent that broke."""
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_BUDGET)}'; exit 1")
    rc, out, _ = run(runner, workspace, claude)
    assert out["terminalReason"] == "budget"
    assert out["subtype"] == "error_max_budget_usd"
    assert out["costUsd"] == pytest.approx(0.2030)
    assert out["costMeasured"] is True


def test_the_result_file_is_written_as_well_as_stdout(runner, workspace, fake_claude):
    claude = fake_claude(f"cat > /dev/null; echo '{json.dumps(RESULT_OK)}'")
    result_file = workspace["project"].parent / "result.json"
    rc, out, _ = run(runner, workspace, claude, result_file=result_file)
    assert result_file.exists(), "a detached child has no pipe home: the file IS the contract"
    assert json.loads(result_file.read_text())["sessionId"] == out["sessionId"]


def test_work_is_committed_on_a_branch_in_both_roots(runner, workspace, fake_claude):
    claude = fake_claude(
        "cat > /dev/null\n"
        f'echo "written by the step" > "{workspace["project"]}/new-code.txt"\n'
        f'echo "analysis" > "{workspace["specs"]}/{workspace["folder"]}/2-analysis.md"\n'
        f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    assert git(workspace["project"], "rev-parse", "--abbrev-ref", "HEAD") == "aide/81-queue-and-runner"
    assert "analyze" in git(workspace["project"], "log", "-1", "--pretty=%s")
    assert "analyze" in git(workspace["specs"], "log", "-1", "--pretty=%s")
    # Both roots clean afterwards: an uncommitted leftover would block
    # every later run through the dirty-tree refusal.
    assert git(workspace["project"], "status", "--porcelain") == ""
    assert git(workspace["specs"], "status", "--porcelain") == ""
    roots = {r["root"]: r for r in out["repos"]}
    assert roots[str(workspace["project"])]["changedFiles"] == 1
    assert roots[str(workspace["specs"])]["changedFiles"] == 1


# --- Criterion 4: the graceful stop ------------------------------------------

def test_a_run_past_its_deadline_is_killed_and_reported_as_stopped(runner, workspace, fake_claude):
    claude = fake_claude(
        "cat > /dev/null\n"
        f'echo "half-written" > "{workspace["project"]}/half.txt"\n'
        "trap '' TERM\n"
        "while true; do sleep 0.2; done"
    )
    started = time.time()
    rc, out, _ = run(runner, workspace, claude, timeout_sec="2", kill_grace_sec="1")
    elapsed = time.time() - started

    assert out["terminalReason"] == "timeout"
    assert out["ok"] is False
    # A SIGKILLed claude prints nothing, so the cost cannot be measured.
    # The accounting must over-charge what it could not measure.
    assert out["costUsd"] == pytest.approx(3.0)
    assert out["costMeasured"] is False
    assert elapsed < 12, f"the kill took too long: {elapsed:.1f}s"

    result_file = workspace["project"].parent / "result.json"
    assert result_file.exists(), "a stop must always leave a result file"
    assert json.loads(result_file.read_text())["terminalReason"] == "timeout"

    # Whatever the step managed to write is committed, with the reason,
    # so the tree is clean for the next run.
    assert git(workspace["project"], "status", "--porcelain") == ""
    assert "stopped: timeout" in git(workspace["project"], "log", "-1", "--pretty=%s%n%b")


def test_a_stopped_run_is_charged_its_budget_even_when_it_flushes_json(runner, workspace, fake_claude):
    """Measured on the mini 2026-08-16: a SIGTERM'd `claude -p` DOES
    flush its result JSON — but with subtype error_during_execution and
    total_cost_usd 0. Trusting that number would under-charge exactly
    the runs that ran longest, so a stop is charged its full budget
    whether or not a result was written."""
    flushed = {
        "type": "result", "subtype": "error_during_execution",
        "is_error": True, "session_id": "abc", "total_cost_usd": 0,
    }
    claude = fake_claude(
        "cat > /dev/null\n"
        f"trap 'echo {json.dumps(json.dumps(flushed))}; exit 143' TERM\n"
        "while true; do sleep 0.2; done"
    )
    rc, out, _ = run(runner, workspace, claude, timeout_sec="2", kill_grace_sec="5")
    assert out["terminalReason"] == "timeout"
    assert out["costUsd"] == pytest.approx(3.0), "the flushed $0 must not be believed"
    assert out["costMeasured"] is False


def test_a_child_that_exits_on_sigterm_is_never_sigkilled(runner, workspace, fake_claude, tmp_path):
    marker = tmp_path / "term-seen"
    claude = fake_claude(
        "cat > /dev/null\n"
        f"trap 'echo yes > {marker}; exit 0' TERM\n"
        "while true; do sleep 0.2; done"
    )
    started = time.time()
    rc, out, _ = run(runner, workspace, claude, timeout_sec="2", kill_grace_sec="8")
    elapsed = time.time() - started
    assert marker.exists(), "SIGTERM must reach the child"
    assert elapsed < 9, "the run should end when the child exits, not wait out the whole grace"
    assert out["terminalReason"] == "timeout"
