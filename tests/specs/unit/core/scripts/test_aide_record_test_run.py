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


# --- one suite at a time per machine ----------------------------------------
#
# The suite runs on every core it can find, and the tests that measure
# time run alone after it; two suites on one host at once is what made
# those tests red four archives in a row (2026-09-02). So the script
# takes a lock per machine before it runs anything, and a run that
# already sits under that lock — the tests a gate runs, which call this
# very script — skips it, or the gate would wait for itself.


def lock_env(tmp_path):
    """The machine lock, pointed at a private path, with the suite's own
    'already under the lock' mark (tests/conftest.py) taken away so the
    script actually locks."""
    import os
    env = {k: v for k, v in os.environ.items() if k != "AIDE_TEST_LOCK_HELD"}
    env["AIDE_TEST_LOCK"] = str(tmp_path / "test.lock")
    return env


def test_two_runs_on_one_machine_never_overlap(script, project, specs_root, tmp_path):
    import os
    import time
    log = tmp_path / "spans"
    now = "$(python3 -c 'import time;print(time.time())')"
    cmd = f"echo start $$ {now} >> {log}; sleep 1; echo end $$ {now} >> {log}"
    env = lock_env(tmp_path)
    (specs_root / "82-y").mkdir()
    args = lambda folder: [str(script), "--project-dir", str(project), "--specs-root", str(specs_root),
                           "--folder", folder, "--cmd", cmd]
    a = subprocess.Popen(args("81-x"), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    time.sleep(0.2)
    b = subprocess.Popen(args("82-y"), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    a.wait(timeout=30); b.wait(timeout=30)
    assert a.returncode == 0 and b.returncode == 0
    spans = {}
    for line in log.read_text().splitlines():
        kind, pid, at = line.split()
        spans.setdefault(pid, {})[kind] = float(at)
    (s1, s2) = sorted(spans.values(), key=lambda s: s["start"])
    assert s2["start"] >= s1["end"], f"the second run started before the first ended: {spans}"
    assert "waiting for the machine's test lock" in b.stderr.read()
    assert not (tmp_path / "test.lock").exists(), "the lock is released when the run ends"


def test_a_lock_left_by_a_dead_run_is_taken_over(script, project, specs_root, tmp_path):
    env = lock_env(tmp_path)
    stale = tmp_path / "test.lock"
    stale.mkdir()
    (stale / "pid").write_text("999999999\n")   # no such process
    rc, out, _ = run_env(script, project, specs_root, "81-x", "true", env)
    assert rc == 0 and out["exitCode"] == 0
    assert not stale.exists()


def test_a_run_already_under_the_lock_does_not_wait_for_it(script, project, specs_root, tmp_path):
    """The tests a gate runs call this script themselves; they inherit
    the gate's mark and must not queue behind the gate that is running
    them."""
    env = lock_env(tmp_path)
    held = tmp_path / "test.lock"
    held.mkdir()
    (held / "pid").write_text(str(__import__("os").getpid()) + "\n")   # a live holder: this test
    env["AIDE_TEST_LOCK_HELD"] = str(held)
    rc, out, _ = run_env(script, project, specs_root, "81-x", "true", env)
    assert rc == 0 and out["exitCode"] == 0
    assert held.exists(), "a nested run neither takes nor releases the outer lock"


def run_env(script, project, specs_root, folder, cmd, env):
    args = [str(script), "--project-dir", str(project), "--specs-root", str(specs_root),
            "--folder", folder, "--cmd", cmd]
    proc = subprocess.run(args, capture_output=True, text=True, env=env, timeout=30)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line), proc.stdout
