"""The terminal Land command queues a pushed branch through the board."""


def test_land_posts_project_and_branch_and_reports_the_queue_ac_1_ac_12(machine, board):
    board.answer("POST", "/api/queue/projects/demo/land", {"ok": True, "message": "Queued Land for topic in demo."})

    result = machine.run("land", "demo", "topic")

    assert result.returncode == 0, result.stderr
    [post] = board.posts()
    assert post["path"] == "/api/queue/projects/demo/land"
    assert post["body"] == {"branch": "topic"}
    assert result.stdout == "Queued Land for topic in demo.\n"


def test_help_names_land_ac_12(machine):
    result = machine.run("--help")
    assert "aide land <project> <branch>" in result.stdout
