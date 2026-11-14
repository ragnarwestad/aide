"""What the command says when the board refuses, is missing, does not know
the project, cannot be reached or does not answer."""
from .conftest import free_port, make_job


def test_the_boards_own_reason_is_printed_and_not_its_advice_for_a_page_AC_10(machine, board):
    board.answer("POST", "/api/queue",
                 {"error": "722-x has not been analyzed yet", "solution": "Reload the page and try again"},
                 status=400)

    result = machine.run("implement", "722")

    assert result.returncode == 1
    assert "722-x has not been analyzed yet" in result.stderr
    assert "Reload the page" not in result.stderr


def test_a_close_for_a_spec_the_board_does_not_know_says_so_AC_10(machine, board):
    board.answer("POST", "/api/queue/specs/demo/722-x/close", "not found", status=404)

    result = machine.run("close", "722", "--reason", "x")

    assert result.returncode == 1
    assert "no spec 722-x in demo" in result.stderr


NO_BOARD = 3


def test_without_an_address_the_skill_to_run_instead_is_named_AC_11_AC_1(no_board_machine, board):
    result = no_board_machine.run("analyze", "722")
    create = no_board_machine.run("create", "demo", "A title", stdin="text\n")

    assert result.returncode == NO_BOARD
    assert "AIDE_BOARD_URL" in result.stderr
    assert "/aide-analyze 722" in result.stderr
    assert create.returncode == NO_BOARD
    assert "/aide-create" in create.stderr
    assert board.requests == []


def test_a_project_the_board_does_not_know_names_the_skill_to_run_instead_AC_11_AC_1(machine, board):
    board.answer("POST", "/api/queue/projects/demo/fetch-specs", "not found", status=404)

    step = machine.run("analyze", "722")
    create = machine.run("create", "demo", "A title", stdin="text\n")

    assert step.returncode == NO_BOARD
    assert "demo" in step.stderr and "/aide-analyze 722" in step.stderr
    assert create.returncode == NO_BOARD
    assert "/aide-create" in create.stderr
    assert board.posts() == []


def test_a_board_that_cannot_be_reached_is_said_so_AC_12(tmp_path, aide):
    from .conftest import Machine
    machine = Machine(tmp_path, aide, board_url=f"http://127.0.0.1:{free_port()}")

    result = machine.run("analyze", "722")

    assert result.returncode == 1
    assert "could not be reached" in result.stderr


def test_a_board_that_does_not_answer_in_time_says_the_request_may_be_queued_AC_12(machine, board):
    board.answer("POST", "/api/queue", {"ok": True, "job": make_job()}, delay=4)

    result = machine.run("analyze", "722", env={"AIDE_BOARD_ANSWER_SECONDS": "1"})

    assert result.returncode == 1
    assert "did not answer" in result.stderr
    assert "may have been queued" in result.stderr


def test_the_specs_fetch_is_given_as_long_as_the_request_itself(machine, board):
    # A loaded board takes longer than the project check's wait to fetch.
    board.answer("POST", "/api/queue/projects/demo/fetch-specs", {"ok": True}, delay=3)
    board.accepts(make_job())

    result = machine.run("analyze", "722", env={"AIDE_BOARD_ANSWER_SECONDS": "1"})

    assert result.returncode == 1
    assert "did not answer" in result.stderr
    assert board.posts() == []


def test_a_missing_argument_or_an_unknown_command_is_a_usage_error(machine, board):
    assert machine.run("analyze").returncode == 2
    assert machine.run("frobnicate", "722").returncode == 2
    assert machine.run("analyze", "722", "--nonsense").returncode == 2
    assert board.posts() == []
