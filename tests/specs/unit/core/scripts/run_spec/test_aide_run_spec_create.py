"""The two steps outside the ordinary four: create, for a spec that does
not exist yet, and schedule, for a job with no spec at all.

Split out of test_aide_run_spec_gates.py 2026-09-04; the tests are
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
from ..conftest import git, run
from .run_spec_fakes import creating_claude
from .run_spec_invoking import CREATE_KEY, SCHEDULE_KEY, create, schedule


def test_create_refuses_without_a_description(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = create(runner, workspace, claude, description=None)
    assert rc == 2
    assert out["ok"] is False
    assert "description" in out["error"], out
    assert not fake_claude.calls.exists()

def test_every_other_step_still_refuses_an_unknown_spec(runner, workspace, fake_claude):
    """The create path is an addition, never a widening: `analyze` on a
    spec that does not exist is still refused, with the same words."""
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude, command="analyze", spec="no-such-spec")
    assert rc == 2
    assert "unknown spec" in out["error"], out
    assert not fake_claude.calls.exists()

def test_create_asks_the_skill_for_a_spec_by_title_and_description(runner, workspace, fake_claude):
    """`/aide-create TODO-<name> <description>` is the skill's own
    documented argument shape (core/skills/aide-create/SKILL.md), so no
    parsing is invented on either side. The title is ALSO stated on a
    line of its own: the positional token is slugified, and a title is
    not something to recover from a slug."""
    claude = fake_claude("exit 1")
    rc, out, _ = create(
        runner, workspace, claude,
        title="A new spec", description="Do the thing that was asked for",
        dry_run=True,
    )
    assert rc == 0, out
    prompt = out["prompt"]
    assert prompt.startswith("/aide-create TODO-a-new-spec Do the thing that was asked for"), prompt
    assert "Use exactly this title for the spec: A new spec" in prompt, prompt
    assert "headless" in prompt.lower()
    # The generic shape every other step uses would name a spec id this
    # spec does not have yet.
    assert f"/aide-create {CREATE_KEY}" not in prompt

def test_create_states_the_depends_on_value_the_form_chose(runner, workspace, fake_claude):
    """Spec 110: the `Depends on:` line has had a reader since spec 92 and
    no writer but a person at a shell. The value is STATED in the prompt,
    in the same voice as the title, for the same reason: it is a fact the
    skill is told, not a sub-format invented inside the argument string."""
    claude = fake_claude("exit 1")
    rc, out, _ = create(runner, workspace, claude, depends_on="92,97-freshness", dry_run=True)
    assert rc == 0, out
    prompt = out["prompt"]
    assert "Use exactly this Depends-on value in Tracking info: 92,97-freshness" in prompt, prompt
    # Still the skill's own argument shape, and still the title beside it.
    assert prompt.startswith("/aide-create TODO-a-new-spec"), prompt
    assert "Use exactly this title for the spec: A new spec" in prompt, prompt

def test_create_without_the_flag_says_nothing_about_dependencies(runner, workspace, fake_claude):
    """Nothing chosen means no line — so the prompt must not mention the
    field at all, rather than state an empty one for the skill to write."""
    claude = fake_claude("exit 1")
    rc, out, _ = create(runner, workspace, claude, dry_run=True)
    assert rc == 0, out
    assert "Depends-on" not in out["prompt"], out["prompt"]

def test_create_reports_the_folder_the_step_actually_made(runner, workspace, fake_claude):
    """Read off the disk, never computed: the run diffs the specs root
    before and after, so the number and the slug stay the skill's
    business alone."""
    claude = creating_claude(fake_claude, ["94-a-new-spec"])
    rc, out, _ = create(runner, workspace, claude)
    assert rc == 0, out
    assert out["specFolder"] == "94-a-new-spec", out
    # And the work is committed under the name the spec really has, not
    # under the throwaway key.
    branch_log = git(workspace["specs"], "log", "--oneline", f"aide/{CREATE_KEY}")
    assert "94-a-new-spec" in branch_log, branch_log

def test_create_reports_no_folder_when_two_appeared(runner, workspace, fake_claude):
    """Ambiguity is left unreported rather than guessed at: the spec
    still lands, and the job simply keeps its provisional key."""
    claude = creating_claude(fake_claude, ["94-a-new-spec", "95-another-spec"])
    rc, out, _ = create(runner, workspace, claude)
    assert rc == 0, out
    assert "specFolder" not in out, out

def test_create_reports_no_folder_when_none_appeared(runner, workspace, fake_claude):
    claude = creating_claude(fake_claude, [])
    rc, out, _ = create(runner, workspace, claude)
    assert rc == 0, out
    assert "specFolder" not in out, out

def test_schedule_runs_with_no_spec_folder_and_sends_the_file_verbatim(
    runner, workspace, fake_claude
):
    """AC4: `--command schedule --prompt-file <path>` with no folder for
    the tracking key under the specs root must not refuse with `unknown
    spec: ...`, and the prompt is the named file's own contents, not an
    aide slash command."""
    (workspace["project"] / "docs").mkdir()
    (workspace["project"] / "docs" / "nightly-report.md").write_text(
        "Summarize last night's traffic.\n"
    )
    claude = fake_claude("cat > /dev/null\nexit 1")
    rc, out, _ = schedule(runner, workspace, claude, dry_run=True)
    assert rc == 0, out
    assert "unknown spec" not in out.get("error", ""), out
    prompt = out["prompt"]
    assert prompt.startswith("Summarize last night's traffic."), prompt
    assert "headless" in prompt.lower()
    assert "/aide-" not in prompt, prompt

def test_schedule_requires_a_prompt_file(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = schedule(runner, workspace, claude, prompt_file=None)
    assert rc == 2
    assert out["ok"] is False
    assert "prompt-file" in out["error"], out
    assert not fake_claude.calls.exists()

def test_schedule_refuses_a_missing_prompt_file(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = schedule(runner, workspace, claude, prompt_file="docs/does-not-exist.md")
    assert rc == 2
    assert out["ok"] is False
    assert "prompt-file" in out["error"], out
    assert not fake_claude.calls.exists()

def test_every_other_step_still_refuses_the_schedule_tracking_key(runner, workspace, fake_claude):
    """The exemption is additive: `analyze` on a schedule-shaped key that
    names no real spec folder is refused exactly as any other unknown
    spec would be."""
    claude = fake_claude("exit 1")
    rc, out, _ = run(runner, workspace, claude, command="analyze", spec=SCHEDULE_KEY)
    assert rc == 2
    assert "unknown spec" in out["error"], out
    assert not fake_claude.calls.exists()

