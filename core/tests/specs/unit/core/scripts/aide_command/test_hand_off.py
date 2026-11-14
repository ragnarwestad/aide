"""aide-hand-off: a skill running in a session hands its step to `aide` when
the project has a board. Exit 0 and 1 carry `aide`'s own answer on stdout;
exit 3 means "do the step in the session" and prints nothing.
"""
import copy
import shutil

import pytest

from .conftest import Machine, free_port, make_job

DO_IT_HERE = 3
CREATE_JOB = make_job(id="c-1", specFolder="new-1a2b3c4d", steps=["create"],
                      model={"create": "Opus"})


@pytest.fixture
def hand_off(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-hand-off"


@pytest.fixture
def handing(tmp_path, hand_off, board):
    return Machine(tmp_path, hand_off, board_url=board.url)


@pytest.fixture
def handing_without_a_board(tmp_path, hand_off):
    return Machine(tmp_path, hand_off, board_url=None)


def beside_a_stub_aide(tmp_path, hand_off, board, stub, board_library=True):
    """aide-hand-off with its libraries copied beside a stand-in `aide`
    whose body is `stub`, on a machine whose board is set."""
    scripts = hand_off.parent
    copied = tmp_path / "bin"
    copied.mkdir()
    shutil.copy(hand_off, copied / "aide-hand-off")
    shutil.copy(scripts / "_aide-spec-lib.sh", copied / "_aide-spec-lib.sh")
    shutil.copytree(scripts / "lib", copied / "lib")
    if not board_library:
        (copied / "lib" / "board-request.sh").unlink()
    (copied / "aide").write_text("#!/usr/bin/env bash\n" + stub)
    return Machine(tmp_path, copied / "aide-hand-off", board_url=board.url)


def create_posts(board):
    return [r for r in board.posts() if r["path"] == "/api/queue/create"]


@pytest.mark.parametrize("step", ["analyze", "implement", "archive", "reopen"])
def test_a_step_is_queued_on_the_board_AC_1(handing, board, step):
    board.accepts(make_job(steps=[step], model={step: "Opus"}))

    result = handing.run(step, "722")

    assert result.returncode == 0, result.stdout + result.stderr
    [post] = board.posts()
    assert post["path"] == "/api/queue"
    assert post["body"] == {"project": "demo", "specFolder": "722-x", "steps": [step]}


def test_a_close_is_queued_with_its_reason_AC_1(handing, board):
    board.accepts(make_job(steps=["close"], model={"close": "Opus"}),
                  "/api/queue/specs/demo/722-x/close")

    result = handing.run("close", "722", "--reason", "x")

    assert result.returncode == 0, result.stdout + result.stderr
    [post] = board.posts()
    assert post["path"] == "/api/queue/specs/demo/722-x/close"
    assert post["body"] == {"reason": "x"}


def test_a_reopen_that_asks_for_a_reset_queues_nothing_and_says_so_AC_1(handing, board):
    result = handing.run("reopen", "720", "--reset")

    assert result.returncode == 1
    assert len(result.stdout.strip().splitlines()) == 1
    assert board.posts() == []


def test_a_reopen_with_a_reset_is_done_in_the_session_without_a_board_AC_1(
        handing_without_a_board, board):
    result = handing_without_a_board.run("reopen", "720", "--reset")

    assert result.returncode == DO_IT_HERE
    assert result.stdout == ""
    assert board.requests == []


def test_a_reopen_with_a_reset_is_done_in_the_session_when_the_board_does_not_know_the_project_AC_1(
        handing, board):
    board.answer("POST", "/api/queue/projects/demo/fetch-specs", "not found", status=404)

    result = handing.run("reopen", "720", "--reset")

    assert result.returncode == DO_IT_HERE
    assert result.stdout == ""
    assert board.posts() == []


def test_a_create_carries_the_project_the_title_the_description_and_the_dependencies_AC_2(
        handing, board):
    board.accepts(CREATE_JOB, "/api/queue/create")

    result = handing.run("create", "A title", "--depends-on", "721",
                         stdin="The description\nover two lines\n")

    assert result.returncode == 0, result.stdout + result.stderr
    [post] = create_posts(board)
    assert post["body"]["project"] == "demo"
    assert post["body"]["title"] == "A title"
    assert post["body"]["description"].strip() == "The description\nover two lines"
    assert post["body"]["dependsOn"] == ["721-x"]


def test_an_accepted_step_prints_what_aide_prints_AC_3(handing, aide, board):
    board.accepts(make_job())
    direct = copy.copy(handing)
    direct.aide = aide

    handed = handing.run("analyze", "722")
    plain = direct.run("analyze", "722")

    assert handed.returncode == 0, handed.stdout + handed.stderr
    assert handed.stdout == plain.stdout
    assert handed.stdout.strip() != ""


def test_a_refusal_prints_the_boards_reason_and_never_asks_for_the_step_to_be_done_here_AC_3(
        handing, board):
    board.answer("POST", "/api/queue", {"error": "722-x has not been analyzed yet"}, status=400)

    result = handing.run("implement", "722")

    assert result.returncode == 1
    assert "722-x has not been analyzed yet" in result.stdout


def test_a_board_that_cannot_be_reached_ends_the_step_there_AC_3(tmp_path, hand_off):
    machine = Machine(tmp_path, hand_off, board_url=f"http://127.0.0.1:{free_port()}")

    result = machine.run("analyze", "722")

    assert result.returncode == 1
    assert "could not be reached" in result.stdout


@pytest.mark.parametrize("command", [("analyze", "722"), ("create", "A title")])
def test_without_a_board_the_step_is_done_in_the_session_AC_4(
        handing_without_a_board, board, command):
    result = handing_without_a_board.run(*command, stdin="text\n")

    assert result.returncode == DO_IT_HERE
    assert result.stdout == "" and result.stderr == ""
    assert board.requests == []


@pytest.mark.parametrize("command", [("analyze", "722"), ("create", "A title")])
def test_a_board_that_does_not_know_the_project_leaves_the_step_to_the_session_AC_4(
        handing, board, command):
    board.answer("POST", "/api/queue/projects/demo/fetch-specs", "not found", status=404)

    result = handing.run(*command, stdin="text\n")

    assert result.returncode == DO_IT_HERE
    assert result.stdout == "" and result.stderr == ""
    assert board.posts() == []


def test_an_aide_that_exits_3_in_other_words_leaves_the_step_to_the_session_AC_1(
        tmp_path, hand_off, board):
    machine = beside_a_stub_aide(
        tmp_path, hand_off, board,
        'echo "aide: nothing to queue here, so do it yourself" >&2\nexit 3\n')

    result = machine.run("analyze", "722")

    assert result.returncode == DO_IT_HERE
    assert result.stdout == "" and result.stderr == ""


def test_an_aide_refusal_in_the_old_no_board_words_is_passed_on_AC_1(tmp_path, hand_off, board):
    sentence = "aide: the board refused — run /aide-analyze 722 in an AI session instead"
    machine = beside_a_stub_aide(tmp_path, hand_off, board, f'echo "{sentence}" >&2\nexit 1\n')

    result = machine.run("analyze", "722")

    assert result.returncode == 1
    assert sentence in result.stdout


def test_the_hand_off_runs_aide_and_never_sources_it_AC_2(tmp_path, hand_off, board):
    mark = tmp_path / "sourced"
    machine = beside_a_stub_aide(
        tmp_path, hand_off, board,
        f'if [ "${{BASH_SOURCE[0]}}" != "$0" ]; then touch "{mark}"; return 0; fi\n'
        'echo "Queued analyze on 722-x."\nexit 0\n')

    result = machine.run("analyze", "722")

    assert not mark.exists()
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Queued analyze on 722-x." in result.stdout


def test_a_missing_board_library_is_said_so_AC_2(tmp_path, hand_off, board):
    machine = beside_a_stub_aide(
        tmp_path, hand_off, board,
        'if [ "${BASH_SOURCE[0]}" != "$0" ]; then return 0; fi\necho "Queued."\nexit 0\n',
        board_library=False)

    result = machine.run("analyze", "722")

    assert result.returncode == 1
    assert "lib/board-request.sh is missing" in result.stdout


def test_without_aide_beside_it_the_step_is_done_in_the_session_AC_4(
        tmp_path, hand_off, board):
    alone = tmp_path / "alone"
    alone.mkdir()
    shutil.copy(hand_off, alone / "aide-hand-off")
    machine = Machine(tmp_path, alone / "aide-hand-off", board_url=board.url)

    result = machine.run("analyze", "722")

    assert result.returncode == DO_IT_HERE
    assert result.stdout == ""
    assert board.requests == []


@pytest.mark.parametrize("command", [("analyze", "722"), ("create", "A title"),
                                     ("reopen", "720", "--reset")])
def test_a_headless_run_never_hands_its_step_over_AC_5(handing, board, command):
    result = handing.run(*command, stdin="text\n", env={"AIDE_HEADLESS": "1"})

    assert result.returncode == DO_IT_HERE
    assert result.stdout == ""
    assert board.requests == []


def test_help_is_answered_even_when_the_run_is_headless(handing, board):
    result = handing.run("--help", env={"AIDE_HEADLESS": "1"})

    assert result.returncode == 0
    assert "usage" in result.stdout.lower()
    assert board.requests == []
