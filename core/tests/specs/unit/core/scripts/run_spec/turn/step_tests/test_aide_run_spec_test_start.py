"""A test run that could not start (run-spec/turn/test-start.sh): what
stopped it, read from its log; who holds a port it needed; and the end of
a log cut at a line, never inside a word.
"""

import json
import os
import pathlib
import subprocess

import pytest

from ....conftest import stand_in

PART = pathlib.Path(__file__).resolve().parents[9] / "core" / "scripts" / "lib" / "run-spec" / "turn" / "test-start.sh"

PLAYWRIGHT_PORT = (
    "> @skjera/web@0.0.0 test:e2e /x/code/packages/web\n"
    "Error: http://localhost:8806/health/ready is already used, make sure that nothing is running "
    "on the port/url or set reuseExistingServer:true in config.webServer.\n"
    " ELIFECYCLE  Test failed. See above for more details.\n"
    "ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL\n"
)


def _bash(snippet, env=None):
    return subprocess.run(
        ["bash", "-c", f'set -uo pipefail; source "{PART}"; {snippet}'],
        capture_output=True, text=True, env=env,
    )


def _failure(tmp_path, log_text):
    log = tmp_path / "tests.log"
    log.write_text(log_text)
    r = _bash(f'test_start_failure "{log}"')
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout) if r.stdout.strip() else None


def test_playwright_naming_its_server_url_in_use_is_a_port_in_use(tmp_path):
    cause = _failure(tmp_path, PLAYWRIGHT_PORT)
    assert cause["kind"] == "port-in-use"
    assert cause["port"] == 8806
    assert cause["url"] == "http://localhost:8806/health/ready"
    assert "is already used" in cause["line"]


def test_a_url_without_a_port_uses_its_schemes_own(tmp_path):
    cause = _failure(tmp_path, "Error: https://localhost/ is already used, make sure that nothing is running on the port/url\n")
    assert cause["port"] == 443


@pytest.mark.parametrize(
    "line, port",
    [
        ("Error: listen EADDRINUSE: address already in use :::8806", 8806),
        ("Error: listen EADDRINUSE: address already in use 127.0.0.1:3000", 3000),
        ("listen tcp 0.0.0.0:1025: bind: address already in use", 1025),
    ],
)
def test_an_address_in_use_with_a_port_is_a_port_in_use(tmp_path, line, port):
    cause = _failure(tmp_path, f"starting\n{line}\n")
    assert cause["kind"] == "port-in-use"
    assert cause["port"] == port


def test_an_address_in_use_without_a_port_says_nothing(tmp_path):
    assert _failure(tmp_path, "Error response from daemon: ports are not available: bind: address already in use\n") is None


def test_a_server_that_did_not_answer_in_time_is_a_timeout(tmp_path):
    cause = _failure(tmp_path, "Error: Timed out waiting 60000ms from config.webServer.\n")
    assert cause == {"kind": "server-timeout", "ms": 60000, "line": "Error: Timed out waiting 60000ms from config.webServer."}


@pytest.mark.parametrize(
    "line",
    [
        "Error: Process from config.webServer was not able to start. Exit code: 1",
        "Error: Process from config.webServer exited early.",
    ],
)
def test_a_server_that_exited_is_a_server_exited(tmp_path, line):
    assert _failure(tmp_path, f"{line}\n")["kind"] == "server-exited"


def test_failing_tests_are_not_a_start_failure_whatever_else_the_log_says(tmp_path):
    log = "(fail) the port test > reports EADDRINUSE :::3000\nError: listen EADDRINUSE: address already in use :::3000\n 1 failed\n"
    assert _failure(tmp_path, log) is None


def test_an_ordinary_red_log_is_not_a_start_failure(tmp_path):
    assert _failure(tmp_path, "AssertionError: expected 1 to be 2\n") is None


# --- who holds the port ---------------------------------------------------


def _with_lsof(tmp_path, pid_out, info_out):
    """A stand-in `lsof` on PATH: `-t` answers the listening pid, `-Fcn`
    the command and the cwd."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stand_in(
        bin_dir / "lsof",
        "#!/bin/sh\n"
        'case "$*" in\n'
        f"  *-t*) printf '%b' {json.dumps(pid_out)} ;;\n"
        f"  *-Fcn*) printf '%b' {json.dumps(info_out)} ;;\n"
        "esac\n",
    )
    return {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}


def test_a_port_held_from_an_aide_worktree_names_the_spec(tmp_path):
    env = _with_lsof(
        tmp_path,
        "4242\n",
        "p4242\ncnode\nfcwd\nn/Users/x/.aide/dashboard/worktrees/skjera/58-sign-up-flow/code/packages/server\n",
    )
    r = _bash("port_holder 8806", env=env)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout) == {
        "pid": 4242,
        "command": "node",
        "cwd": "/Users/x/.aide/dashboard/worktrees/skjera/58-sign-up-flow/code/packages/server",
        "project": "skjera",
        "spec": "58-sign-up-flow",
    }


def test_a_port_held_elsewhere_names_the_pid_and_command_and_no_spec(tmp_path):
    env = _with_lsof(tmp_path, "777\n", "p777\ncpostgres\nfcwd\nn/usr/local/var\n")
    holder = json.loads(_bash("port_holder 5432", env=env).stdout)
    assert holder == {"pid": 777, "command": "postgres", "cwd": "/usr/local/var"}


def test_a_port_nobody_holds_any_more_prints_nothing(tmp_path):
    env = _with_lsof(tmp_path, "", "")
    r = _bash("port_holder 8806", env=env)
    assert r.returncode == 0, r.stderr
    assert r.stdout == ""


# --- the end of a log -----------------------------------------------------


def test_the_tail_starts_at_a_line_not_inside_a_word(tmp_path):
    log = tmp_path / "tests.log"
    log.write_text("x" * 700 + "\n" + "make sure that nothing is running on the port/url\n" + "y" * 40 + "\n")
    tail = _bash(f'log_tail "{log}" 600').stdout
    assert tail.startswith("make sure that nothing"), tail[:40]
    assert tail.rstrip().endswith("y" * 40)


def test_a_cut_that_falls_on_a_line_start_keeps_that_line(tmp_path):
    log = tmp_path / "tests.log"
    keep = "z" * 99 + "\n"
    log.write_text("a" * 50 + "\n" + keep)
    assert _bash(f'log_tail "{log}" 100').stdout == keep.rstrip("\n")


def test_a_log_within_the_limit_is_kept_whole(tmp_path):
    log = tmp_path / "tests.log"
    log.write_text("short\nlog\n")
    assert _bash(f'log_tail "{log}" 600').stdout == "short\nlog\n"


def test_one_line_longer_than_the_limit_is_cut_rather_than_dropped(tmp_path):
    log = tmp_path / "tests.log"
    log.write_text("w" * 900)
    assert _bash(f'log_tail "{log}" 600').stdout == "w" * 600


PORT_CASES = json.loads(
    (pathlib.Path(__file__).resolve().parents[7] / "fixtures" / "port-in-use.json").read_text()
)["cases"]


@pytest.mark.parametrize("case", PORT_CASES, ids=[c["name"] for c in PORT_CASES])
def test_the_port_a_log_says_was_taken_is_read_as_the_board_reads_it(tmp_path, case):
    """The same fixture pins portInUse in dashboard/src/format/port-in-use.ts."""
    cause = _failure(tmp_path, case["log"])
    got = cause["port"] if cause and cause["kind"] == "port-in-use" else None
    assert got == case["port"]
