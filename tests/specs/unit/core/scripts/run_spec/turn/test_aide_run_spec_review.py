"""An `implement` step whose own turn ends `completed` is followed by
ONE review turn — a fresh session, same model/effort/tool — that reads
the spec's description and everything the branch changed, and looks for
defects against the description (never style, naming or structure).
Defects found go back to the ORIGINAL implement session as one
follow-up (fix) turn; the runner's own test run (run-spec/turn/step-tests.sh)
always runs after that, never a second review (spec 551).
"""

import json
import re

from ...conftest import git, run
from ..run_spec_results import CODEX_STREAM_OK, CODEX_THREAD_ID, CODEX_USAGE, emits
from ..run_spec_status_files import with_status

REVIEW_MARKER = "Read this spec's own description"
FIX_MARKER = "A review of what you changed found"
OUT_OF_SCOPE_MARKER = "The description has an ## Out of scope section"
WENT_BACK = "the defect(s) went back to the implement session to be fixed"

IMPLEMENT_SESSION = "ee80227f-510c-45e9-bfbf-c5124f7761c0"
REVIEW_SESSION = "review-throwaway-session-id"
REVIEW_THREAD_ID = "0199f4c2-6d1a-7c31-9f0e-2b7a5c8d9999"


def _stamped(err):
    return [m.group(1) for m in re.finditer(r"^aide-run-spec \d\d:\d\d:\d\d \+\d+s (.+)$", err, re.M)]


def _result(session_id, text, cost=0.5357):
    return {
        "type": "result", "subtype": "success", "is_error": False,
        "session_id": session_id, "total_cost_usd": cost, "num_turns": 1,
        "terminal_reason": "completed", "result": text,
    }


def _reviewing_claude(fake_claude, review_reply, implement_cost=0.10, review_cost=0.05):
    """First call: implements, leaves the project changed, reports done
    under a known session id. Second call, matched by the review
    prompt's own marker text: answers with `review_reply` under a
    DIFFERENT, throwaway session id — the one every case here must
    discard rather than report as the step's own."""
    return fake_claude(
        "prompt=\"$(cat)\"\n"
        f"if printf '%s' \"$prompt\" | grep -q \"{REVIEW_MARKER}\"; then\n"
        f"  echo '{json.dumps(_result(REVIEW_SESSION, review_reply, review_cost))}'\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        f"  echo '{json.dumps(_result(IMPLEMENT_SESSION, 'done', implement_cost))}'\n"
        "fi\n"
    )


def test_a_review_with_no_defects_costs_two_calls_and_the_runners_test_run_still_happens_AC_5(
    runner, workspace, fake_claude
):
    """No defects: exactly one extra, fresh (no --resume/--session-id
    reused) turn, same model/effort as the step's own; the step still
    ends completed, names the implement session (never the review's own
    throwaway one), and the runner's own test run still ran."""
    with_status(workspace, ["create", "analyze"])
    claude = _reviewing_claude(fake_claude, "review: no defects found")
    rc, out, _, err = run(
        runner, workspace, claude, command="implement",
        model="claude-sonnet-4", effort="high", return_stderr=True,
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert out["sessionId"] == IMPLEMENT_SESSION, out
    calls = fake_claude.calls.read_text().splitlines()
    assert len(calls) == 2, calls
    assert "--resume" not in calls[1] and "--session-id" not in calls[1], calls[1]
    assert "--model claude-sonnet-4" in calls[1] and "--effort high" in calls[1], calls[1]
    assert "testedGreen" in out, out
    stages = _stamped(err)
    assert "the review found no defects" in stages, stages
    assert not any(s.startswith("review:") for s in stages), stages
    assert WENT_BACK not in stages, stages


def test_defects_found_are_listed_then_handed_to_a_third_turn_the_fix_never_a_second_review_AC_4(
    runner, workspace, fake_claude
):
    """Two defects: a third turn, resumed on the ORIGINAL implement
    session (never the review's own), fixes them; the runner's test run
    follows, and there is no fourth (second review) call. The reported
    cost is the sum of all three turns."""
    with_status(workspace, ["create", "analyze"])
    claude = fake_claude(
        "prompt=\"$(cat)\"\n"
        f"if printf '%s' \"$prompt\" | grep -q \"{REVIEW_MARKER}\"; then\n"
        f"  echo '{json.dumps(_result(REVIEW_SESSION, 'review: 2 defect(s) found' + chr(10) + '1. First defect' + chr(10) + '2. Second defect', 0.05))}'\n"
        f"elif printf '%s' \"$prompt\" | grep -q \"{FIX_MARKER}\"; then\n"
        "  printf 'fixed\\n' > fixed.txt && git add -A && git commit -q -m 'the fix'\n"
        f"  echo '{json.dumps(_result(IMPLEMENT_SESSION, 'done', 0.20))}'\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        f"  echo '{json.dumps(_result(IMPLEMENT_SESSION, 'done', 0.10))}'\n"
        "fi\n"
    )
    rc, out, _, err = run(runner, workspace, claude, command="implement", return_stderr=True)
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert out["sessionId"] == IMPLEMENT_SESSION, out
    calls = fake_claude.calls.read_text().splitlines()
    assert len(calls) == 3, calls
    assert "--resume" in calls[2] and IMPLEMENT_SESSION in calls[2], calls[2]
    assert REVIEW_SESSION not in calls[2], calls[2]
    assert abs(out["costUsd"] - 0.35) < 1e-6, out
    stages = _stamped(err)
    count = stages.index("error: the review found 2 defect(s) — handing them to the session")
    assert stages[count + 1:count + 4] == [
        "review: 1. First defect", "review: 2. Second defect", WENT_BACK,
    ], stages
    assert any(s.startswith("model turn started") for s in stages[count + 4:]), stages


def test_a_verdict_with_no_review_line_counts_as_no_defects_AC_4(runner, workspace, fake_claude):
    """The model answered in free prose, with no `review:` marker line
    at all — treated as no defects, never as an unspecified fix turn, but
    said in the log as an error, never as the review having found nothing."""
    with_status(workspace, ["create", "analyze"])
    claude = _reviewing_claude(fake_claude, "I looked closely and everything matches the description.")
    rc, out, _, err = run(runner, workspace, claude, command="implement", return_stderr=True)
    assert out["terminalReason"] == "completed", out
    assert len(fake_claude.calls.read_text().splitlines()) == 2
    stages = _stamped(err)
    assert "the review found no defects" not in stages, stages
    assert any(s.startswith("error: the review's reply has no review: line") for s in stages), stages


def test_the_reviews_own_turn_failing_falls_back_to_found_nothing_AC_4(runner, workspace, fake_claude):
    """The review's OWN turn — never the fix turn — is best-effort: a
    step whose real work is already done and committed must not be
    reported failed because the added safety net had a hiccup."""
    with_status(workspace, ["create", "analyze"])
    claude = fake_claude(
        "prompt=\"$(cat)\"\n"
        f"if printf '%s' \"$prompt\" | grep -q \"{REVIEW_MARKER}\"; then\n"
        "  exit 1\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        f"  echo '{json.dumps(_result(IMPLEMENT_SESSION, 'done'))}'\n"
        "fi\n"
    )
    rc, out, _, err = run(runner, workspace, claude, command="implement", return_stderr=True)
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert out["sessionId"] == IMPLEMENT_SESSION, out
    assert len(fake_claude.calls.read_text().splitlines()) == 2
    stages = _stamped(err)
    assert any("did not complete" in s and "proceeding without it" in s for s in stages), stages


def test_a_non_implement_command_never_gets_a_review_call(runner, workspace, fake_claude):
    with_status(workspace, ["create"])
    claude = fake_claude(
        "cat > /dev/null\n"
        'specs="$(sed -n "s|^AIDE_SPECS_PATH=||p" "$PWD/.aide/config" | head -1)"\n'
        'echo "analysis" > "$specs/81-queue-and-runner/2-analysis.md"\n'
        f"echo '{json.dumps(_result(IMPLEMENT_SESSION, 'done'))}'\n"
    )
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert out["terminalReason"] == "completed", out
    assert len(fake_claude.calls.read_text().splitlines()) == 1


def _codex_review_stream(text, thread=REVIEW_THREAD_ID):
    return "\n".join(
        json.dumps(e)
        for e in [
            {"type": "thread.started", "thread_id": thread},
            {"type": "turn.started"},
            {"type": "item.completed", "item": {"id": "item_0", "item_type": "agent_message", "text": text}},
            {"type": "turn.completed", "usage": CODEX_USAGE},
        ]
    )


def test_a_review_with_no_defects_in_codex_gets_a_fresh_thread_never_resumed(runner, workspace, fake_codex):
    """Codex's own twin: the review runs as `codex exec --json` (fresh),
    never `exec resume`, and the step's own sessionId still names the
    implement thread, not the review's own."""
    with_status(workspace, ["create", "analyze"])
    codex = fake_codex(
        "prompt=\"$(cat)\"\n"
        f"if printf '%s' \"$prompt\" | grep -q \"{REVIEW_MARKER}\"; then\n"
        "  " + emits(_codex_review_stream("review: no defects found")).replace("cat > /dev/null; ", "") + "\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        "  " + emits(CODEX_STREAM_OK).replace("cat > /dev/null; ", "") + "\n"
        "fi\n"
    )
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, command="implement")
    assert out["terminalReason"] == "completed", out
    assert out["sessionId"] == CODEX_THREAD_ID, out
    calls = fake_codex.calls.read_text().splitlines()
    assert len(calls) == 2, calls
    assert "resume" not in calls[1], calls[1]


def test_defects_found_in_codex_resumes_the_implement_thread_never_the_reviews_own(runner, workspace, fake_codex):
    with_status(workspace, ["create", "analyze"])
    codex = fake_codex(
        "prompt=\"$(cat)\"\n"
        f"if printf '%s' \"$prompt\" | grep -q \"{REVIEW_MARKER}\"; then\n"
        "  " + emits(_codex_review_stream("review: 1 defect(s) found" + chr(10) + "1. Something is off")).replace(
            "cat > /dev/null; ", ""
        ) + "\n"
        f"elif printf '%s' \"$prompt\" | grep -q \"{FIX_MARKER}\"; then\n"
        "  printf 'fixed\\n' > fixed.txt && git add -A && git commit -q -m 'the fix'\n"
        "  " + emits(CODEX_STREAM_OK).replace("cat > /dev/null; ", "") + "\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        "  " + emits(CODEX_STREAM_OK).replace("cat > /dev/null; ", "") + "\n"
        "fi\n"
    )
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, command="implement")
    assert out["terminalReason"] == "completed", out
    calls = fake_codex.calls.read_text().splitlines()
    assert len(calls) == 3, calls
    assert calls[2].startswith("exec resume ") and calls[2].endswith(f" {CODEX_THREAD_ID} -"), calls[2]
    assert REVIEW_THREAD_ID not in calls[2], calls[2]


def _with_out_of_scope_section(workspace):
    """The spec's description gains an `## Out of scope` section, committed
    in the specs repo where the review reads it."""
    specs = workspace["specs"]
    path = specs / workspace["folder"] / "1-description.md"
    path.write_text(path.read_text() + "\n## Out of scope\n\n- Do not touch the queue.\n")
    git(specs, "add", "-A")
    git(specs, "commit", "-q", "-m", "out of scope")


def _out_of_scope_reviewer(fake_claude, tmp_path):
    """The review reports a defect only when its prompt carries the
    out-of-scope instruction, and the prompt it read is kept in a file."""
    defect = "review: 1 defect(s) found" + chr(10) + "1. A change under an out-of-scope item"
    return fake_claude(
        "prompt=\"$(cat)\"\n"
        f"if printf '%s' \"$prompt\" | grep -q \"{REVIEW_MARKER}\"; then\n"
        f"  printf '%s' \"$prompt\" > {tmp_path / 'review-prompt.txt'}\n"
        f"  if printf '%s' \"$prompt\" | grep -q \"{OUT_OF_SCOPE_MARKER}\"; then\n"
        f"    echo '{json.dumps(_result(REVIEW_SESSION, defect, 0.05))}'\n"
        "  else\n"
        f"    echo '{json.dumps(_result(REVIEW_SESSION, 'review: no defects found', 0.05))}'\n"
        "  fi\n"
        f"elif printf '%s' \"$prompt\" | grep -q \"{FIX_MARKER}\"; then\n"
        "  printf 'fixed\\n' > fixed.txt && git add -A && git commit -q -m 'the fix'\n"
        f"  echo '{json.dumps(_result(IMPLEMENT_SESSION, 'done', 0.20))}'\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        f"  echo '{json.dumps(_result(IMPLEMENT_SESSION, 'done', 0.10))}'\n"
        "fi\n"
    )


def test_a_description_with_an_out_of_scope_section_tells_the_review_so_at_level_off_AC_4(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    _with_out_of_scope_section(workspace)
    claude = _out_of_scope_reviewer(fake_claude, tmp_path)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert OUT_OF_SCOPE_MARKER in (tmp_path / "review-prompt.txt").read_text()


def test_an_out_of_scope_defect_goes_back_in_the_one_fix_turn_and_is_not_reviewed_again_AC_4_AC_5(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    _with_out_of_scope_section(workspace)
    claude = _out_of_scope_reviewer(fake_claude, tmp_path)
    rc, out, _, err = run(runner, workspace, claude, command="implement", return_stderr=True)
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    stages = _stamped(err)
    assert "review: 1. A change under an out-of-scope item" in stages, stages
    assert WENT_BACK in stages, stages
    calls = fake_claude.calls.read_text().splitlines()
    assert len(calls) == 3, calls
    assert "--resume" in calls[2] and IMPLEMENT_SESSION in calls[2], calls[2]
    assert "testedGreen" in out, out


def test_a_description_without_the_section_gets_the_review_as_before_AC_6(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    claude = _out_of_scope_reviewer(fake_claude, tmp_path)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    assert OUT_OF_SCOPE_MARKER not in (tmp_path / "review-prompt.txt").read_text()
    assert len(fake_claude.calls.read_text().splitlines()) == 2


def test_the_review_is_told_where_the_branch_left_main_and_finds_the_changes_itself(
    runner, workspace, fake_claude, tmp_path
):
    """The review compares the whole branch with where it left the default
    branch — an earlier attempt's commits included — by running `git diff`
    itself, so nothing is pasted into the prompt and nothing is cut off.
    The implement turn here commits its own work, which `git diff HEAD`
    would not have shown at all."""
    with_status(workspace, ["create", "analyze"])
    fork = git(workspace["project"], "rev-parse", "HEAD").strip()
    claude = _out_of_scope_reviewer(fake_claude, tmp_path)
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    prompt = (tmp_path / "review-prompt.txt").read_text()
    assert f"git diff {fork}" in prompt, prompt
    assert "real work" not in prompt, prompt
    assert str(workspace["folder"]) + "/1-description.md" in prompt, prompt
