"""Tests for core/scripts/aide-emit-run — the phase reporter an
/aide-implement run calls at each TDD phase boundary.

It is called from a line in the skill, never from a hook: it must never
write to stdout, must always exit 0, must never read stdin, and must stay
inert unless AIDE_RUN_URL is set (aide ships generic).
"""
import json
import os
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest


@pytest.fixture
def emitter(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-emit-run"


class _Listener:
    """A throwaway HTTP listener capturing POST bodies."""

    def __init__(self):
        self.received = []
        listener = self

        class Handler(BaseHTTPRequestHandler):
            # http.server calls the handler by this name.
            # noinspection PyPep8Naming
            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                listener.received.append(json.loads(self.rfile.read(length)))
                self.send_response(200)
                self.end_headers()

            def log_message(self, *_):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}/api/aide-run"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def wait(self, count=1, timeout=15.0):
        deadline = time.time() + timeout
        while time.time() < deadline and len(self.received) < count:
            time.sleep(0.05)
        return self.received

    def close(self):
        self.server.shutdown()


@pytest.fixture
def listener():
    lst = _Listener()
    yield lst
    lst.close()


def run_phase(emitter, cwd, *args, url=None, session_id="abc-123"):
    """Phase mode: called from a skill, NOT from a hook — so there is no
    JSON on stdin and the session id comes from the environment.

    stdin is a pipe nobody ever writes to or closes: a phase call that
    read it would hang the implement step it is reporting from, and this
    turns that into a failed test rather than a stuck run.
    """
    env = dict(os.environ)
    env.pop("AIDE_RUN_URL", None)
    env.pop("CLAUDE_SESSION_ID", None)
    if url:
        env["AIDE_RUN_URL"] = url
    if session_id:
        env["CLAUDE_SESSION_ID"] = session_id
    read_fd, write_fd = os.pipe()
    try:
        proc = subprocess.Popen(
            [str(emitter), *args], stdin=read_fd, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, env=env, cwd=str(cwd),
        )
        os.close(read_fd)
        stdout, stderr = proc.communicate(timeout=10)
    finally:
        os.close(write_fd)
    return subprocess.CompletedProcess(proc.args, proc.returncode, stdout, stderr)


@pytest.fixture
def git_repo(tmp_path):
    repo = tmp_path / "myproj"
    repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    return repo


@pytest.mark.claude_code
class TestPhaseMode:
    """Reporting a TDD phase boundary
    from inside an /aide-implement run.

    This stage handles sub-phase events. Pausing inside a step
    is ruled out (print mode has nobody to answer a question), but
    REPORTING from inside one is a different thing: one command at each
    phase boundary, still silent, still exit 0, still inert without
    AIDE_RUN_URL.
    """

    def test_a_phase_event_carries_the_phase_the_spec_and_the_session(
        self, emitter, listener, git_repo
    ):
        result = run_phase(
            emitter, git_repo, "--phase", "green", "--spec", "81", url=listener.url,
        )
        assert result.returncode == 0
        assert result.stdout == ""
        got = listener.wait()
        assert len(got) == 1, "the emitter never POSTed"
        event = got[0]
        assert event["phase"] == "green"
        assert event["spec"] == "81"
        assert event["command"] == "implement", "phases only exist inside an implement run"
        assert event["sessionId"] == "abc-123", "print mode has no hook JSON: the id comes from the environment"
        assert event["project"] == "myproj"

    @pytest.mark.parametrize("phase", ["red", "green", "verify"])
    def test_every_tdd_phase_is_accepted(self, emitter, listener, git_repo, phase):
        run_phase(emitter, git_repo, "--phase", phase, "--spec", "81", url=listener.url)
        got = listener.wait()
        assert len(got) == 1
        assert got[0]["phase"] == phase

    def test_an_unknown_phase_sends_nothing(self, emitter, listener, git_repo):
        result = run_phase(
            emitter, git_repo, "--phase", "deploy", "--spec", "81", url=listener.url,
        )
        assert result.returncode == 0
        assert listener.wait(timeout=0.7) == []

    def test_without_a_session_id_nothing_is_sent(self, emitter, listener, git_repo):
        """The session id is what joins this event to the run on /live.
        Without one there is nothing to attach the phase to."""
        result = run_phase(
            emitter, git_repo, "--phase", "red", "--spec", "81",
            url=listener.url, session_id=None,
        )
        assert result.returncode == 0
        assert listener.wait(timeout=0.7) == []

    def test_phase_mode_is_inert_without_the_url(self, emitter, listener, git_repo):
        result = run_phase(emitter, git_repo, "--phase", "red", "--spec", "81", url=None)
        assert result.returncode == 0
        assert result.stdout == ""
        assert listener.wait(timeout=0.7) == []

    def test_an_unreachable_url_still_exits_zero_silently(self, emitter, git_repo):
        result = run_phase(
            emitter, git_repo, "--phase", "verify", "--spec", "81",
            url="http://127.0.0.1:9/api/aide-run",
        )
        assert result.returncode == 0
        assert result.stdout == ""


@pytest.mark.claude_code
class TestImplementSkillReportsItsPhases:
    def test_the_skill_reports_each_tdd_phase(self, workspace_root):
        """The events are worth nothing if the skill never sends them —
        the design puts one line in each TDD phase."""
        skill = (workspace_root / "core" / "skills" / "aide-implement" / "SKILL.md").read_text()
        for phase in ("red", "green", "verify"):
            assert f"aide-emit-run --phase {phase}" in skill, (
                f"the {phase.upper()} phase must report its boundary"
            )


@pytest.mark.claude_code
class TestThereIsNoPromptHook:
    def test_a_call_without_arguments_posts_nothing_AC_6(self, emitter, listener, git_repo):
        env = dict(os.environ, AIDE_RUN_URL=listener.url)
        prompt = {"session_id": "abc-123", "cwd": str(git_repo), "prompt": " /aide-implement 80",
                  "hook_event_name": "UserPromptSubmit"}

        result = subprocess.run(
            [str(emitter)], input=json.dumps(prompt), capture_output=True,
            text=True, env=env, timeout=30,
        )

        assert result.returncode == 0
        assert result.stdout == ""
        assert listener.wait(timeout=0.7) == []

    def test_the_reference_settings_call_aide_emit_run_from_no_hook_AC_6(self, workspace_root):
        settings = json.loads(
            (workspace_root / "core" / "implementations" / "claude-code" / "settings.json").read_text()
        )
        commands = [
            hook["command"]
            for groups in settings["hooks"].values()
            for group in groups
            for hook in group["hooks"]
            if hook["type"] == "command"
        ]
        assert not [c for c in commands if "aide-emit-run" in c]

    def test_the_installer_prints_no_settings_block_for_a_hook_AC_6(self, workspace_root, tmp_path):
        result = subprocess.run(
            [str(workspace_root / "core" / "implementations" / "claude-code" / "install.sh")],
            capture_output=True, text=True, timeout=300,
            env={"HOME": str(tmp_path / "home"), "PATH": "/usr/bin:/bin"},
        )

        assert result.returncode == 0, result.stderr
        assert "UserPromptSubmit" not in result.stdout
        assert "AIDE_RUN_URL" not in result.stdout
        assert "aide-emit-run" in result.stdout, "the script is still installed, for phase mode"
