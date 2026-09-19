"""A run's worktree links (`.venv`, `dashboard/node_modules`) are symlinks
into the main checkout. Committed, they sit in the way of every checkout
that has its own, and the serving host's checkout then cannot be brought
up to date: Deploy stops with "cannot fast-forward it"."""
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[5]


def test_no_worktree_link_is_tracked():
    tracked = subprocess.run(
        ["git", "-C", str(REPO), "ls-files", "--", ".venv", "dashboard/node_modules"],
        capture_output=True, text=True, check=True,
    ).stdout.split()
    assert tracked == [], f"worktree links committed to the repo: {tracked}"
