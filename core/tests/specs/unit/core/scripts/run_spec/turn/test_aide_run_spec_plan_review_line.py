"""After an `analyze` whose turn ends `completed`, the runner writes one
line of its own into the step's log: the plan review's counts, read from
the `**Findings:**` line the analyze skill opens its Plan review section
with, and where to read the findings — or that the plan has no Plan
review section, or that the section gives no counts. With a Review
under Analyze chosen, the review itself runs in a session of its own on that
AI and model, between the analyze session's two turns.
"""

import json
import re
from pathlib import Path

import pytest

from ...conftest import READ_SPECS, run
from ..run_spec_results import emits
from ..run_spec_status_files import status_with_phase, with_status

PLAN_REVIEW_REFERENCE = (
    Path(__file__).resolve().parents[8] / "core" / "scripts" / "lib" / "steps" / "aide-analyze" / "references" / "plan-review.md"
)

COUNTS_TAIL = " — the findings are under Plan review in the plan (3-solution.md)"
NO_SECTION = "plan review: the plan (3-solution.md) has no Plan review section"
NO_COUNTS = "plan review: the Plan review section in the plan (3-solution.md) gives no counts — the findings are there"
PARTS_OPENED = "--- Step Aide: commit spec files — started"

RESULT_OK = {
    "type": "result", "subtype": "success", "is_error": False,
    "session_id": "ee80227f-510c-45e9-bfbf-c5124f7761c0", "total_cost_usd": 0.1, "num_turns": 1,
    "terminal_reason": "completed", "result": "done",
}


def _stamped(err):
    return [m.group(1) for m in re.finditer(r"^aide-run-spec \d\d:\d\d:\d\d \+\d+s (.+)$", err, re.M)]


def _plan_review_lines(stages):
    return [s for s in stages if s.startswith("plan review:")]


def _analyze(runner, workspace, fake_claude, solution=None):
    """An analyze whose session writes 2-analysis.md and, when given,
    `solution` as 3-solution.md, then reports success. Returns its
    stamped lines and its whole stderr."""
    with_status(workspace, ["create"])
    folder = workspace["folder"]
    body = "cat > /dev/null\n" + READ_SPECS + f'echo "analysis" > "$specs/{folder}/2-analysis.md"\n'
    if solution is not None:
        body += f'cat > "$specs/{folder}/3-solution.md" <<\'SOLUTIONEOF\'\n' + solution + "SOLUTIONEOF\n"
    body += f"echo '{json.dumps(RESULT_OK)}'\n"
    rc, out, _, err = run(runner, workspace, fake_claude(body), command="analyze", return_stderr=True)
    assert out["terminalReason"] == "completed", out
    return _stamped(err), err


def _solution(plan_review):
    return (
        "# Queue - Solution\n\n## Acceptance criteria\n\n1. **AC-1** — the thing\n\n"
        + plan_review
        + "\n## Risk analysis\n\nNone.\n"
    )


def test_the_counts_line_is_logged_with_a_pointer_to_the_section(runner, workspace, fake_claude):
    stages, _ = _analyze(runner, workspace, fake_claude, _solution(
        "## Plan review\n\n**Findings:** 2 must-fix, 3 should-fix, 4 acted on\n\n**Must-fix (2):**\n\n1. a\n2. b\n"
    ))
    line = "plan review: 2 must-fix, 3 should-fix, 4 acted on" + COUNTS_TAIL
    assert _plan_review_lines(stages) == [line], stages
    assert stages.index(line) > stages.index(PARTS_OPENED), stages


def test_the_findings_line_as_the_skill_shows_it_reads(runner, workspace, fake_claude):
    examples = [
        line.strip() for line in PLAN_REVIEW_REFERENCE.read_text().splitlines()
        if line.strip().startswith("**Findings:**")
    ]
    assert examples, "plan-review.md shows no **Findings:** line"
    example = examples[0]
    numbers = re.findall(r"\d+", example)
    assert len(numbers) == 3, example
    stages, _ = _analyze(runner, workspace, fake_claude, _solution(f"## Plan review\n\n{example}\n"))
    lines = _plan_review_lines(stages)
    assert len(lines) == 1, stages
    assert re.findall(r"\d+", lines[0].split(" — ")[0]) == numbers, lines


def test_a_held_back_rounds_own_review_is_the_one_logged(runner, workspace, fake_claude):
    stages, _ = _analyze(runner, workspace, fake_claude, _solution(
        "## Plan review\n\n**Findings:** 1 must-fix, 1 should-fix, 1 acted on\n\n"
        "## Round 2\n\n"
        "### Round 2: acceptance criteria\n\n1. **AC-1** — again\n\n"
        "### Round 2: plan review\n\n**Findings:** 0 must-fix, 2 should-fix, 2 acted on\n\n"
        "### Round 2: risk analysis\n\nNone.\n\n"
        "#### Round 2: Phase 1\n\n**Findings:** 9 must-fix, 9 should-fix, 9 acted on\n"
    ))
    assert _plan_review_lines(stages) == ["plan review: 0 must-fix, 2 should-fix, 2 acted on" + COUNTS_TAIL], stages


def test_a_section_without_a_findings_line_gives_no_counts(runner, workspace, fake_claude):
    stages, _ = _analyze(runner, workspace, fake_claude, _solution(
        "## Plan review\n\n**Must-fix (1):**\n\n1. The thing — *Revised.*\n"
    ))
    assert _plan_review_lines(stages) == [NO_COUNTS], stages


def test_an_analyze_that_does_not_complete_or_an_implement_logs_no_plan_review_line(
    runner, workspace, fake_claude
):
    with_status(workspace, ["create"])
    rc, out, _, err = run(runner, workspace, fake_claude("cat > /dev/null\nexit 1\n"), command="analyze", return_stderr=True)
    assert out["terminalReason"] != "completed", out
    assert _plan_review_lines(_stamped(err)) == [], err

    with_status(workspace, ["create", "analyze"])
    claude = fake_claude(
        "prompt=\"$(cat)\"\n"
        "if printf '%s' \"$prompt\" | grep -q \"Read this spec's own description\"; then\n"
        f"  echo '{json.dumps({**RESULT_OK, 'result': 'review: no defects found'})}'\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        f"  echo '{json.dumps(RESULT_OK)}'\n"
        "fi\n"
    )
    rc, out, _, err = run(runner, workspace, claude, command="implement", return_stderr=True)
    assert out["terminalReason"] == "completed", out
    assert _plan_review_lines(_stamped(err)) == [], err


def test_a_plan_review_quoted_in_a_fence_is_no_section(runner, workspace, fake_claude):
    stages, _ = _analyze(runner, workspace, fake_claude, _solution(
        "## Recommended solution\n\n```markdown\n## Plan review\n\n"
        "**Findings:** 2 must-fix, 3 should-fix, 4 acted on\n```\n"
    ))
    assert _plan_review_lines(stages) == [NO_SECTION], stages


def test_an_analyze_with_no_plan_file_says_it_has_no_plan_review(runner, workspace, fake_claude):
    stages, err = _analyze(runner, workspace, fake_claude)
    assert _plan_review_lines(stages) == [NO_SECTION], stages
    assert "can't open" not in err, err


# --- Review under Analyze on a chosen AI and model ---------------------------
#
# With --plan-review-model or --plan-review-tool, the analyze session hands its
# Step 8 over with a reply line, the runner runs the three reviewers in a fresh
# read-only session on that AI and model, and gives their findings back to the
# analyze session in one more turn.

HANDED_OVER = "plan review: handed over"
REVIEW_MARKER = "Run the three reviewers of"
FINDINGS_MARKER = "The plan review's three reviewers reported"
PROMPT_LINE = "The plan review runs in a session of its own on"
ANALYZE_SESSION = RESULT_OK["session_id"]
FINDINGS = "### Feasibility\n1. The order is wrong\nplan review: done"


def _reply(session, text, cost=0.1):
    return f"echo '{json.dumps({**RESULT_OK, 'session_id': session, 'total_cost_usd': cost, 'result': text})}'"


def _handing_over_claude(fake_claude, keep_in, *, hand_over=True, review_body=None, findings_body=""):
    """A claude that analyzes (writing a plan, and handing Step 8 over when
    `hand_over`), reviews as `review_body` says, and finishes from the findings
    after running `findings_body`. Every prompt it is given is kept in `keep_in`."""
    reply = "the plan is written\n" + HANDED_OVER if hand_over else "done"
    review = review_body or _reply("review-session", FINDINGS, cost=0.5)
    return fake_claude(
        "prompt=\"$(cat)\"\n" + READ_SPECS
        + f"if printf '%s' \"$prompt\" | grep -q \"{REVIEW_MARKER}\"; then\n"
        f"  printf '%s' \"$prompt\" > '{keep_in}/review-prompt.txt'\n  {review}\n"
        f"elif printf '%s' \"$prompt\" | grep -q \"{FINDINGS_MARKER}\"; then\n"
        # A resumed session reports its cost so far, the first turn's included.
        f"  printf '%s' \"$prompt\" > '{keep_in}/findings-prompt.txt'\n{findings_body}\n  {_reply(ANALYZE_SESSION, 'done', cost=0.2)}\n"
        "else\n"
        f"  printf '%s' \"$prompt\" > '{keep_in}/analyze-prompt.txt'\n"
        "  folder=\"$(ls \"$specs\" | head -1)\"\n"
        "  echo analysis > \"$specs/$folder/2-analysis.md\"\n"
        "  printf '# Plan\\n\\n## Plan review\\n\\n**Findings:** 0 must-fix, 0 should-fix, 0 acted on\\n' > \"$specs/$folder/3-solution.md\"\n"
        f"  {_reply(ANALYZE_SESSION, reply)}\n"
        "fi\n"
    )


def test_a_handed_over_review_runs_on_codex_read_only_with_the_spec_named_ac_2(
    runner, workspace, fake_claude, fake_codex, tmp_path
):
    with_status(workspace, ["create"])
    claude = _handing_over_claude(fake_claude, tmp_path)
    codex_says = "\n".join(json.dumps(e) for e in [
        {"type": "thread.started", "thread_id": "codex-plan-review"},
        {"type": "item.completed", "item": {"id": "i0", "type": "agent_message", "text": FINDINGS}},
        {"type": "turn.completed", "usage": {"input_tokens": 1, "cached_input_tokens": 0, "output_tokens": 1}},
    ])
    codex = fake_codex(emits(codex_says).replace("cat > /dev/null", f"cat > '{tmp_path}/codex-prompt.txt'", 1))
    rc, out, _, err = run(runner, workspace, claude, codex=codex, command="analyze",
                          plan_review_tool="codex", plan_review_model="m", return_stderr=True)
    assert out["terminalReason"] == "completed", out
    (review,) = fake_codex.calls.read_text().splitlines()
    assert review.startswith("exec --json --sandbox read-only --model m"), review
    prompt = (tmp_path / "codex-prompt.txt").read_text() + review
    assert "aide-analyze/references/plan-review.md" in prompt, prompt
    assert workspace["folder"] in prompt, prompt
    assert "criteriaChecks: off" in prompt, prompt
    assert "Let me choose the approach is off" in prompt, prompt
    assert PROMPT_LINE in (tmp_path / "analyze-prompt.txt").read_text()


def test_the_findings_go_back_to_the_analyze_session_and_its_cost_counts_the_review_ac_3(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create"])
    claude = _handing_over_claude(fake_claude, tmp_path)
    rc, out, _, err = run(runner, workspace, claude, command="analyze",
                          plan_review_model="claude-sonnet-4", return_stderr=True)
    assert out["terminalReason"] == "completed", out
    calls = fake_claude.calls.read_text().splitlines()
    assert len(calls) == 3, calls
    assert "--model claude-sonnet-4" in calls[1] and "--resume" not in calls[1], calls[1]
    assert f"--resume {ANALYZE_SESSION}" in calls[2], calls[2]
    findings = (tmp_path / "findings-prompt.txt").read_text()
    assert "1. The order is wrong" in findings, findings
    assert "Consolidate" in findings and "Step 9" in findings and "Step 10" in findings, findings
    assert out["sessionId"] == ANALYZE_SESSION, out
    assert abs(out["costUsd"] - 0.7) < 1e-6, out


def test_a_follow_up_turn_that_ticks_a_phase_row_is_refused_ac_3(runner, workspace, fake_claude, tmp_path):
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    tick = '  sed -i.bak "s/| a | ⬜ |/| a | ✅ |/" "$specs/$(ls "$specs" | head -1)/4-status.md"; rm -f "$specs"/*/4-status.md.bak'
    claude = _handing_over_claude(fake_claude, tmp_path, findings_body=tick)
    rc, out, _ = run(runner, workspace, claude, command="analyze", plan_review_model="claude-sonnet-4")
    assert len(fake_claude.calls.read_text().splitlines()) == 3
    assert out["terminalReason"] == "scope-violation", out
    assert out["scopeAnalyze"]["phaseRows"] is True, out


@pytest.mark.parametrize(
    "review_body",
    ["exit 3", _reply("review-session", "I looked at it"), _reply("review-session", "plan review: done")],
    ids=["fails", "no-done-line", "no-findings"],
)
def test_a_review_that_does_not_complete_or_gives_no_done_line_stops_the_step_ac_2(
    runner, workspace, fake_claude, tmp_path, review_body
):
    with_status(workspace, ["create"])
    claude = _handing_over_claude(fake_claude, tmp_path, review_body=review_body)
    rc, out, _ = run(runner, workspace, claude, command="analyze", plan_review_model="claude-sonnet-4")
    assert out["terminalReason"] != "completed", out
    said = f"{out.get('error') or ''} {out.get('errorLog') or ''}"
    assert "Review on claude-sonnet-4 could not run" in said, out
    assert len(fake_claude.calls.read_text().splitlines()) == 2, out


def test_a_session_that_reviewed_itself_runs_no_review_and_says_so_ac_2_ac_4(runner, workspace, fake_claude, tmp_path):
    with_status(workspace, ["create"])
    claude = _handing_over_claude(fake_claude, tmp_path, hand_over=False)
    rc, out, _, err = run(runner, workspace, claude, command="analyze",
                          plan_review_model="claude-sonnet-4", return_stderr=True)
    assert out["terminalReason"] == "completed", out
    assert len(fake_claude.calls.read_text().splitlines()) == 1
    assert "error: the analyze session reviewed its plan itself; Review on claude-sonnet-4 did not run" in _stamped(err), err


def test_a_skipped_review_or_an_analyze_that_does_not_complete_runs_no_review_ac_4(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create"])
    body = "cat > /dev/null\n" + READ_SPECS + 'echo short > "$specs/$(ls "$specs" | head -1)/2-analysis.md"\n' + _reply(ANALYZE_SESSION, "done")
    rc, out, _, err = run(runner, workspace, fake_claude(body), command="analyze",
                          plan_review_model="claude-sonnet-4", return_stderr=True)
    assert out["terminalReason"] == "completed", out
    assert len(fake_claude.calls.read_text().splitlines()) == 1
    assert not [s for s in _stamped(err) if "did not run" in s], err

    fake_claude.calls.unlink()
    rc, out, _ = run(runner, workspace, fake_claude("cat > /dev/null\nexit 1\n"), command="analyze",
                     plan_review_model="claude-sonnet-4")
    assert out["terminalReason"] != "completed", out
    assert len(fake_claude.calls.read_text().splitlines()) == 1


def test_bad_plan_review_flags_are_refused_before_any_turn_ac_2(runner, workspace, fake_claude, tmp_path):
    with_status(workspace, ["create"])
    claude = _handing_over_claude(fake_claude, tmp_path)
    rc, out, _ = run(runner, workspace, claude, command="analyze", plan_review_tool="gemini")
    assert rc == 2 and out["terminalReason"] == "refused", out
    assert "gemini" in out["error"], out
    rc, out, _ = run(runner, workspace, claude, command="analyze",
                     plan_review_claude_config_dir=str(tmp_path / "no-such-account"))
    assert rc == 2 and out["terminalReason"] == "refused", out
    assert not fake_claude.calls.exists()


def test_without_a_plan_review_choice_the_prompt_has_no_line_and_one_turn_runs_ac_6(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create"])
    claude = _handing_over_claude(fake_claude, tmp_path)
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert out["terminalReason"] == "completed", out
    assert len(fake_claude.calls.read_text().splitlines()) == 1
    assert PROMPT_LINE not in (tmp_path / "analyze-prompt.txt").read_text()
