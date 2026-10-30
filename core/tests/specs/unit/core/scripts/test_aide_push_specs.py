"""Tests for core/scripts/aide-push-specs — pushes a specs repository,
rebases and pushes again when origin has moved, then tells the board to
fetch the specs.

The push decides the exit code. Telling the board is a courtesy: a board
that is missing, unreachable or unhappy changes one line of output and
nothing else.
"""
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest


@pytest.fixture
def pusher(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-push-specs"


def git(repo, *args, check=True):
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True, check=check,
    ).stdout.strip()


def clone(origin, path):
    subprocess.run(["git", "clone", "-q", str(origin), str(path)], check=True)
    git(path, "config", "user.name", "Test")
    git(path, "config", "user.email", "test@example.com")
    return path


def commit_file(repo, name, text, message=None):
    (repo / name).write_text(text)
    git(repo, "add", name)
    git(repo, "commit", "-qm", message or f"add {name}")


def init_origin(path):
    """A bare origin with one commit on main."""
    origin = path / "origin.git"
    seed = path / "seed"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True)
    clone(origin, seed)
    commit_file(seed, "shared.md", "start\n", "init")
    git(seed, "push", "-q", "origin", "main")
    return origin


def origin_head(origin):
    return git(origin, "rev-parse", "refs/heads/main")


class _Board:
    """A board stand-in: records each request's path and what origin held
    when it arrived, and answers the status it was given."""

    def __init__(self, origin, status=200):
        self.requests = []
        board = self

        class Handler(BaseHTTPRequestHandler):
            # http.server calls the handler by this name.
            # noinspection PyPep8Naming
            def do_POST(self):
                board.requests.append((self.path, origin_head(origin)))
                body = b'{"ok":true}' if status == 200 else b"no such project\n"
                self.send_response(status)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()


@pytest.fixture
def board_factory(tmp_path):
    made = []

    def make(origin, status=200):
        board = _Board(origin, status)
        made.append(board)
        return board

    yield make
    for board in made:
        board.close()


class Machine:
    """One machine: a home with `~/.aide/config`, a project root with a
    manifest, and a clone of the specs repository."""

    def __init__(self, tmp_path, origin, board_url=None, manifest_name="aide"):
        self.home = tmp_path / "home"
        (self.home / ".aide").mkdir(parents=True)
        if board_url is not None:
            (self.home / ".aide" / "config").write_text(f"AIDE_BOARD_URL={board_url}\n")
        self.project = tmp_path / "work" / "myproject"
        (self.project / ".aide").mkdir(parents=True)
        if manifest_name:
            (self.project / ".aide" / "project.yaml").write_text(f"name: {manifest_name}\n")
        self.specs = clone(origin, tmp_path / "specs-clone")

    def run(self, pusher):
        env = dict(os.environ, HOME=str(self.home))
        env.pop("AIDE_BOARD_URL", None)
        return subprocess.run(
            [str(pusher), "--specs-root", str(self.specs)],
            capture_output=True, text=True, env=env, cwd=self.project, timeout=60,
        )


def lines(text):
    return [line for line in text.splitlines() if line.strip()]


def test_the_board_is_told_once_for_the_project_after_origin_holds_the_push_AC_2(
        pusher, tmp_path, board_factory):
    origin = init_origin(tmp_path)
    board = board_factory(origin)
    machine = Machine(tmp_path, origin, board_url=board.url)
    commit_file(machine.specs, "new.md", "new\n")
    pushed = git(machine.specs, "rev-parse", "HEAD")

    result = machine.run(pusher)

    assert result.returncode == 0, result.stderr
    assert [path for path, _ in board.requests] == ["/api/queue/projects/aide/fetch-specs"]
    # The board fetches on arrival, so origin must already hold the commit.
    assert board.requests[0][1] == pushed
    assert len(lines(result.stdout)) == 1
    assert board.url in result.stdout


def test_a_project_without_a_manifest_is_named_by_its_directory_AC_2(
        pusher, tmp_path, board_factory):
    origin = init_origin(tmp_path)
    board = board_factory(origin)
    machine = Machine(tmp_path, origin, board_url=board.url, manifest_name=None)
    commit_file(machine.specs, "new.md", "new\n")

    result = machine.run(pusher)

    assert result.returncode == 0, result.stderr
    assert [path for path, _ in board.requests] == ["/api/queue/projects/myproject/fetch-specs"]


def test_origin_having_moved_is_rebased_onto_and_pushed_again_AC_4(
        pusher, tmp_path, board_factory):
    origin = init_origin(tmp_path)
    board = board_factory(origin)
    machine = Machine(tmp_path, origin, board_url=board.url)
    other = clone(origin, tmp_path / "other")
    commit_file(other, "theirs.md", "theirs\n")
    git(other, "push", "-q", "origin", "main")
    theirs = git(other, "rev-parse", "HEAD")
    commit_file(machine.specs, "mine.md", "mine\n")

    result = machine.run(pusher)

    assert result.returncode == 0, result.stderr
    assert git(origin, "rev-parse", "refs/heads/main~1") == theirs
    assert git(origin, "log", "-1", "--format=%s", "refs/heads/main") == "add mine.md"
    assert len(board.requests) == 1


def test_a_rebase_that_conflicts_is_undone_and_the_board_is_not_told_AC_4(
        pusher, tmp_path, board_factory):
    origin = init_origin(tmp_path)
    board = board_factory(origin)
    machine = Machine(tmp_path, origin, board_url=board.url)
    other = clone(origin, tmp_path / "other")
    commit_file(other, "shared.md", "theirs\n")
    git(other, "push", "-q", "origin", "main")
    theirs = git(other, "rev-parse", "HEAD")
    commit_file(machine.specs, "shared.md", "mine\n")

    result = machine.run(pusher)

    assert result.returncode != 0
    assert origin_head(origin) == theirs
    assert not (machine.specs / ".git" / "rebase-merge").exists()
    assert not (machine.specs / ".git" / "rebase-apply").exists()
    assert board.requests == []


def test_without_a_board_address_the_push_goes_through_and_nobody_is_told_AC_5(
        pusher, tmp_path, board_factory):
    origin = init_origin(tmp_path)
    board = board_factory(origin)
    machine = Machine(tmp_path, origin, board_url=None)
    commit_file(machine.specs, "new.md", "new\n")
    pushed = git(machine.specs, "rev-parse", "HEAD")

    result = machine.run(pusher)

    assert result.returncode == 0, result.stderr
    assert origin_head(origin) == pushed
    assert result.stdout == ""
    assert board.requests == []


def test_a_board_nothing_listens_on_is_one_line_and_the_push_stands_AC_6(
        pusher, tmp_path):
    origin = init_origin(tmp_path)
    # A port that was free a moment ago and has no listener now.
    probe = HTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
    dead_url = f"http://127.0.0.1:{probe.server_port}"
    probe.server_close()
    machine = Machine(tmp_path, origin, board_url=dead_url)
    commit_file(machine.specs, "new.md", "new\n")
    pushed = git(machine.specs, "rev-parse", "HEAD")

    result = machine.run(pusher)

    assert result.returncode == 0, result.stderr
    assert origin_head(origin) == pushed
    assert len(lines(result.stdout)) == 1
    assert dead_url in result.stdout


def test_a_board_that_answers_no_is_one_line_and_the_push_stands_AC_6(
        pusher, tmp_path, board_factory):
    origin = init_origin(tmp_path)
    board = board_factory(origin, status=404)
    machine = Machine(tmp_path, origin, board_url=board.url)
    commit_file(machine.specs, "new.md", "new\n")
    pushed = git(machine.specs, "rev-parse", "HEAD")

    result = machine.run(pusher)

    assert result.returncode == 0, result.stderr
    assert origin_head(origin) == pushed
    assert len(lines(result.stdout)) == 1
    assert board.url in result.stdout
