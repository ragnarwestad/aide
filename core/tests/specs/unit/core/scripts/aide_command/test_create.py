"""The terminal create command writes a spec through the board without queuing a job."""
import os
import pty

import pytest


def create_posts(board):
    return [r for r in board.posts() if r["path"] == "/api/queue/create"]


def accept_create(board, folder="723-a-title"):
    board.answer("POST", "/api/queue/create", {"ok": True, "specFolder": folder})


def test_the_description_comes_from_the_file_ac_7(machine, board, tmp_path):
    accept_create(board)
    (tmp_path / "desc.md").write_text("Some text\nover two lines\n")
    result = machine.run("create", "demo", "A title", "--file", str(tmp_path / "desc.md"))
    assert result.returncode == 0, result.stderr
    [post] = create_posts(board)
    assert post["body"]["project"] == "demo"
    assert post["body"]["title"] == "A title"
    assert post["body"]["description"].strip() == "Some text\nover two lines"
    assert result.stdout == "Created 723-a-title in demo.\n"


def test_the_description_comes_from_standard_input_ac_7(machine, board):
    accept_create(board)
    result = machine.run("create", "demo", "A title", stdin='From a pipe: "quoted" & more\n')
    assert result.returncode == 0, result.stderr
    [post] = create_posts(board)
    assert post["body"]["description"].strip() == 'From a pipe: "quoted" & more'


def test_the_description_comes_from_the_editor_ac_7(machine, board):
    accept_create(board)
    try:
        master, slave = pty.openpty()
    except OSError:
        pytest.skip("no pseudo-terminal can be opened here")
    try:
        result = machine.run("create", "demo", "A title", stdin_fd=slave,
                             env={"EDITOR": "sh -c 'echo typed in the editor > \"$0\"'"})
    finally:
        os.close(master)
        os.close(slave)
    assert result.returncode == 0, result.stderr
    [post] = create_posts(board)
    assert post["body"]["description"].strip() == "typed in the editor"


def test_create_posts_only_direct_spec_fields_ac_7(machine, board):
    accept_create(board)
    result = machine.run(
        "create", "demo", "A title", "--file", "/dev/null", "--depends-on", "721",
        "--criteria-checks", "warn", "--choose-approach",
    )
    assert result.returncode == 0, result.stderr
    [post] = create_posts(board)
    body = post["body"]
    assert body["dependsOn"] == ["721-x"]
    assert body["criteriaChecks"] == "warn"
    assert body["chooseApproach"] == "1"
    assert body["acceptanceRequired"] == "1"
    for removed in ("steps", "model", "provider", "aiFormulateAcceptance"):
        assert removed not in body


def test_create_refuses_removed_job_options_ac_7(machine):
    result = machine.run("create", "demo", "A title", "--file", "/dev/null", "--model", "unused")
    assert result.returncode == 2
    assert "--model is not an option of aide create" in result.stderr


def test_an_old_provisional_answer_is_refused_ac_7(machine, board):
    board.answer("POST", "/api/queue/create", {"ok": True, "job": {"specFolder": "new-1a2b3c4d"}})
    result = machine.run("create", "demo", "A title", "--file", "/dev/null")
    assert result.returncode != 0
    assert "final spec folder" in result.stderr
