"""Each phase's own record: the outcome block it writes into Tracking
info, the tokens and the effort beside it, how many attempts it took —
and reopening or resetting a spec, which draws a line under everything
before it.

Split out of test_aide_run_spec_records.py 2026-09-04; the tests are
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
from ..conftest import READ_SPECS, git, run
from .run_spec_fakes import analyzing_claude, specs_only_claude
from .run_spec_invoking import BRANCH, create
from .run_spec_origins import archive_the_spec, has_branch, make_branch, origin
from .run_spec_results import CODEX_STREAM_FAILED, CODEX_STREAM_OK, CODEX_USAGE, FLAT_USAGE, RESULT_OK, emits
from .run_spec_status_files import TIME_OF_DAY_RE, TIME_SPENT_RE, already_ran, bullet, phase_file_text, recorded_line, reopen_line, reset_line, subject, tracking_block, with_analysis, with_analysis_attempts, with_solution, with_status


def test_a_create_run_records_its_own_outcome_and_no_repo_line(
    runner, workspace, fake_claude
):
    """AC1: `create` gains a time of day on `Created:`, and `Model` (when
    a model was named), `Result: completed` and `Time spent` — but no
    `Repo` line, since nothing was yet analyzed against."""
    made = "99-a-brand-new-spec"
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'mkdir -p "$specs/{made}"\n'
        + f'printf "%s\\n" "# New - Description" "" "## Tracking info" "" '
        + f'"- **Task:** \\`{made}/\\`" "- **Created:** \\`2026-08-01\\`" '
        + f'> "$specs/{made}/1-description.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="create", spec="81",
                     model="claude-sonnet-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{made}/1-description.md")
    created = bullet(text, "Created")
    assert created and TIME_OF_DAY_RE.match(created), created
    assert bullet(text, "Model") == "claude claude-sonnet-5"
    assert bullet(text, "Result") == "completed"
    time_spent = bullet(text, "Time spent")
    assert time_spent and TIME_SPENT_RE.match(time_spent), time_spent
    assert bullet(text, "Repo") is None

def test_a_create_run_with_an_effort_records_it_beside_the_model(runner, workspace, fake_claude):
    """REQ-5: an `--effort` a run was given lands as its own bullet in the
    phase file's own Tracking info, beside `- **Model:**`."""
    made = "99-a-brand-new-spec"
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'mkdir -p "$specs/{made}"\n'
        + f'printf "%s\\n" "# New - Description" "" "## Tracking info" "" '
        + f'"- **Task:** \\`{made}/\\`" "- **Created:** \\`2026-08-01\\`" '
        + f'> "$specs/{made}/1-description.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="create", spec="81",
                     model="claude-sonnet-5", effort="high")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{made}/1-description.md")
    assert bullet(text, "Model") == "claude claude-sonnet-5"
    assert bullet(text, "Effort") == "high"

def test_a_run_with_no_effort_writes_no_effort_line(runner, workspace, fake_claude):
    """REQ-4/REQ-5's second half: "absence over a guess" — a run given no
    `--effort` writes no `- **Effort:**` line at all, never an empty one."""
    with_status(workspace)
    claude = analyzing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, model="claude-sonnet-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert bullet(text, "Model") == "claude claude-sonnet-5"
    assert bullet(text, "Effort") is None

def test_a_re_run_replaces_a_stale_effort_line_rather_than_duplicating_it(
    runner, workspace, fake_claude
):
    """Mirrors the Model line's own re-run test: a second run at a
    different effort leaves exactly one `- **Effort:**` line, holding the
    newest run's value."""
    with_status(workspace)
    claude1 = analyzing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude1, model="claude-haiku-4-5", effort="low")
    assert rc == 0, out
    claude2 = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude2, model="claude-opus-5", effort="max")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert text.count("- **Effort:**") == 1, text
    assert bullet(text, "Effort") == "max"

def test_an_analyze_run_writes_one_repo_line_per_root(runner, workspace, fake_claude):
    """AC2: `Last analyzed:` gains a time of day, and the Tracking info
    gains one `Repo` line per repo root, each matching that root's own
    `head_before`."""
    with_status(workspace)
    claude = analyzing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, model="claude-sonnet-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    last_analyzed = bullet(text, "Last analyzed")
    assert last_analyzed and TIME_OF_DAY_RE.match(last_analyzed), last_analyzed
    repo_lines = [
        ln for ln in tracking_block(text).split("\n") if ln.startswith("- **Repo:**")
    ]
    assert len(repo_lines) == 2, repo_lines
    assert any(ln.startswith("- **Repo:** `proj/aide/81-queue-and-runner @ ") for ln in repo_lines), repo_lines
    assert any(ln.startswith("- **Repo:** `specs/aide/81-queue-and-runner @ ") for ln in repo_lines), repo_lines
    assert bullet(text, "Model") == "claude claude-sonnet-5"
    assert bullet(text, "Result") == "completed"

def test_an_implement_run_stopped_by_timeout_records_the_stop(
    runner, workspace, fake_claude
):
    """AC3: a run stopped by its own time limit records that in
    `3-solution.md`'s `Result` line rather than `completed`."""
    with_status(workspace, ["analyze"])
    with_solution(workspace)
    claude = fake_claude(
        "cat > /dev/null\n"
        'echo "half-written" > "$PWD/half.txt"\n'
        "trap '' TERM\n"
        "while true; do sleep 0.2; done"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement",
                     timeout_sec="8", kill_grace_sec="2")
    assert out["terminalReason"] == "timeout"
    text = phase_file_text(workspace, f"{workspace['folder']}/3-solution.md")
    result_line = bullet(text, "Result")
    assert result_line.startswith("stopped (timeout)"), result_line

def test_a_failed_cli_run_records_a_sanitized_error_summary(
    runner, workspace, fake_claude
):
    """AC4: a CLI failure's `Result` line carries `stopped (cli-error)`
    followed by a one-line, backtick-free summary, truncated to at most
    200 characters — never the raw multi-line error verbatim."""
    with_status(workspace, ["analyze"])
    with_solution(workspace)
    long_error = ("line one with a `backtick`\n" + "x" * 300)
    result = {**RESULT_OK, "is_error": True, "errors": [long_error]}
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(result)}'")
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "cli-error"
    text = phase_file_text(workspace, f"{workspace['folder']}/3-solution.md")
    result_line = bullet(text, "Result")
    assert result_line.startswith("stopped (cli-error)"), result_line
    assert "`" not in result_line, result_line
    assert "\n" not in result_line, result_line
    assert len(result_line) <= 200 + len("stopped (cli-error) — "), result_line

def test_an_archive_run_keeps_the_steps_line_and_adds_its_own_block(
    runner, workspace, fake_claude
):
    """AC5: `4-status.md` keeps the unchanged `Workflow steps completed:`
    line AND gains the new outcome block for `archive` itself — with no
    `Model (create|analyze|implement):` lines written by this run."""
    with_status(workspace, done=True)
    already_ran(workspace, ["create", "analyze", "implement"], write_line=True)
    folder = workspace["folder"]
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive",
                     model="claude-sonnet-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"archive/{folder}/4-status.md")
    assert recorded_line(workspace, path=f"archive/{folder}/4-status.md") == "create, analyze, implement, archive"
    assert bullet(text, "Model") == "claude claude-sonnet-5"
    assert bullet(text, "Result") == "completed"
    assert bullet(text, "Time spent") is not None
    for step in ("create", "analyze", "implement"):
        assert f"Model ({step})" not in text, text

def test_a_re_run_of_the_same_step_replaces_the_block_not_duplicates_it(
    runner, workspace, fake_claude
):
    """AC6: running the same step twice leaves the phase file's block
    reflecting only the newest run — no duplicate lines, and the date
    field's time is overwritten rather than duplicated."""
    with_status(workspace)
    claude1 = analyzing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude1, model="claude-haiku-4-5")
    assert rc == 0, out
    # The second run leaves 2-analysis.md untouched — a re-run whose
    # file already carries the first run's block by the time THIS run's
    # own writer processes it, which is exactly the shape a real re-run
    # has (the file is not rewritten from scratch every time).
    claude2 = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude2, model="claude-opus-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert text.count("- **Model:**") == 1, text
    assert text.count("- **Result:**") == 1, text
    assert text.count("- **Time spent:**") == 1, text
    assert text.count("- **Last analyzed:**") == 1, text
    assert bullet(text, "Model") == "claude claude-opus-5"

def test_a_result_bullet_outside_tracking_info_survives_the_write(
    runner, workspace, fake_claude
):
    """AC7: a `Result:`-shaped bullet the model wrote elsewhere in the
    same file (e.g. in prose about a past attempt) is not Tracking info,
    and the phase-outcome writer must not touch it."""
    with_status(workspace)
    folder = workspace["folder"]
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "%s\\n" "# Queue - Analysis" "" "## Tracking info" "" '
        + f'"- **Task:** \\`{folder}/\\`" "- **Last analyzed:** \\`2026-08-01\\`" "" '
        + '"## Findings" "" "- **Result:** the earlier fix worked" '
        + f'> "$specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude)
    assert rc == 0, out
    text = phase_file_text(workspace, f"{folder}/2-analysis.md")
    assert "- **Result:** the earlier fix worked" in text, text
    # And Tracking info still gained its OWN Result line, alongside it.
    assert bullet(text, "Result") == "completed"

def test_a_codex_run_writes_a_tokens_line_with_no_cost_line(runner, workspace, fake_codex):
    """AC3: a Codex phase's own file gains a `Tokens:` bullet off the
    same `tokens_json` the result JSON already carries, with no `Cost:`
    line at all."""
    with_status(workspace)
    with_analysis(workspace)
    codex = fake_codex(emits(CODEX_STREAM_OK))
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex)
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    u = CODEX_USAGE
    total = u["input_tokens"] + u["output_tokens"] + u["reasoning_output_tokens"] + u["cached_input_tokens"]
    assert bullet(text, "Tokens") == str(total)
    assert bullet(text, "Cost") is None

def test_a_run_with_no_usage_block_writes_no_tokens_line(runner, workspace, fake_codex):
    """AC4: a CLI that reported no usage block at all (a failed turn,
    here) leaves no `Tokens:` line — absence, not a `0`, mirroring how
    `Cost:` already behaves for an unmeasured figure."""
    with_status(workspace)
    with_analysis(workspace)
    codex = fake_codex(emits(CODEX_STREAM_FAILED))
    run(runner, workspace, tool="codex", codex=codex)
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert bullet(text, "Tokens") is None, text

def test_a_re_run_of_the_same_step_replaces_the_tokens_line_too(runner, workspace, fake_claude):
    """AC5: the same replace-not-duplicate guarantee AC6 above already
    gives Model/Result/Time spent/Cost extends to Tokens — the awk
    allowlist has to name it too, or a re-run would leave the first
    run's stale Tokens line in place alongside nothing new (`.match()`
    on the dashboard's read side returns the FIRST match, so a stale
    line would win over the fresh figure silently)."""
    with_status(workspace)
    result = {**RESULT_OK, "usage": FLAT_USAGE}
    folder = workspace["folder"]
    claude1 = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "%s\\n" "# Queue - Analysis" "" "## Tracking info" "" '
        + f'"- **Task:** \\`{folder}/\\`" "- **Last analyzed:** \\`2026-08-01\\`" '
        + f'> "$specs/{folder}/2-analysis.md"\n'
        + f"echo '{json.dumps(result)}'"
    )
    rc, out, _ = run(runner, workspace, claude1, model="claude-haiku-4-5")
    assert rc == 0, out
    claude2 = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(result)}'")
    rc, out, _ = run(runner, workspace, claude2, model="claude-opus-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{folder}/2-analysis.md")
    assert text.count("- **Tokens:**") == 1, text
    total = (
        FLAT_USAGE["input_tokens"] + FLAT_USAGE["output_tokens"]
        + FLAT_USAGE["cache_read_input_tokens"] + FLAT_USAGE["cache_creation_input_tokens"]
    )
    assert bullet(text, "Tokens") == str(total)

def test_a_fresh_phase_stamps_its_first_attempt(runner, workspace, fake_claude):
    """REQ-1: a phase with no prior `Attempts:` bullet at all gets `1` on
    its first run."""
    with_status(workspace)
    claude = analyzing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude, model="claude-sonnet-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert bullet(text, "Attempts") == "1"

def test_a_re_run_increments_the_stamped_attempts_count(runner, workspace, fake_claude):
    """REQ-1, and the same replace-not-duplicate guarantee AC6 already
    gives Model/Result/Time spent: running the same step twice takes the
    bullet from 1 to 2, never duplicating the line."""
    with_status(workspace)
    claude1 = analyzing_claude(fake_claude, workspace)
    rc, out, _ = run(runner, workspace, claude1, model="claude-haiku-4-5")
    assert rc == 0, out
    claude2 = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude2, model="claude-opus-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert text.count("- **Attempts:**") == 1, text
    assert bullet(text, "Attempts") == "2"

def test_an_archive_the_gates_refused_is_not_counted_as_an_attempt(runner, workspace, fake_claude):
    """A run the archive gates turned away before anything was tried is a
    guard, not an attempt (2026-09-11): `Attempts:` is not written for a
    refusal with no prior count, and stays what it was otherwise."""
    with_status(workspace, done=True)
    status_path = workspace["specs"] / workspace["folder"] / "4-status.md"
    status_path.write_text(
        status_path.read_text()
        + "\n## Acceptance criteria\n\n"
        + "| Task | Status | Notes |\n|------|--------|-------|\n"
        + "| REQ-1: does the thing | ⬜ | |\n"
    )
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "add acceptance criteria")
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert out["terminalReason"] == "acceptance-criteria-unticked", out
    text = phase_file_text(workspace, f"{workspace['folder']}/4-status.md")
    assert "- **Attempts:**" not in text, text

def test_a_run_continues_from_a_pre_existing_attempts_value(runner, workspace, fake_claude):
    """REQ-1: the write reads the file's CURRENT value rather than
    assuming the writer's own internal counter starts at 0 — a phase
    file seeded with `Attempts: 5` (e.g. from before this feature
    shipped) becomes `6` after one more run."""
    with_status(workspace)
    with_analysis_attempts(workspace, 5)
    claude = fake_claude("cat > /dev/null\n" + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, model="claude-sonnet-5")
    assert rc == 0, out
    text = phase_file_text(workspace, f"{workspace['folder']}/2-analysis.md")
    assert bullet(text, "Attempts") == "6"


def test_the_stamped_time_covers_the_step_not_the_ai_session_alone(
    runner, workspace, fake_claude
):
    """The `Time spent:` bullet is the STEP's own span (2026-09-08).

    It used to start beside the AI session, so the checkout, the
    worktree, the branch, the archive pre-check and the reading of what
    came back all fell outside the figure the phase file stamped — a
    part of the step presented as the whole. The invariant that holds in
    every run, fast or slow: the stamp is never SHORTER than the
    session's own `durationSec`, which the run reports in its JSON.
    """
    made = "98-a-timed-spec"
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + "sleep 1\n"
        + f'mkdir -p "$specs/{made}"\n'
        + f'printf "%s\\n" "# Timed - Description" "" "## Tracking info" "" '
        + f'"- **Task:** \\`{made}/\\`" "- **Created:** \\`2026-08-01\\`" '
        + f'> "$specs/{made}/1-description.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="create", spec="81",
                     model="claude-sonnet-5")
    assert rc == 0, out
    session_secs = out["durationSec"]
    stamped = bullet(phase_file_text(workspace, f"{made}/1-description.md"), "Time spent")
    minutes, seconds = re.match(r"(\d+)m(\d\d)s", stamped).groups()
    step_secs = int(minutes) * 60 + int(seconds)
    assert step_secs >= session_secs, (stamped, session_secs)
    assert session_secs >= 1, session_secs


def test_the_step_clock_starts_before_the_run_does_anything():
    """And where the two clocks live, since a run's own seconds cannot
    be asserted deterministically.

    `step_started_at` is set before the first library is sourced — ahead
    of the checkout, the worktree and the branch — and the outcome writer
    computes `Time spent:` from it. `started_at`, beside the AI session,
    stays what the TIMEOUT is measured from: a deadline is about the
    session, not about the step around it.
    """
    scripts = pathlib.Path(__file__).resolve().parents[6] / "core" / "scripts"
    runner_text = (scripts / "aide-run-spec").read_text()
    # Before the first library that does any WORK: the checkout, the
    # worktree and the branch all come after it, and the step's own time
    # includes them.
    clock_at = runner_text.index('step_started_at="$(date +%s)"')
    for first_work in ("run-spec-checkouts.sh", "run-spec-worktree.sh", "run-spec-spec-paths.sh"):
        assert clock_at < runner_text.index(f'source "$SCRIPT_DIR/lib/{first_work}"'), first_work

    outcome = (scripts / "lib" / "run-spec-outcome.sh").read_text()
    assert "step_started_at" in outcome
    assert "time_spent_display" in outcome
    session = (scripts / "lib" / "run-spec-spec-paths.sh").read_text()
    assert 'deadline=$(( started_at +' in session
