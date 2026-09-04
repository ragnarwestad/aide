"""The origins a run pushes to: one that takes everything, one that
refuses, one that refuses only the second push — and what a test leaves
behind on them to check afterwards.

A fixture here reaches the tests through conftest.py, which imports it:
pytest registers a fixture it finds there whether it was written in that
file or brought into it.

Split out of conftest.py 2026-09-04; unchanged, and each keeps its name.
"""

import json
import os
import pathlib
import re
import shlex
import shutil
import signal
import subprocess
import time
import pytest
from ..conftest import git, run
@pytest.fixture
def origin(workspace, tmp_path):
    """Bare repos standing in for GitHub.

    The project's `origin` keeps a real GitHub fetch URL (that is where
    the compare link comes from) while its PUSH url points at the bare
    repo — so a push is observable without a network.
    """
    project_bare = tmp_path / "origin.git"
    specs_bare = tmp_path / "specs-origin.git"
    for bare in (project_bare, specs_bare):
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
    git(workspace["project"], "remote", "add", "origin", "git@github.com:ragnarwestad/aide.git")
    git(workspace["project"], "remote", "set-url", "--push", "origin", str(project_bare))
    git(workspace["project"], "push", "-q", "origin", "main")
    git(workspace["specs"], "remote", "add", "origin", "git@github.com:ragnarwestad/aide-specs.git")
    git(workspace["specs"], "remote", "set-url", "--push", "origin", str(specs_bare))
    git(workspace["specs"], "push", "-q", "origin", "main")
    return {"project": project_bare, "specs": specs_bare}


@pytest.fixture
def fake_gh(tmp_path):
    """Factory for a stand-in `gh`. Records argv, then behaves as asked."""
    calls = tmp_path / "gh-calls.txt"

    def make(body: str = 'echo "https://github.com/ragnarwestad/aide/pull/7"'):
        path = tmp_path / "fake-gh"
        path.write_text("#!/usr/bin/env bash\n" f'printf "%s\\n" "$*" >> {calls}\n' f"{body}\n")
        path.chmod(0o755)
        return path

    make.calls = calls  # type: ignore[attr-defined]
    return make


def run_with_gh(runner, workspace, claude, gh, **kwargs):
    env_gh = str(gh) if gh else None
    old = os.environ.get("AIDE_GH_BIN")
    if env_gh:
        os.environ["AIDE_GH_BIN"] = env_gh
    try:
        return run(runner, workspace, claude, **kwargs)
    finally:
        if old is None:
            os.environ.pop("AIDE_GH_BIN", None)
        else:
            os.environ["AIDE_GH_BIN"] = old


@pytest.fixture
def local_origin(workspace, tmp_path):
    """Bare repos with a plain LOCAL path as `origin` — no github.com in
    sight, unlike the `origin` fixture above. The shape a throwaway,
    fully local round (spec 367) actually has: nothing to build a
    compare-page link from, but a push that still has to be landable."""
    project_bare = tmp_path / "local-origin.git"
    specs_bare = tmp_path / "local-specs-origin.git"
    for bare in (project_bare, specs_bare):
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
    git(workspace["project"], "remote", "add", "origin", str(project_bare))
    git(workspace["project"], "push", "-q", "origin", "main")
    git(workspace["specs"], "remote", "add", "origin", str(specs_bare))
    git(workspace["specs"], "push", "-q", "origin", "main")
    return {"project": project_bare, "specs": specs_bare}


def is_ancestor(repo, a, b):
    return subprocess.run(
        ["git", "-C", str(repo), "merge-base", "--is-ancestor", a, b]
    ).returncode == 0


@pytest.fixture
def fetchable_origin(workspace, tmp_path):
    """A bare project origin reachable for fetch as well as push."""
    bare = tmp_path / "fetchable-origin.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
    git(workspace["project"], "remote", "add", "origin", str(bare))
    git(workspace["project"], "push", "-q", "origin", "main")
    return bare


@pytest.fixture
def fetchable_origin_both_roots(workspace, tmp_path):
    """A bare origin reachable for fetch and push, wired into BOTH the
    project and the specs repo — `fetchable_origin` only wires up the
    project, which is not enough for a run to end ok:true once REQ-1's
    confirmation asks about every root the step branched."""
    project_bare = tmp_path / "fetchable-origin-project.git"
    specs_bare = tmp_path / "fetchable-origin-specs.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(project_bare)], check=True)
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(specs_bare)], check=True)
    git(workspace["project"], "remote", "add", "origin", str(project_bare))
    git(workspace["project"], "push", "-q", "origin", "main")
    git(workspace["specs"], "remote", "add", "origin", str(specs_bare))
    git(workspace["specs"], "push", "-q", "origin", "main")
    return {"project": project_bare, "specs": specs_bare}


def _reject_every_push(bare):
    """A bare repo whose `pre-receive` hook refuses everything: the push
    reaches the network and is SEEN, then refused — the shape REQ-2/
    REQ-3/REQ-6 need, unlike an origin that is simply unreachable."""
    hook = bare / "hooks" / "pre-receive"
    hook.write_text("#!/usr/bin/env bash\nexit 1\n")
    hook.chmod(0o755)


@pytest.fixture
def rejecting_origin(workspace, tmp_path):
    """Both roots wired to a bare origin that is reachable but refuses
    every push — a step's own content never reaches origin at all."""
    project_bare = tmp_path / "rejecting-origin-project.git"
    specs_bare = tmp_path / "rejecting-origin-specs.git"
    for bare in (project_bare, specs_bare):
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
        _reject_every_push(bare)
    git(workspace["project"], "remote", "add", "origin", str(project_bare))
    git(workspace["specs"], "remote", "add", "origin", str(specs_bare))
    return {"project": project_bare, "specs": specs_bare}


@pytest.fixture
def specs_origin_rejecting_the_second_push(workspace, tmp_path):
    """REQ-2: the specs root's FIRST push (the step's own content, pass
    1) succeeds; every push after that (the line-only commit, pass 2) is
    refused. Proves pass 2's confirmation is checked independently of
    pass 1's success, using a fixture nothing here already provides."""
    bare = tmp_path / "specs-origin-reject-second-push.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
    counter = tmp_path / "specs-origin-push-count"
    hook = bare / "hooks" / "pre-receive"
    hook.write_text(
        "#!/usr/bin/env bash\n"
        f'n=0; [ -f "{counter}" ] && n="$(cat "{counter}")"\n'
        f'n=$((n + 1)); echo "$n" > "{counter}"\n'
        '[ "$n" -ge 2 ] && exit 1\n'
        "exit 0\n"
    )
    hook.chmod(0o755)
    git(workspace["specs"], "remote", "add", "origin", str(bare))
    return bare


@pytest.fixture
def local_origins(workspace, tmp_path):
    """A REAL local bare origin for both roots.

    The shared `origin` fixture points the fetch URL at a github.com
    address on purpose (that is where the compare link comes from), which
    no dependency check can talk to. These tests need an origin that
    actually answers.
    """
    bares = {}
    for key in ("project", "specs"):
        bare = tmp_path / f"{key}-local.git"
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)], check=True)
        git(workspace[key], "remote", "add", "origin", str(bare))
        git(workspace[key], "push", "-q", "-u", "origin", "main")
        bares[key] = bare
    return bares


def leave_branch_on_origin(workspace, branch, key="specs"):
    """What a previous aide-run-spec leaves behind: the branch on origin,
    with no local branch in this checkout. It points at HEAD, so it is
    fully merged — see leave_unmerged_branch_on_origin for the other case."""
    git(workspace[key], "push", "-q", "origin", f"HEAD:refs/heads/{branch}")


def leave_unmerged_branch_on_origin(workspace, branch, key="specs"):
    """A branch on origin with a commit main does not have: work that is
    still waiting to be merged."""
    repo = workspace[key]
    git(repo, "checkout", "-q", "-b", "tmp-unmerged")
    (repo / "unmerged.txt").write_text("not on main\n")
    git(repo, "add", "unmerged.txt")
    git(repo, "commit", "-qm", "work still to merge")
    git(repo, "push", "-q", "origin", f"HEAD:refs/heads/{branch}")
    git(repo, "checkout", "-q", "main")
    git(repo, "branch", "-q", "-D", "tmp-unmerged")


def archive_the_spec(workspace):
    """Leave the spec where a finished archive step leaves it: under
    `archive/`, with the folder's own name unchanged."""
    specs = workspace["specs"]
    (specs / "archive").mkdir(exist_ok=True)
    subprocess.run(
        ["git", "-C", str(specs), "mv", workspace["folder"], f"archive/{workspace['folder']}"],
        check=True,
    )
    subprocess.run(["git", "-C", str(specs), "commit", "-qm", "archive the spec"], check=True)


def make_branch(root, branch, note="leftover"):
    """A branch left over from an earlier round, with a commit of its
    own, without moving the checkout off its default branch."""
    head = git(root, "rev-parse", "HEAD")
    git(root, "branch", branch, head)
    return head


def has_branch(root, branch):
    return subprocess.run(
        ["git", "-C", str(root), "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"]
    ).returncode == 0
