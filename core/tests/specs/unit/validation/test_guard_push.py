"""scripts/guard-push: the Claude Code hook that holds a `git push` while an archive is landing on the board."""
import json
import subprocess
import sys
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[5]
SCRIPT = WORKSPACE / "scripts" / "guard-push"

ARCHIVE_RUNNING = {"project": "aide", "specFolder": "640-deploy", "state": "running", "steps": ["implement", "archive"],
                   "stepIndex": 1}
IMPLEMENT_RUNNING = {"project": "aide", "specFolder": "641-log", "state": "running", "steps": ["implement", "archive"],
                     "stepIndex": 0}


def guard(tmp_path, command, queue=None, host=None, ssh_queue=None):
    """Run the hook as Claude Code does: the tool call as JSON on stdin. `queue` is the board's mirror on this
    machine; `ssh_queue` what a stand-in ssh prints for the board host."""
    home = tmp_path / "home"
    if queue is not None:
        (home / ".aide" / "dashboard").mkdir(parents=True, exist_ok=True)
        (home / ".aide" / "dashboard" / "aide-queue.json").write_text(json.dumps(queue))
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    ssh = bin_dir / "ssh"
    if ssh_queue is None:
        ssh.write_text("#!/bin/sh\necho 'ssh: connect to host board: Connection refused' >&2\nexit 255\n")
    else:
        (tmp_path / "remote-queue.json").write_text(json.dumps(ssh_queue))
        ssh.write_text(f"#!/bin/sh\necho \"$@\" > {tmp_path / 'ssh-args'}\ncat {tmp_path / 'remote-queue.json'}\n")
    ssh.chmod(0o755)
    env = {"HOME": str(home), "PATH": f"{bin_dir}:/usr/bin:/bin"}
    if host:
        env["AIDE_BOARD_HOST"] = host
    payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})
    return subprocess.run([sys.executable, str(SCRIPT)], input=payload, capture_output=True, text=True, env=env)


def test_a_command_that_does_not_push_passes_without_reading_the_queue(tmp_path):
    assert guard(tmp_path, "git status -sb && git log --oneline -1").returncode == 0


def test_a_push_while_an_archive_runs_is_blocked_and_names_the_spec(tmp_path):
    done = guard(tmp_path, "git pull --rebase -q && git push -q", queue=[ARCHIVE_RUNNING])
    assert done.returncode == 2
    assert "640-deploy" in done.stderr


def test_a_push_while_a_job_is_landing_is_blocked(tmp_path):
    landing = {**IMPLEMENT_RUNNING, "state": "done", "landing": True}
    assert guard(tmp_path, "git -C ~/develop/aide push", queue={"jobs": [landing]}).returncode == 2


def test_a_push_with_no_archive_running_passes(tmp_path):
    assert guard(tmp_path, "git push", queue=[IMPLEMENT_RUNNING]).returncode == 0


def test_away_from_the_board_the_queue_is_read_over_ssh_from_the_board_host(tmp_path):
    done = guard(tmp_path, "git push", host="board", ssh_queue=[ARCHIVE_RUNNING])
    assert done.returncode == 2
    assert "board" in (tmp_path / "ssh-args").read_text()
    assert guard(tmp_path, "git push", host="board", ssh_queue=[]).returncode == 0


def test_a_queue_that_cannot_be_read_blocks_the_push_and_says_so(tmp_path):
    unreachable = guard(tmp_path, "git push", host="board")
    assert unreachable.returncode == 2
    assert "could not be read" in unreachable.stderr
    assert guard(tmp_path, "git push").returncode == 2  # no board here, and no host named to read it from


def test_the_hook_is_wired_to_bash_calls_for_a_session_started_at_the_root_or_in_dashboard():
    # Claude Code reads a project's settings from the folder the session starts in, not from the folders above it.
    for folder, script in ((WORKSPACE, "$CLAUDE_PROJECT_DIR/scripts/guard-push"),
                           (WORKSPACE / "dashboard", "$CLAUDE_PROJECT_DIR/../scripts/guard-push")):
        settings = json.loads((folder / ".claude" / "settings.json").read_text())
        hooks = [h for entry in settings["hooks"]["PreToolUse"] if entry["matcher"] == "Bash" for h in entry["hooks"]]
        assert any(script in h["command"] for h in hooks), folder
        assert (folder / script.replace("$CLAUDE_PROJECT_DIR/", "")).resolve() == SCRIPT
