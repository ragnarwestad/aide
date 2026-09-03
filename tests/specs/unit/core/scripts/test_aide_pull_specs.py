"""Tests for core/scripts/aide-pull-specs — the unattended pull that
keeps the dashboard's specs checkout current.

The dashboard lists specs by reading the serving host's working copy,
and nothing pulls it. Spec 137 was written on the laptop, pushed, and
simply missing from the page until someone ran `git pull` on the mini by
hand (2026-08-20).

The script's job is the GUARDS: a bare `git pull` in a cron entry is one
line and needs no script. So this file is mostly about what it REFUSES
to touch — a dirty tree, a checkout parked on another branch, a pull
that is not a fast-forward — and about a repo it skips never stopping
the ones beside it.
"""
import subprocess

import pytest


@pytest.fixture
def puller(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-pull-specs"


def git(repo, *args, check=True):
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True, check=check,
    ).stdout.strip()


def init_origin(path):
    """A bare origin with one commit, and a clone that tracks it."""
    origin = path / "origin.git"
    seed = path / "seed"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True)
    subprocess.run(["git", "clone", "-q", str(origin), str(seed)], check=True)
    git(seed, "config", "user.name", "Test")
    git(seed, "config", "user.email", "test@example.com")
    (seed / "README.md").write_text("start\n")
    git(seed, "add", "README.md")
    git(seed, "commit", "-qm", "init")
    git(seed, "push", "-q", "origin", "main")
    return origin


def clone(origin, path):
    subprocess.run(["git", "clone", "-q", str(origin), str(path)], check=True)
    git(path, "config", "user.name", "Test")
    git(path, "config", "user.email", "test@example.com")
    return path


def push_a_commit(origin, tmp_path, message="second"):
    """Somebody else's commit, landing on origin the way the laptop's
    push does."""
    other = tmp_path / f"other-{message}"
    clone(origin, other)
    (other / f"{message}.md").write_text("new\n")
    git(other, "add", "-A")
    git(other, "commit", "-qm", message)
    git(other, "push", "-q", "origin", "main")
    return git(other, "rev-parse", "HEAD")


def run(puller, *paths):
    return subprocess.run(
        [str(puller), *[str(p) for p in paths]],
        capture_output=True, text=True,
    )


def test_a_clean_checkout_on_main_is_fast_forwarded(puller, tmp_path):
    origin = init_origin(tmp_path)
    repo = clone(origin, tmp_path / "specs")
    pushed = push_a_commit(origin, tmp_path)

    result = run(puller, repo)

    assert result.returncode == 0
    assert git(repo, "rev-parse", "HEAD") == pushed
    # The line names the repo and both revisions: a cron mail saying
    # only "pulled" cannot be checked against anything.
    assert "specs" in result.stdout
    assert pushed[:8] in result.stdout


def test_a_checkout_already_current_says_nothing(puller, tmp_path):
    origin = init_origin(tmp_path)
    repo = clone(origin, tmp_path / "specs")

    result = run(puller, repo)

    # Silence is what keeps a two-minute cron entry from mailing 720
    # times a day.
    assert result.returncode == 0
    assert result.stdout == ""


def test_uncommitted_work_is_left_alone(puller, tmp_path):
    origin = init_origin(tmp_path)
    repo = clone(origin, tmp_path / "specs")
    push_a_commit(origin, tmp_path)
    before = git(repo, "rev-parse", "HEAD")
    (repo / "README.md").write_text("half-written\n")

    result = run(puller, repo)

    assert git(repo, "rev-parse", "HEAD") == before
    assert (repo / "README.md").read_text() == "half-written\n"
    assert "uncommitted" in result.stdout
    # A person mid-edit is not a failure: the next run picks it up.
    assert result.returncode == 0


def test_an_untracked_file_is_no_obstacle(puller, tmp_path):
    origin = init_origin(tmp_path)
    repo = clone(origin, tmp_path / "specs")
    pushed = push_a_commit(origin, tmp_path)
    # A specs root collects these between commits — an export, an
    # editor's scratch file. None of them stops a fast-forward.
    (repo / "notes.txt").write_text("scratch\n")

    result = run(puller, repo)

    assert result.returncode == 0
    assert git(repo, "rev-parse", "HEAD") == pushed


def test_a_checkout_on_another_branch_is_left_alone(puller, tmp_path):
    origin = init_origin(tmp_path)
    repo = clone(origin, tmp_path / "specs")
    push_a_commit(origin, tmp_path)
    git(repo, "checkout", "-q", "-b", "aide/137-something")
    before = git(repo, "rev-parse", "HEAD")

    result = run(puller, repo)

    assert git(repo, "rev-parse", "HEAD") == before
    assert git(repo, "rev-parse", "--abbrev-ref", "HEAD") == "aide/137-something"
    assert "not the default branch" in result.stdout
    assert result.returncode == 0


def test_a_diverged_branch_is_refused_rather_than_merged(puller, tmp_path):
    origin = init_origin(tmp_path)
    repo = clone(origin, tmp_path / "specs")
    push_a_commit(origin, tmp_path)
    # A local commit that is not on origin: --ff-only has to fail here
    # rather than open a merge nobody is present to finish.
    (repo / "local.md").write_text("mine\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "local work")
    before = git(repo, "rev-parse", "HEAD")

    result = run(puller, repo)

    assert result.returncode == 1
    assert git(repo, "rev-parse", "HEAD") == before
    assert "pull failed" in result.stderr


def test_one_bad_repo_does_not_stop_the_others(puller, tmp_path):
    origin = init_origin(tmp_path)
    good = clone(origin, tmp_path / "good")
    dirty = clone(origin, tmp_path / "dirty")
    pushed = push_a_commit(origin, tmp_path)
    (dirty / "README.md").write_text("half-written\n")

    result = run(puller, tmp_path / "nowhere", dirty, good)

    assert result.returncode == 0
    assert git(good, "rev-parse", "HEAD") == pushed
    assert "no such directory" in result.stderr
    assert "uncommitted" in result.stdout


def test_something_that_is_not_a_repo_is_skipped_not_fatal(puller, tmp_path):
    plain = tmp_path / "plain"
    plain.mkdir()

    result = run(puller, plain)

    assert result.returncode == 0
    assert "not a git working tree" in result.stderr


def test_no_arguments_refuses_with_a_usage_line(puller):
    result = subprocess.run([str(puller)], capture_output=True, text=True)

    assert result.returncode == 2
    assert "usage:" in result.stderr


def test_the_script_is_installed_with_the_other_shared_scripts(workspace_root):
    """The one list of shared scripts (`_install-bin.sh`). A script that
    is not on it is never copied to ~/.local/bin, so the cron entry
    names a path that does not exist."""
    installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
    listed = subprocess.run(
        ["bash", "-c", f'source "{installer}"; printf "%s" "$COMMON_BIN_SCRIPTS"'],
        capture_output=True, text=True, check=True,
    ).stdout.split()
    assert "aide-pull-specs" in listed
