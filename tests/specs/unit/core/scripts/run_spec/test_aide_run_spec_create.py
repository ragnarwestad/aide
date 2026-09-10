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

def test_create_states_the_acceptance_record_when_the_flag_is_given(runner, workspace, fake_claude):
    """Spec 394: stated to the skill, not just to the harness, mirroring
    `depends_line` — Step 4 is the step that actually writes the file,
    so the instruction names it by number."""
    claude = fake_claude("exit 1")
    rc, out, _ = create(runner, workspace, claude, acceptance_not_required=True, dry_run=True)
    assert rc == 0, out
    prompt = out["prompt"]
    assert (
        "Record this spec's Tracking info with an explicit "
        "acceptance-not-required line (Step 4)." in prompt
    ), prompt

def test_create_states_that_acceptance_is_required_when_the_flag_is_absent(runner, workspace, fake_claude):
    """BOTH answers are stated, never one. `/aide-create`'s own Step 4
    defaults to acceptance-not-required when it is told nothing, and the
    New-spec form's unticked box means the opposite — so silence here
    wrote "not required" onto a spec whose author had asked for the
    ticking. A run that knows the answer says it."""
    claude = fake_claude("exit 1")
    rc, out, _ = create(runner, workspace, claude, dry_run=True)
    assert rc == 0, out
    prompt = out["prompt"]
    assert "Acceptance ticking IS required for this spec" in prompt, prompt
    assert "do not pass --acceptance-not-required" in prompt, prompt
    # And never the other instruction alongside it.
    assert "Record this spec's Tracking info with an explicit" not in prompt, prompt


def test_the_two_acceptance_answers_are_never_both_stated(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")
    rc, out, _ = create(runner, workspace, claude, acceptance_not_required=True, dry_run=True)
    assert rc == 0, out
    assert "Acceptance ticking IS required" not in out["prompt"], out["prompt"]

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

# --- spec 433: create with no AI session at all ------------------------------

def test_create_with_no_ai_formulate_spawns_no_ai(runner, workspace, fake_claude):
    """AC-1: the box cleared means create writes the spec directly, no
    claude/codex process at all — regardless of whether the description
    has an '## Acceptance criteria' section."""
    claude = fake_claude("exit 1")
    rc, out, _ = create(
        runner, workspace, claude,
        title="A new spec", description="Do the thing that was asked for",
        no_ai_formulate=True,
    )
    assert rc == 0, out
    assert out["ok"] is True, out
    assert not fake_claude.calls.exists()


def test_create_with_no_ai_formulate_reports_zero_measured_cost_and_tool_none(runner, workspace, fake_claude):
    """AC-2/AC-6: the result JSON says the step is done, cost 0, measured,
    and names which of the two paths create took."""
    claude = fake_claude("exit 1")
    rc, out, _ = create(runner, workspace, claude, no_ai_formulate=True)
    assert rc == 0, out
    assert out["costUsd"] == 0, out
    assert out["costMeasured"] is True, out
    assert out["tool"] == "none", out
    assert out["terminalReason"] == "completed", out


def test_create_with_no_ai_formulate_makes_the_next_numbered_folder(runner, workspace, fake_claude):
    """AC-3: the next free number, and the same 5 files a real
    aide-create-spec call would write for the same inputs."""
    claude = fake_claude("exit 1")
    rc, out, _ = create(
        runner, workspace, claude,
        title="A new spec", description="Do the thing that was asked for",
        no_ai_formulate=True,
    )
    assert rc == 0, out
    assert out["specFolder"] == "82-a-new-spec", out
    # The commit landed on the branch the step reported — read straight
    # off the object store, the same way the existing
    # test_create_reports_the_folder_the_step_actually_made does, rather
    # than off a checkout no push_mode="none" run ever updates.
    branch_log = git(workspace["specs"], "log", "--stat", "--oneline", f"aide/{CREATE_KEY}")
    for name in ["0-README.md", "1-description.md", "2-analysis.md", "3-solution.md", "4-status.md"]:
        assert f"82-a-new-spec/{name}" in branch_log, branch_log


def test_create_with_no_ai_formulate_states_depends_on_and_acceptance(runner, workspace, fake_claude):
    """AC-3: Depends on and the acceptance choice reach Tracking info
    exactly as the form set them."""
    claude = fake_claude("exit 1")
    rc, out, _ = create(
        runner, workspace, claude,
        depends_on="81-queue-and-runner", acceptance_not_required=True,
        no_ai_formulate=True,
    )
    assert rc == 0, out
    text = git(
        workspace["specs"], "show", f"aide/{CREATE_KEY}:{out['specFolder']}/1-description.md",
    )
    assert "Depends on" in text and "81-queue-and-runner" in text, text
    assert "Acceptance:" in text and "not required" in text, text


def test_create_with_no_ai_formulate_surfaces_a_refused_write(runner, workspace, fake_claude):
    """A refused aide-create-spec call (here: a malformed AC line) must
    surface as ok:false, not be swallowed as a mechanical success."""
    claude = fake_claude("exit 1")
    rc, out, _ = create(
        runner, workspace, claude,
        description="- AC-1: forgot the bold markers",
        no_ai_formulate=True,
    )
    assert out["ok"] is False, out
    assert out["terminalReason"] == "cli-error", out


def test_create_without_the_flag_still_spawns_ai_byte_for_byte(runner, workspace, fake_claude):
    """AC-5: the box left ticked (the flag omitted) produces exactly
    today's argv/prompt — the no-AI path changes nothing about it."""
    claude = fake_claude("exit 1")
    rc, out, _ = create(runner, workspace, claude, dry_run=True)
    assert rc == 0, out
    assert out["prompt"].startswith("/aide-create TODO-a-new-spec"), out


def test_create_with_no_ai_formulate_finishes_well_under_the_time_limit(runner, workspace, fake_claude):
    """AC-2's timing clause: the whole step, not merely the missing AI
    spawn."""
    claude = fake_claude("exit 1")
    started = time.time()
    rc, out, _ = create(runner, workspace, claude, no_ai_formulate=True)
    elapsed = time.time() - started
    assert rc == 0, out
    assert elapsed < 25, f"took {elapsed}s"


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

