"""The terminal Merge command queues a pushed branch through the board."""


def test_merge_posts_project_and_branch_and_reports_the_queue_ac_1_ac_12(machine, board):
    board.answer("POST", "/api/queue/projects/demo/land", {"ok": True, "message": "Queued Merge for topic in demo."})

    result = machine.run("merge", "demo", "topic")

    assert result.returncode == 0, result.stderr
    [post] = board.posts()
    assert post["path"] == "/api/queue/projects/demo/land"
    assert post["body"] == {"branch": "topic", "checkout": str(machine.checkout.resolve())}
    assert result.stdout == "Queued Merge for topic in demo.\n"


def test_help_names_merge_ac_12(machine):
    result = machine.run("--help")
    assert "aide merge <project> <branch>" in result.stdout


def test_land_names_the_command_it_became(machine, board):
    result = machine.run("land", "demo", "topic")

    assert result.returncode == 2
    assert "aide land is now aide merge" in result.stderr
    assert board.posts() == []


def test_land_from_a_worktree_names_its_main_checkout(machine, board):
    """The board removes the landed branch's copy where the session made it:
    the repository's main checkout, whichever worktree the command ran in."""
    import subprocess
    board.answer("POST", "/api/queue/projects/demo/land", {"ok": True, "message": "Queued."})
    git = ["git", "-c", "user.name=T", "-c", "user.email=t@example.com", "-C", str(machine.checkout)]
    subprocess.run([*git, "commit", "-q", "--allow-empty", "-m", "start"], check=True)
    tree = machine.checkout.parent / "demo-topic"
    subprocess.run([*git, "worktree", "add", "-q", "-b", "topic", str(tree)], check=True)
    machine.checkout, home = tree, machine.checkout

    result = machine.run("merge", "demo", "topic")

    assert result.returncode == 0, result.stderr
    [post] = board.posts()
    assert post["body"]["checkout"] == str(home.resolve())
