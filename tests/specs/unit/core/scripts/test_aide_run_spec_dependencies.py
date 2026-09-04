"""What a spec says it depends on: the runs that are refused while that
dependency is unmerged or unarchived, and the ones that go ahead once
origin confirms it.

Split out of test_aide_run_spec_links.py 2026-09-04; the tests are
unchanged and keep their names.
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
import pytest
from .conftest import git, run
from .run_spec_fakes import writing_claude
from .run_spec_invoking import run_traced
from .run_spec_origins import leave_branch_on_origin, leave_unmerged_branch_on_origin, local_origins, origin
from .run_spec_status_files import add_spec, set_depends_on


def test_a_spec_without_the_field_asks_origin_nothing(
    runner, workspace, fake_claude, local_origins, tmp_path
):
    """The feature is opt-in: a spec with no `Depends on:` line behaves
    exactly as it did before it existed — no talking to origin at all,
    even with an unmerged spec branch sitting there."""
    add_spec(workspace, "80-dependency")
    leave_branch_on_origin(workspace, "aide/80-dependency")

    rc, out, trace = run_traced(
        runner, workspace, writing_claude(fake_claude, workspace), tmp_path,
        command="implement",
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"
    assert "ls-remote" not in trace and "fetch" not in trace, trace

def test_refuses_while_a_named_dependency_is_still_unmerged(
    runner, workspace, fake_claude, local_origins
):
    add_spec(workspace, "80-dependency")
    leave_unmerged_branch_on_origin(workspace, "aide/80-dependency")
    set_depends_on(workspace, "80")

    claude = fake_claude("exit 1")  # would fail loudly if it were called
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 2
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"
    # The message names the spec, the dependency, and that it is not
    # archived yet (spec 351) — nobody should have to guess which of the
    # two specs is the problem.
    assert workspace["folder"] in out["error"]
    assert "80-dependency" in out["error"]
    assert "not archived yet" in out["error"]
    assert not fake_claude.calls.exists(), "the refusal must precede the money"
    assert not workspace["wtbase"].exists(), "and leave no worktree behind"

def test_a_dependency_merged_but_not_archived_still_refuses(
    runner, workspace, fake_claude, local_origins
):
    """Merged is not the same question as archived (spec 351). The Merge
    button deletes the branch after merging (spec 99), but an archive
    step re-creates it and merges it again minutes later — 97 and 102
    were each refused against a dependency whose branch was fully on
    main. Landing the code is not the same as archiving the spec: the
    folder is still under the active list, not archive/, so a dependent
    must still wait."""
    add_spec(workspace, "80-dependency")
    # The dependency's branch points AT origin's main: everything on it
    # is merged, only the name is left — but its folder is still active,
    # not archived.
    git(workspace["specs"], "push", "-q", "origin", "main")
    leave_branch_on_origin(workspace, "aide/80-dependency")
    set_depends_on(workspace, "80")

    claude = fake_claude("exit 1")  # would fail loudly if it were called
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 2
    assert out["terminalReason"] == "refused"
    assert "80-dependency" in out["error"]
    assert "not archived yet" in out["error"]
    assert not fake_claude.calls.exists(), "the refusal must precede the money"

def test_a_dependency_with_no_branch_and_not_archived_still_refuses(
    runner, workspace, fake_claude, local_origins
):
    """The 340/341 shape (spec 351): a dependency whose last landed step
    deleted its branch and whose next step has not pushed a new one has
    no branch on origin at all — and used to read as 'merged'. Its
    folder never reached origin either way, so it is not archived and
    the dependent must still wait."""
    add_spec(workspace, "80-dependency")
    set_depends_on(workspace, "80")

    claude = fake_claude("exit 1")  # would fail loudly if it were called
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 2
    assert out["terminalReason"] == "refused"
    assert "80-dependency" in out["error"]
    assert "not archived yet" in out["error"]
    assert not fake_claude.calls.exists(), "the refusal must precede the money"

def test_the_full_folder_name_resolves_as_well_as_the_number(
    runner, workspace, fake_claude, local_origins
):
    add_spec(workspace, "80-dependency")
    leave_unmerged_branch_on_origin(workspace, "aide/80-dependency")
    set_depends_on(workspace, "`80-dependency`")

    rc, out, _ = run(runner, workspace, fake_claude("exit 1"), command="implement")
    assert rc == 2
    assert "80-dependency" in out["error"]

def test_refuses_an_unknown_dependency(runner, workspace, fake_claude, local_origins):
    """A typo must stop the run rather than pass as 'nothing to wait
    for' — a silently ignored dependency is worse than none."""
    set_depends_on(workspace, "77")

    rc, out, _ = run(runner, workspace, fake_claude("exit 1"), command="implement")
    assert rc == 2
    assert out["terminalReason"] == "refused"
    assert "77" in out["error"]
    assert "unknown" in out["error"]
    assert not fake_claude.calls.exists()

def test_refuses_a_spec_that_depends_on_itself(
    runner, workspace, fake_claude, local_origins
):
    set_depends_on(workspace, "81")

    rc, out, _ = run(runner, workspace, fake_claude("exit 1"), command="implement")
    assert rc == 2
    assert out["terminalReason"] == "refused"
    assert "itself" in out["error"]
    assert not fake_claude.calls.exists()

def test_an_archived_dependency_confirmed_on_origin_lets_the_run_proceed(
    runner, workspace, fake_claude, local_origins, tmp_path
):
    """Archived is confirmed via a real read of origin (spec 351, REQ-2),
    never skipped because the local checkout already shows the folder
    under archive/ — the same staleness spec 343 already refused to
    trust for a landed commit."""
    add_spec(workspace, "80-dependency", archived=True)
    git(workspace["specs"], "push", "-q", "origin", "main")
    leave_branch_on_origin(workspace, "aide/80-dependency")
    set_depends_on(workspace, "80")

    rc, out, trace = run_traced(
        runner, workspace, writing_claude(fake_claude, workspace), tmp_path,
        command="implement",
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"
    assert "cat-file" in trace, "confirmed via a real read of origin, not skipped"

def test_a_dependency_archived_on_origin_is_confirmed_even_if_this_checkout_has_not_pulled(
    runner, workspace, fake_claude, local_origins, tmp_path
):
    """The check ASKS origin; it does not believe this checkout's own
    directory listing (spec 351, REQ-2).

    A dependency archived somewhere else — a later run, another
    machine — must be seen even before this checkout has ever pulled
    that commit. Believing the local listing instead would refuse every
    dependent run until someone happens to `git pull` first.
    """
    add_spec(workspace, "80-dependency")
    git(workspace["specs"], "push", "-q", "origin", "main")
    set_depends_on(workspace, "80")

    # Archived from a SEPARATE clone of the same bare origin, without
    # workspace["specs"] (this checkout) ever fetching that commit.
    clone = tmp_path / "elsewhere-specs"
    subprocess.run(["git", "clone", "-q", str(local_origins["specs"]), str(clone)], check=True)
    subprocess.run(["git", "-C", str(clone), "config", "user.name", "Elsewhere"], check=True)
    subprocess.run(["git", "-C", str(clone), "config", "user.email", "elsewhere@example.com"], check=True)
    (clone / "archive").mkdir(exist_ok=True)
    subprocess.run(["git", "-C", str(clone), "mv", "80-dependency", "archive/80-dependency"], check=True)
    subprocess.run(["git", "-C", str(clone), "commit", "-qm", "archive 80-dependency"], check=True)
    subprocess.run(["git", "-C", str(clone), "push", "-q", "origin", "main"], check=True)

    assert (workspace["specs"] / "80-dependency").exists(), \
        "this checkout must still show it active — the premise of the test"

    rc, out, _ = run(
        runner, workspace, writing_claude(fake_claude, workspace), command="implement"
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed"
    assert (workspace["specs"] / "80-dependency").exists(), \
        "the answer came from origin, not from moving anything locally"
