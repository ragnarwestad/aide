"""Tests for core/scripts/aide-worktree-setup: the one place a worktree's
setup command, the manifest's `worktreeSetup`, is read, run and judged.

The runner, the test server and the Merge each call it; what they share —
which key, how it runs, what counts as failure, how much output the
failure keeps — is proven here once.
"""
import json
import subprocess
import time

import pytest


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-worktree-setup"


@pytest.fixture
def manifest_dir(tmp_path):
    root = tmp_path / "checkout"
    (root / ".aide").mkdir(parents=True)
    return root


@pytest.fixture
def worktree(tmp_path):
    wt = tmp_path / "worktree"
    wt.mkdir()
    return wt


def setup_command(manifest_dir, command):
    (manifest_dir / ".aide" / "project.yaml").write_text(f"name: demo\nworktreeSetup: {command}\n")


def run(script, worktree, manifest_dir, *extra):
    proc = subprocess.run(
        [str(script), "--dir", str(worktree), "--manifest-dir", str(manifest_dir), *extra],
        capture_output=True, text=True, stdin=subprocess.DEVNULL,
    )
    return proc.returncode, json.loads(proc.stdout.strip().splitlines()[-1]), proc.stderr


def test_without_the_key_nothing_runs_and_nothing_is_written_ac_8(script, worktree, manifest_dir):
    (manifest_dir / ".aide" / "project.yaml").write_text("name: demo\nworktreeLinks: deps\n")
    code, answer, err = run(script, worktree, manifest_dir)
    assert code == 0
    assert answer == {"ok": True, "ran": False}
    assert err == ""


def test_without_a_manifest_nothing_runs_ac_8(script, worktree, tmp_path):
    code, answer, err = run(script, worktree, tmp_path / "nowhere")
    assert code == 0
    assert answer == {"ok": True, "ran": False}
    assert err == ""


def test_the_command_runs_at_the_worktree_root_and_its_output_and_time_are_logged_ac_1_ac_4(
    script, worktree, manifest_dir,
):
    setup_command(manifest_dir, "echo installing-deps; pwd > where.txt")
    code, answer, err = run(script, worktree, manifest_dir)
    assert code == 0
    assert answer["ok"] is True and answer["ran"] is True
    assert answer["command"] == "echo installing-deps; pwd > where.txt"
    assert isinstance(answer["seconds"], int)
    assert (worktree / "where.txt").read_text().strip() == str(worktree.resolve())
    lines = err.strip().splitlines()
    assert lines[0] == "worktree setup: echo installing-deps; pwd > where.txt"
    assert "installing-deps" in lines
    assert lines[-1].startswith("worktree setup: done in ") and lines[-1].endswith("s")


def test_a_failing_command_answers_with_its_exit_code_and_last_lines_ac_5_ac_6_ac_7(
    script, worktree, manifest_dir,
):
    setup_command(manifest_dir, "for i in $(seq 1 30); do echo line-$i; done; echo broken-lockfile; exit 3")
    code, answer, err = run(script, worktree, manifest_dir)
    assert code == 1
    assert answer["ok"] is False and answer["ran"] is True
    assert answer["exitCode"] == 3
    assert "broken-lockfile" in answer["tail"]
    tail = answer["tail"].splitlines()
    assert len(tail) == 20
    assert tail[-1] == "broken-lockfile"
    lines = err.strip().splitlines()
    # The failure line is the last line written: a reader of the log takes
    # the command's own output from above it.
    assert lines[-1].startswith("worktree setup failed: for i in")
    assert "exited 3 after" in lines[-1]
    assert lines[-2] == "broken-lockfile"


def test_a_command_that_does_not_finish_in_time_is_a_failure_ac_5_ac_6(script, worktree, manifest_dir):
    setup_command(manifest_dir, "echo started; sleep 37.3; echo never")
    began = time.monotonic()
    code, answer, err = run(script, worktree, manifest_dir, "--timeout", "1")
    assert time.monotonic() - began < 15
    assert code == 1
    assert answer["ok"] is False and answer["timedOut"] is True
    assert "started" in answer["tail"]
    assert "never" not in err.splitlines()
    assert err.strip().splitlines()[-1].endswith("did not finish within 1s")
    time.sleep(0.3)
    left = subprocess.run(["pgrep", "-f", "sleep 37.3"], capture_output=True, text=True).stdout.strip()
    assert left == ""


def test_the_command_cannot_wait_for_input(script, worktree, manifest_dir):
    setup_command(manifest_dir, "read -r answer; echo got-$answer")
    code, answer, _ = run(script, worktree, manifest_dir, "--timeout", "10")
    assert code == 0
    assert answer["ok"] is True


def test_a_missing_dir_is_refused(script, manifest_dir, tmp_path):
    code, answer, _ = run(script, tmp_path / "absent", manifest_dir)
    assert code == 2
    assert answer["ok"] is False and answer["exitCode"] == 2
    assert "--dir" in answer["error"]


def test_a_stop_signal_to_the_callers_process_group_stops_the_setup_too_ac_6_ac_7(
    script, worktree, manifest_dir,
):
    """Cancel on a Merge and Stop on a test server signal the process group
    they started; the setup runs in a group of its own and must go with it."""
    import os
    import signal

    setup_command(manifest_dir, "touch began; sleep 3; touch survived")
    proc = subprocess.Popen(
        [str(script), "--dir", str(worktree), "--manifest-dir", str(manifest_dir)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, text=True,
        start_new_session=True,
    )
    try:
        deadline = time.monotonic() + 10
        while not (worktree / "began").exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        assert (worktree / "began").exists()
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=10)
        time.sleep(4)
        assert not (worktree / "survived").exists()
    finally:
        if proc.poll() is None:
            proc.kill()
