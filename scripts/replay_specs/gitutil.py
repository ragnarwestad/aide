"""Running git, the one way every module of the script does."""
import subprocess


class GitError(Exception):
    """A git command that had to work did not."""


def git(repo, *args, check=True, env=None):
    """git's stdout, stripped. With check=False a failing command gives None instead of raising."""
    p = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, env=env)
    if p.returncode != 0:
        if check:
            raise GitError(f"git {' '.join(args)} failed in {repo}: {p.stderr.strip()}")
        return None
    return p.stdout.strip()
