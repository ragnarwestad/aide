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
ARCHIVE_LANDING = {**ARCHIVE_RUNNING, "state": "done", "landing": True}


AIDE = "git@github.com:ragnarwestad/aide.git"
SPECS = "git@github.com:ragnarwestad/aide-specs.git"
SKJERA = "git@github.com:capraconsulting/skjera.git"
CHECKOUTS = {"aide": {"code": AIDE, "specs": SPECS}, "skjera": {"code": SKJERA, "specs": SPECS}}


def repo(tmp_path, name, origin):
    """A checkout whose origin is `origin`, for a push to run in."""
    path = tmp_path / name
    path.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(path)], check=True)
    subprocess.run(["git", "-C", str(path), "remote", "add", "origin", origin], check=True)
    return path


def board_checkouts(home, checkouts):
    """The board's own checkouts of each project, `checkouts/<project>/{code,specs}`, with their origins."""
    for project, roots in checkouts.items():
        for root, origin in roots.items():
            path = home / ".aide" / "dashboard" / "checkouts" / project / root
            if path.exists():
                continue
            path.mkdir(parents=True)
            subprocess.run(["git", "init", "-q", str(path)], check=True)
            subprocess.run(["git", "-C", str(path), "remote", "add", "origin", origin], check=True)


def guard(tmp_path, command, queue=None, host=None, ssh_queue=None, checkouts=None, cwd=None, ssh_origins=None):
    """Run the hook as Claude Code does: the tool call as JSON on stdin. `queue` is the board's mirror on this
    machine, `checkouts` the board's own checkouts beside it; `ssh_queue` and `ssh_origins` what a stand-in ssh
    prints for the board host when asked for the queue and for a project's origins."""
    home = tmp_path / "home"
    if queue is not None:
        (home / ".aide" / "dashboard").mkdir(parents=True, exist_ok=True)
        (home / ".aide" / "dashboard" / "aide-queue.json").write_text(json.dumps(queue))
    if checkouts:
        board_checkouts(home, checkouts)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    ssh = bin_dir / "ssh"
    if ssh_queue is None:
        ssh.write_text("#!/bin/sh\necho 'ssh: connect to host board: Connection refused' >&2\nexit 255\n")
    else:
        (tmp_path / "remote-queue.json").write_text(json.dumps(ssh_queue))
        (tmp_path / "remote-origins").write_text("".join(f"{o}\n" for o in (ssh_origins or [])))
        ssh.write_text(f"#!/bin/sh\necho \"$@\" >> {tmp_path / 'ssh-args'}\n"
                       f"case \"$*\" in *get-url*) cat {tmp_path / 'remote-origins'};; "
                       f"*) cat {tmp_path / 'remote-queue.json'};; esac\n")
    ssh.chmod(0o755)
    env = {"HOME": str(home), "PATH": f"{bin_dir}:/usr/bin:/bin"}
    if host:
        env["AIDE_BOARD_HOST"] = host
    payload = {"tool_name": "Bash", "tool_input": {"command": command}}
    if cwd:
        payload["cwd"] = str(cwd)
    return subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps(payload), capture_output=True, text=True,
                          env=env)


def test_a_command_that_does_not_push_passes_without_reading_the_queue(tmp_path):
    assert guard(tmp_path, "git status -sb && git log --oneline -1").returncode == 0


def test_a_push_to_the_landing_projects_code_repo_is_blocked_and_names_the_spec(tmp_path):
    aide = repo(tmp_path, "aide", "https://github.com/ragnarwestad/aide")
    done = guard(tmp_path, "git pull --rebase -q && git push -q", queue={"jobs": [ARCHIVE_LANDING]},
                 checkouts=CHECKOUTS, cwd=aide)
    assert done.returncode == 2
    assert "640-deploy" in done.stderr


def test_a_push_to_another_projects_repo_passes_while_one_lands(tmp_path):
    aide = repo(tmp_path, "aide", AIDE)
    skjera_landing = {**ARCHIVE_LANDING, "project": "skjera"}
    assert guard(tmp_path, f"git -C {aide} push", queue=[skjera_landing], checkouts=CHECKOUTS).returncode == 0
    assert guard(tmp_path, "cd ~/x && git push", queue=[skjera_landing], checkouts=CHECKOUTS,
                 cwd=aide).returncode == 2, "a cd the hook cannot follow to a repo is not a repo it knows"


def test_a_push_to_a_specs_repo_another_project_lands_into_is_blocked(tmp_path):
    specs = repo(tmp_path, "aide-specs", SPECS)
    skjera_landing = {**ARCHIVE_LANDING, "project": "skjera"}
    assert guard(tmp_path, f"cd {specs} && git push", queue=[skjera_landing], checkouts=CHECKOUTS).returncode == 2


def test_a_push_is_blocked_when_the_landing_projects_repos_cannot_be_read(tmp_path):
    aide = repo(tmp_path, "aide", AIDE)
    assert guard(tmp_path, "git push", queue=[{**ARCHIVE_LANDING, "project": "skjera"}], cwd=aide).returncode == 2


def test_a_push_while_an_archive_step_runs_before_its_landing_passes(tmp_path):
    assert guard(tmp_path, "git -C ~/develop/aide push", queue={"jobs": [ARCHIVE_RUNNING]}).returncode == 0


def test_a_push_with_nothing_landing_passes(tmp_path):
    assert guard(tmp_path, "git push", queue=[IMPLEMENT_RUNNING]).returncode == 0


def test_away_from_the_board_the_queue_and_the_origins_are_read_over_ssh_from_the_board_host(tmp_path):
    aide = repo(tmp_path, "aide", AIDE)
    done = guard(tmp_path, "git push", host="board", ssh_queue=[ARCHIVE_LANDING], ssh_origins=[AIDE, SPECS], cwd=aide)
    assert done.returncode == 2
    assert "board" in (tmp_path / "ssh-args").read_text()
    other = guard(tmp_path, "git push", host="board", ssh_queue=[{**ARCHIVE_LANDING, "project": "skjera"}],
                  ssh_origins=[SKJERA, SPECS], cwd=aide)
    assert other.returncode == 0, other.stderr
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
