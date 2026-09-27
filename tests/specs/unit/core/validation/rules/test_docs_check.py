"""The command a documentation change runs, and the hook that runs it.

Fourteen tests read a page rather than the code, and they sit in both
suites — `scripts/check-docs` is the one command that runs exactly those.
The hook is what makes it happen without being remembered: a push
straight to `main` has no landing in front of it and no CI, which runs on
a pull request only.

What these hold onto is the pairing. A hook that stopped calling the
script, or a script that stopped running one of the two halves, would
leave a push to main with nothing reading the pages it changes.
"""
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[6]
SCRIPT = ROOT / "scripts" / "check-docs"
HOOK = ROOT / ".githooks" / "pre-push"


@pytest.fixture
def script_text():
    assert SCRIPT.exists(), "scripts/check-docs is gone — a doc change has no command of its own"
    return SCRIPT.read_text(encoding="utf-8")


@pytest.fixture
def hook_text():
    assert HOOK.exists(), ".githooks/pre-push is gone — a push to main is gated by memory again"
    return HOOK.read_text(encoding="utf-8")


class TestTheCommand:
    def test_it_is_executable(self):
        assert SCRIPT.stat().st_mode & 0o111, "scripts/check-docs is not executable"

    def test_it_runs_the_validation_tests(self, script_text):
        assert "tests/specs/unit/core/validation" in script_text, \
            "the aide suite's own doc guards are not in the command"

    def test_it_runs_the_dashboard_guards(self, script_text):
        assert "test/guards" in script_text and "test/design" in script_text, \
            "the dashboard's doc guards are not in the command"


class TestTheHook:
    def test_it_calls_the_command(self, hook_text):
        assert "scripts/check-docs" in hook_text, "the hook runs something else than the command"

    def test_it_only_guards_the_default_branch(self, hook_text):
        assert "refs/heads/main" in hook_text, \
            "the hook must read the ref being pushed, not run on every push"

    def test_it_can_be_skipped_out_loud(self, hook_text):
        assert "AIDE_SKIP_PRE_PUSH" in hook_text and "skipped" in hook_text, \
            "the way past it has to say that it was taken"


def _git(cwd, *args):
    import subprocess
    subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True)


class TestTheHooksChildren:
    """Git hands a hook the repository it runs for in GIT_DIR. A test the
    guards run that makes a scratch repository with `git -C <scratch>`
    would then work on the real one instead: its commits went onto the
    branch being pushed, and its `git config` wrote the real clone's
    settings. The guards have to start without it."""

    def test_the_guards_get_no_git_environment(self, tmp_path):
        import os
        import shutil
        import subprocess

        origin = tmp_path / "origin.git"
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True)
        repo = tmp_path / "repo"
        repo.mkdir()
        _git(repo, "init", "-q", "-b", "main")
        _git(repo, "config", "user.name", "Hook Test")
        _git(repo, "config", "user.email", "hook@example.com")
        (repo / ".githooks").mkdir()
        shutil.copy(HOOK, repo / ".githooks" / "pre-push")
        (repo / "scripts").mkdir()
        dump = tmp_path / "env.txt"
        stub = repo / "scripts" / "check-docs"
        stub.write_text(f"#!/usr/bin/env bash\nenv > '{dump}'\n")
        stub.chmod(0o755)
        _git(repo, "add", ".")
        _git(repo, "commit", "-qm", "seed")
        _git(repo, "config", "core.hooksPath", ".githooks")
        _git(repo, "remote", "add", "origin", str(origin))
        # A linked worktree, as a session pushes from: there GIT_DIR names
        # the worktree's own git directory.
        tree = tmp_path / "tree"
        _git(repo, "worktree", "add", "-q", "-b", "work", str(tree))
        env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        env.pop("AIDE_SKIP_PRE_PUSH", None)
        subprocess.run(["git", "-C", str(tree), "push", "-q", "origin", "HEAD:main"],
                       check=True, capture_output=True, env=env)

        local = subprocess.run(["git", "rev-parse", "--local-env-vars"], check=True,
                               capture_output=True, text=True).stdout.split()
        leaked = [line.split("=", 1)[0] for line in dump.read_text().splitlines()
                  if line.split("=", 1)[0] in local]
        assert leaked == [], f"the guards started with {leaked} set"
