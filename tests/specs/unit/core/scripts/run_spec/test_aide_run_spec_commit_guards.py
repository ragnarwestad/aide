"""The commit a run makes is its own, whatever state reaches it. 501's
Cancel reached the commit with neither the run's start nor its worktree
links known: it folded the work into main's last commit, under that
commit's message, links included — and merged, the links stopped the
serving checkout's fast-forward (2026-09-19)."""

import os
import subprocess
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[6] / "core" / "scripts"


def _git(cwd, *args):
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, check=True).stdout.strip()


def _repo_with_a_run(tmp_path):
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True)
    root = tmp_path / "root"
    subprocess.run(["git", "clone", "-q", str(origin), str(root)], check=True, capture_output=True)
    for k, v in (("user.name", "t"), ("user.email", "t@t")):
        _git(root, "config", k, v)
    (root / ".aide").mkdir()
    (root / ".aide" / "project.yaml").write_text("worktreeLinks: deps\n")
    (root / ".gitignore").write_text("/deps/\n")
    (root / "deps").mkdir()
    (root / "README").write_text("main\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "Main's own last commit")
    _git(root, "push", "-q", "origin", "main")
    wt = tmp_path / "wt"
    _git(root, "worktree", "add", "-q", "-b", "aide/7-x", str(wt), "main")
    os.symlink(root / "deps", wt / "deps")
    (wt / "work.txt").write_text("half done\n")
    return root, wt


def _commit_with_lost_state(root, wt):
    script = f"""
set -uo pipefail
source "{SCRIPTS}/_aide-spec-lib.sh"
source "{SCRIPTS}/lib/run-spec-worktree.sh"
roots=("{root}"); work_roots=("{wt}")
branch="aide/7-x"; push_mode="none"; command_name="implement"
commit_label="7-x"; model_suffix=""; suffix=" (stopped: cancelled)"; amend_note=""
set +u
source "{SCRIPTS}/lib/run-spec-publish.sh"
unset head_before head_after_per_root git_add_excludes
commit_and_push_roots
"""
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True)


def test_a_commit_already_on_origin_is_never_amended(tmp_path):
    root, wt = _repo_with_a_run(tmp_path)
    main_tip = _git(root, "rev-parse", "main")
    _commit_with_lost_state(root, wt)
    assert _git(wt, "rev-parse", "HEAD^") == main_tip, "main's own commit was amended"
    assert _git(wt, "log", "-1", "--format=%s") == "WIP: 7-x", "a commit of its own, marked unfinished"
    assert _git(wt, "show", "HEAD:work.txt") == "half done"


def test_the_worktree_links_stay_out_of_the_commit(tmp_path):
    root, wt = _repo_with_a_run(tmp_path)
    _commit_with_lost_state(root, wt)
    assert _git(wt, "ls-tree", "--name-only", "HEAD", "deps") == "", "the worktree's link was committed"
