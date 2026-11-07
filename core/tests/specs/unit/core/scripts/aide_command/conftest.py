"""What the tests of core/scripts/aide share: a stand-in for the board that
answers per method and path and reads each body by its Content-Type as the
board does, and a machine with a home, a checkout of `demo` and a specs
repository with an origin.
"""
import json
import os
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

import pytest


class Board:
    """A board stand-in. Every request is recorded with its method, path,
    Content-Type and body. A body is read as a form when its Content-Type
    says so and as JSON otherwise, which is how the board reads one; `form`
    tells which."""

    def __init__(self):
        self.requests = []
        self.answers = {}
        board = self

        class Handler(BaseHTTPRequestHandler):
            def _handle(self):
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length).decode() if length else ""
                content_type = self.headers.get("Content-Type", "")
                form = "application/x-www-form-urlencoded" in content_type
                if form:
                    parsed = {key: values[0] for key, values in parse_qs(raw).items()}
                else:
                    try:
                        parsed = json.loads(raw) if raw else None
                    except ValueError:
                        parsed = None
                board.requests.append({
                    "method": self.command, "path": self.path,
                    "content_type": content_type, "form": form, "body": parsed,
                })
                status, body, delay = board.answers.get(
                    (self.command, self.path), (404, "not found", 0))
                if delay:
                    time.sleep(delay)
                data = (json.dumps(body) if isinstance(body, (dict, list)) else body).encode()
                self.send_response(status)
                self.send_header("Content-Type",
                                 "application/json" if isinstance(body, (dict, list)) else "text/plain")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                try:
                    self.wfile.write(data)
                except OSError:
                    pass  # the client gave up waiting

            do_GET = do_POST = _handle

            def log_message(self, *_):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        for project in ("demo", "other"):
            self.answer("POST", f"/api/queue/projects/{project}/fetch-specs", {"ok": True})

    def answer(self, method, path, body, status=200, delay=0):
        self.answers[(method, path)] = (status, body, delay)

    def accepts(self, job, path="/api/queue", others=()):
        """The board takes the request at `path` and shows `job` (and any
        `others`) when asked about it."""
        self.answer("POST", path, {"ok": True, "job": job})
        self.answer("GET", f"/api/queue/{job['id']}", {"generatedAt": "now", "job": job})
        self.answer("GET", "/api/queue", {"generatedAt": "now", "jobs": [job, *others]})

    def posts(self):
        """The requests that queue something, not the project check."""
        return [r for r in self.requests
                if r["method"] == "POST" and not r["path"].endswith("/fetch-specs")]

    def close(self):
        self.server.shutdown()


def make_job(**over):
    job = {
        "id": "job-1", "project": "demo", "specFolder": "722-x", "steps": ["analyze"],
        "stepIndex": 0, "state": "running", "model": {"analyze": "Opus"}, "results": [],
        "createdAt": "2026-11-07T10:00:00Z",
    }
    job.update(over)
    return job


def held_back(key, **values):
    return {"state": "queued", "error": {"key": key, "values": values}, "errorReason": "held-back"}


@pytest.fixture
def board():
    made = Board()
    yield made
    made.close()


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def git(repo, *args):
    return subprocess.run(
        ["git", "-C", str(repo), "-c", "user.name=Test", "-c", "user.email=test@example.com", *args],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def state_file(completed, archived=None):
    return json.dumps({"completedPhases": completed, "archived": archived, "closed": None,
                       "reopened": None, "acceptanceCriteria": [], "phaseCounts": {}})


class Machine:
    """One machine: a home whose `~/.aide/config` names the board, a git
    checkout of `demo` that points at a specs repository, and that
    repository's origin. The specs hold `721-x` (created), `722-x`
    (analyzed) and `archive/720-y` (archived)."""

    def __init__(self, tmp_path, aide, board_url=None):
        self.aide = aide
        self.tmp = tmp_path
        self.home = tmp_path / "home"
        (self.home / ".aide").mkdir(parents=True)
        if board_url is not None:
            (self.home / ".aide" / "config").write_text(f"AIDE_BOARD_URL={board_url}\n")

        self.origin = tmp_path / "specs-origin.git"
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(self.origin)], check=True)
        seed = tmp_path / "specs-seed"
        subprocess.run(["git", "clone", "-q", str(self.origin), str(seed)],
                       check=True, capture_output=True)
        self._seed = seed
        self.record("721-x", ["create"])
        self.record("722-x", ["create", "analyze"])
        self.record("archive/720-y", ["create", "analyze", "implement"], archived="2026-01-01")
        git(seed, "push", "-q", "origin", "main")
        self.specs = tmp_path / "specs-clone"
        subprocess.run(["git", "clone", "-q", str(self.origin), str(self.specs)],
                       check=True, capture_output=True)

        self.checkout = tmp_path / "work" / "demo"
        (self.checkout / ".aide").mkdir(parents=True)
        subprocess.run(["git", "init", "-q", str(self.checkout)], check=True)
        (self.checkout / ".aide" / "project.yaml").write_text("name: demo\n")
        (self.checkout / ".aide" / "config").write_text(f"AIDE_SPECS_PATH={self.specs}\n")

    def record(self, path, completed, archived=None):
        """Commit a spec's state file in the seed clone (not yet pushed)."""
        folder = self._seed / path
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "4-status.json").write_text(state_file(completed, archived))
        git(self._seed, "add", "-A")
        git(self._seed, "commit", "-qm", f"record {path}")

    def advance_origin(self, path, completed):
        """Origin moves on without this machine's clone seeing it yet."""
        self.record(path, completed)
        git(self._seed, "push", "-q", "origin", "main")

    def lose_origin(self):
        git(self.specs, "remote", "set-url", "origin", str(self.tmp / "gone.git"))

    def run(self, *args, stdin="", stdin_fd=None, env=None, timeout=60):
        full = dict(os.environ, HOME=str(self.home), GIT_TERMINAL_PROMPT="0")
        for name in ("AIDE_BOARD_URL", "AIDE_BOARD_ANSWER_SECONDS", "VISUAL", "EDITOR"):
            full.pop(name, None)
        full.update(env or {})
        kwargs = {"stdin": stdin_fd} if stdin_fd is not None else {"input": stdin}
        return subprocess.run(
            ["bash", str(self.aide), *args],
            capture_output=True, text=True, env=full, cwd=self.checkout, timeout=timeout, **kwargs,
        )


@pytest.fixture
def aide(workspace_root):
    return workspace_root / "core" / "scripts" / "aide"


@pytest.fixture
def machine(tmp_path, aide, board):
    return Machine(tmp_path, aide, board_url=board.url)


@pytest.fixture
def no_board_machine(tmp_path, aide):
    return Machine(tmp_path, aide, board_url=None)
