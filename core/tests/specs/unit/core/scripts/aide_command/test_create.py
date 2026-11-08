"""aide create: the title and description go to the board as the New spec
form sends them, with the form's options as flags."""
import os
import pty

import pytest

from .conftest import make_job

CREATE_JOB = make_job(id="c-1", specFolder="new-1a2b3c4d", steps=["create"],
                      model={"create": "Opus"})


def create_posts(board):
    return [r for r in board.posts() if r["path"] == "/api/queue/create"]


def test_the_description_comes_from_the_file_AC_2(machine, board, tmp_path):
    board.accepts(CREATE_JOB, "/api/queue/create")
    (tmp_path / "desc.md").write_text("Some text\nover two lines\n")

    result = machine.run("create", "demo", "A title", "--file", str(tmp_path / "desc.md"))

    assert result.returncode == 0, result.stderr
    [post] = create_posts(board)
    assert not post["form"], "the board reads any body but JSON as a form"
    assert post["body"]["project"] == "demo"
    assert post["body"]["title"] == "A title"
    assert post["body"]["description"].strip() == "Some text\nover two lines"


def test_the_description_comes_from_standard_input_AC_2(machine, board):
    board.accepts(CREATE_JOB, "/api/queue/create")

    result = machine.run("create", "demo", "A title", stdin="From a pipe: \"quoted\" & more\n")

    assert result.returncode == 0, result.stderr
    [post] = create_posts(board)
    assert post["body"]["description"].strip() == 'From a pipe: "quoted" & more'


def test_the_description_comes_from_the_editor_when_stdin_is_a_terminal_AC_2(machine, board):
    board.accepts(CREATE_JOB, "/api/queue/create")
    try:
        master, slave = pty.openpty()
    except OSError:
        pytest.skip("no pseudo-terminal can be opened here (a sandbox), so there is no terminal to give it")
    try:
        result = machine.run(
            "create", "demo", "A title", stdin_fd=slave,
            env={"EDITOR": "sh -c 'echo typed in the editor > \"$0\"'"},
        )
    finally:
        os.close(master)
        os.close(slave)

    assert result.returncode == 0, result.stderr
    [post] = create_posts(board)
    assert post["body"]["description"].strip() == "typed in the editor"


def test_the_forms_options_are_passed_on_AC_3(machine, board):
    board.accepts(CREATE_JOB, "/api/queue/create")

    result = machine.run(
        "create", "demo", "A title", "--file", "/dev/null",
        "--depends-on", "721", "--autostart",
        "--criteria-checks", "warn", "--choose-approach",
    )

    assert result.returncode == 0, result.stderr
    [post] = create_posts(board)
    body = post["body"]
    assert body["dependsOn"] == ["721-x"]
    # Started, a new spec runs every phase, as Analyze on its row does.
    assert body["steps"] == ["analyze", "implement", "archive"]
    assert body["criteriaChecks"] == "warn"
    assert body["chooseApproach"] == "1"
    # The form opens with both boxes ticked, and the board reads an absent
    # box as clear.
    assert body["acceptanceRequired"] == "1"
    assert body["aiFormulateAcceptance"] == "1"


def test_the_two_boxes_are_left_clear_on_request_AC_3(machine, board):
    board.accepts(CREATE_JOB, "/api/queue/create")

    result = machine.run("create", "demo", "A title", "--file", "/dev/null",
                         "--acceptance-not-required", "--no-ai-criteria")

    assert result.returncode == 0, result.stderr
    [post] = create_posts(board)
    assert "acceptanceRequired" not in post["body"]
    assert "aiFormulateAcceptance" not in post["body"]


def test_a_model_names_every_step_the_create_runs_and_a_provider_is_one_string_AC_3(machine, board):
    board.accepts(CREATE_JOB, "/api/queue/create")

    result = machine.run("create", "demo", "A title", "--file", "/dev/null",
                         "--autostart", "--model", "Sonnet", "--provider", "Codex")

    assert result.returncode == 0, result.stderr
    [post] = create_posts(board)
    assert post["body"]["model"] == {"create": "Sonnet", "analyze": "Sonnet",
                                     "implement": "Sonnet", "archive": "Sonnet"}
    assert post["body"]["provider"] == "Codex"


def test_the_sentence_names_the_title_the_steps_and_each_model_AC_9(machine, board):
    job = make_job(id="c-2", specFolder="new-1a2b3c4d", steps=["create", "analyze"],
                   model={"create": "Opus", "analyze": "Sonnet"},
                   provider={"create": "Codex", "analyze": "Codex"})
    board.accepts(job, "/api/queue/create")

    result = machine.run("create", "demo", "A title", "--file", "/dev/null",
                         "--autostart", "--provider", "Codex")

    assert result.returncode == 0, result.stderr
    [line] = result.stdout.splitlines()
    for part in ("A title", "create", "analyze", "Opus", "Sonnet", "Codex"):
        assert part in line
    assert "new-" not in line
    assert "http" not in line
