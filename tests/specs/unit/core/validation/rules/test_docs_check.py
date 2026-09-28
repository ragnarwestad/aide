"""The pre-push hook starts the documentation guards without the git
environment it was handed, so their scratch repositories stay scratch."""
from pathlib import Path

ROOT = Path(__file__).parents[6]
HOOK = ROOT / ".githooks" / "pre-push"


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
