"""The terminal Merge command queues a pushed branch through the board."""


def test_merge_posts_project_and_branch_and_reports_the_queue_ac_1_ac_12(machine, board):
    board.answer("POST", "/api/queue/projects/demo/land", {"ok": True, "message": "Queued Merge for topic in demo."})

    result = machine.run("merge", "demo", "topic")

    assert result.returncode == 0, result.stderr
    [post] = board.posts()
    assert post["path"] == "/api/queue/projects/demo/land"
    assert post["body"] == {"branch": "topic"}
    assert result.stdout == "Queued Merge for topic in demo.\n"


def test_land_names_the_command_it_became(machine, board):
    result = machine.run("land", "demo", "topic")

    assert result.returncode == 2
    assert "aide land is now aide merge" in result.stderr
    assert board.posts() == []

