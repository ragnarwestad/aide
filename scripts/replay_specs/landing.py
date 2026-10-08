"""Where a spec's code landed in its project's code repository, and the commit just before that.

The board lands a code branch with a merge (a first-parent commit that names the branch), a pull request's squash
commit, or a fast-forward that leaves no trace but the archived spec's own `Repo` lines.
"""
import json
import re
import subprocess
from collections import namedtuple
from pathlib import Path

from gitutil import git

Landing = namedtuple("Landing", "before landed")

NOT_FOUND = "no landing of its code found"
NOT_BEGUN = "cannot tell where its code began"
REPO_LINE = re.compile(r"^- \*\*Repo:\*\* `([^`@]*?)\s*@\s*([0-9a-f]{7,40})`", re.M)


class NoLanding(Exception):
    """Why a spec's code cannot be placed in the code repository's history."""


def first_parent_commits(code, rev, *extra):
    """(sha, parents, subject) along the first-parent history of `rev`, newest first."""
    out = git(code, "log", "--first-parent", "--format=%H%x09%P%x09%s", *extra, rev, check=False) or ""
    commits = []
    for line in out.splitlines():
        sha, parents, subject = (line.split("\t", 2) + ["", ""])[:3]
        commits.append((sha, parents.split(), subject))
    return commits


def repo_commits(path, folder):
    """The commits the `Repo` lines naming this spec's code branch give, in the file's order."""
    try:
        text = Path(path).read_text()
    except OSError:
        return []
    return [sha for root, sha in REPO_LINE.findall(text) if root.endswith(f"aide/{folder}")]


def resolve(code, sha):
    return git(code, "rev-parse", "--verify", "--quiet", f"{sha}^{{commit}}", check=False)


def by_merge(code, default, folder):
    subject = f"Merge remote-tracking branch 'refs/remotes/origin/aide/{folder}' into HEAD"
    for sha, parents, line in first_parent_commits(code, default, "--fixed-strings", f"--grep=aide/{folder}"):
        if line == subject and parents:
            return Landing(parents[0], sha)
    return None


def by_squash(code, folder):
    try:
        out = subprocess.run(["gh", "pr", "list", "--head", f"aide/{folder}", "--state", "merged", "--json", "mergeCommit"],
                             cwd=code, capture_output=True, text=True)
        prs = json.loads(out.stdout) if out.returncode == 0 else []
    except (OSError, ValueError):
        return None
    for pr in prs:
        landed = resolve(code, (pr.get("mergeCommit") or {}).get("oid") or "")
        before = resolve(code, f"{landed}^1") if landed else None
        if before:
            return Landing(before, landed)
    return None


def by_fast_forward(code, default, folder, archived):
    """The landed tip is the archived `Repo` line that is on the default branch; the commit before is what the
    branch last caught up with."""
    tips = [resolve(code, sha) for sha in repo_commits(Path(archived) / "4-status.md", folder)]
    tip = next((t for t in tips if t and git(code, "merge-base", "--is-ancestor", t, default, check=False) is not None), None)
    if not tip:
        return None
    caught_up = f"Merge remote-tracking branch 'origin/{re.sub('^origin/', '', default)}' into aide/{folder}"
    for _, parents, subject in first_parent_commits(code, tip):
        if subject == caught_up and len(parents) > 1:
            return Landing(parents[1], tip)
    solution = Path(archived) / "3-solution.md"
    attempts = re.search(r"^- \*\*Attempts:\*\* (\d+)", solution.read_text() if solution.exists() else "", re.M)
    began = next((c for c in map(lambda s: resolve(code, s), repo_commits(solution, folder)) if c), None)
    if began and attempts and attempts.group(1) == "1":
        return Landing(began, tip)
    raise NoLanding(NOT_BEGUN)


def find_landing(code, default, folder, archived, code_landing="merge"):
    """The Landing (commit before, commit landed) of `aide/<folder>` in the default branch of `code`."""
    found = by_merge(code, default, folder)
    if not found and code_landing == "pr":
        found = by_squash(code, folder)
    found = found or by_fast_forward(code, default, folder, archived)
    if not found:
        raise NoLanding(NOT_FOUND)
    return found
