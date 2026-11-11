"""An `implement` step whose own turn ends `completed` is followed by
ONE review turn — a fresh session, same model/effort/tool — that reads
the spec's description and everything the branch changed, and looks for
defects against the description (never style, naming or structure).
Defects found go back to the ORIGINAL implement session as one
follow-up (fix) turn; the runner's own test run (run-spec/turn/step-tests.sh)
always runs after that, never a second review.
"""

import json
import re

from ...conftest import git, run
from ..run_spec_result_fields import assert_written_as_in_fixture
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


def test_a_review_with_no_defects_costs_two_calls_and_the_runners_test_run_still_happens(
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
        model="claude-sonnet-4", effort="high", review_model="claude-sonnet-4", return_stderr=True,
    )
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert out["sessionId"] == IMPLEMENT_SESSION, out
    calls = fake_claude.calls.read_text().splitlines()
    assert len(calls) == 2, calls
    assert "--resume" not in calls[1] and "--session-id" not in calls[1], calls[1]
    assert "--model claude-sonnet-4" in calls[1], calls[1]
    assert "testedGreen" in out, out
    stages = _stamped(err)
    assert "the review found no defects" in stages, stages
    assert not any(s.startswith("review:") for s in stages), stages
    assert WENT_BACK not in stages, stages


def test_defects_found_are_listed_then_handed_to_a_third_turn_the_fix_never_a_second_review(
    runner, workspace, fake_claude
):
    """Two defects: a third turn, resumed on the ORIGINAL implement
    session (never the review's own), fixes them; the runner's test run
    follows, and there is no fourth (second review) call. The reported
    cost is the sum of all three turns: the resumed fix reports the
    session's total, 0.30, of which 0.20 is its own."""
    with_status(workspace, ["create", "analyze"])
    claude = fake_claude(
        "prompt=\"$(cat)\"\n"
        f"if printf '%s' \"$prompt\" | grep -q \"{REVIEW_MARKER}\"; then\n"
        f"  echo '{json.dumps(_result(REVIEW_SESSION, 'review: 2 defect(s) found' + chr(10) + '1. First defect' + chr(10) + '2. Second defect', 0.05))}'\n"
        f"elif printf '%s' \"$prompt\" | grep -q \"{FIX_MARKER}\"; then\n"
        "  printf 'fixed\\n' > fixed.txt && git add -A && git commit -q -m 'the fix'\n"
        f"  echo '{json.dumps(_result(IMPLEMENT_SESSION, 'done', 0.30))}'\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        f"  echo '{json.dumps(_result(IMPLEMENT_SESSION, 'done', 0.10))}'\n"
        "fi\n"
    )
    rc, out, _, err = run(runner, workspace, claude, command="implement", review_model="claude-sonnet-4", return_stderr=True)
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert out["sessionId"] == IMPLEMENT_SESSION, out
    calls = fake_claude.calls.read_text().splitlines()
    assert len(calls) == 3, calls
    assert "--resume" in calls[2] and IMPLEMENT_SESSION in calls[2], calls[2]
    assert "--add-dir" in calls[2] and calls[2].endswith("/specs"), calls[2]
    assert REVIEW_SESSION not in calls[2], calls[2]
    assert abs(out["costUsd"] - 0.35) < 1e-6, out
    stages = _stamped(err)
    count = stages.index("error: the review found 2 defect(s)")
    assert stages[count + 1:count + 4] == [
        "review: 1. First defect", "review: 2. Second defect", WENT_BACK,
    ], stages
    assert any(s.startswith("model turn started") for s in stages[count + 4:]), stages


def test_a_defect_the_session_finds_is_not_one_is_logged_with_its_reason(runner, workspace, fake_claude):
    """The fix turn may turn a reported defect down on a `not a defect:`
    line; each such line is logged, so how often it happens can be seen."""
    with_status(workspace, ["create", "analyze"])
    fix_reply = "Fixed 1." + chr(10) + "not a defect: 2. The guard is already in x.ts:10"
    claude = fake_claude(
        "prompt=\"$(cat)\"\n"
        f"if printf '%s' \"$prompt\" | grep -q \"{REVIEW_MARKER}\"; then\n"
        f"  echo '{json.dumps(_result(REVIEW_SESSION, 'review: 2 defect(s) found' + chr(10) + '1. First defect' + chr(10) + '2. Second defect', 0.05))}'\n"
        f"elif printf '%s' \"$prompt\" | grep -q \"{FIX_MARKER}\"; then\n"
        "  printf 'fixed\\n' > fixed.txt && git add -A && git commit -q -m 'the fix'\n"
        f"  echo '{json.dumps(_result(IMPLEMENT_SESSION, fix_reply, 0.20))}'\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        f"  echo '{json.dumps(_result(IMPLEMENT_SESSION, 'done', 0.10))}'\n"
        "fi\n"
    )
    rc, out, _, err = run(runner, workspace, claude, command="implement", review_model="claude-sonnet-4", return_stderr=True)
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    stages = _stamped(err)
    assert "the implement session found it not a defect: 2. The guard is already in x.ts:10" in stages, stages


def test_the_review_session_is_named_review_not_for_the_implement_it_follows(
    runner, workspace, fake_claude
):
    """The stand-in records each call as its arguments joined by spaces."""
    with_status(workspace, ["create", "analyze"])
    claude = _reviewing_claude(fake_claude, "review: no defects found")
    rc, out, _ = run(
        runner, workspace, claude, command="implement", project_name="proj", review_model="claude-sonnet-4"
    )
    assert rc == 0, out
    calls = fake_claude.calls.read_text().splitlines()
    assert len(calls) == 2, calls
    assert "--name proj 81 review" in calls[1], calls[1]
    assert "--name proj 81 implement" not in calls[1], calls[1]


def test_the_fix_turn_passes_no_name_so_the_session_keeps_its_own(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze"])
    claude = fake_claude(
        "prompt=\"$(cat)\"\n"
        f"if printf '%s' \"$prompt\" | grep -q \"{REVIEW_MARKER}\"; then\n"
        f"  echo '{json.dumps(_result(REVIEW_SESSION, 'review: 1 defect(s) found' + chr(10) + '1. A defect', 0.05))}'\n"
        f"elif printf '%s' \"$prompt\" | grep -q \"{FIX_MARKER}\"; then\n"
        "  printf 'fixed\\n' > fixed.txt && git add -A && git commit -q -m 'the fix'\n"
        f"  echo '{json.dumps(_result(IMPLEMENT_SESSION, 'done', 0.30))}'\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        f"  echo '{json.dumps(_result(IMPLEMENT_SESSION, 'done', 0.10))}'\n"
        "fi\n"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement", review_model="claude-sonnet-4")
    assert rc == 0, out
    calls = fake_claude.calls.read_text().splitlines()
    assert len(calls) == 3, calls
    assert "--resume" in calls[2] and IMPLEMENT_SESSION in calls[2], calls[2]
    assert "--name" not in calls[2], calls[2]


def test_a_verdict_with_no_review_line_counts_as_no_defects(runner, workspace, fake_claude):
    """The model answered in free prose, with no `review:` marker line
    at all — treated as no defects, never as an unspecified fix turn, but
    said in the log as an error, never as the review having found nothing."""
    with_status(workspace, ["create", "analyze"])
    claude = _reviewing_claude(fake_claude, "I looked closely and everything matches the description.")
    rc, out, _, err = run(runner, workspace, claude, command="implement", review_model="claude-sonnet-4", return_stderr=True)
    assert out["terminalReason"] == "completed", out
    assert len(fake_claude.calls.read_text().splitlines()) == 2
    stages = _stamped(err)
    assert "the review found no defects" not in stages, stages
    assert any(s.startswith("error: the review's reply has no review: line") for s in stages), stages


def test_the_reviews_own_turn_failing_stops_implement(runner, workspace, fake_claude):
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
    rc, out, _, err = run(runner, workspace, claude, command="implement", review_model="claude-sonnet-4", return_stderr=True)
    assert out["terminalReason"] == "cli-error", out
    assert out["sessionId"] == IMPLEMENT_SESSION, out
    assert len(fake_claude.calls.read_text().splitlines()) == 2
    stages = _stamped(err)
    assert any("Review on claude-sonnet-4 could not run" in s for s in stages), stages


def test_a_step_stopped_by_its_review_commits_its_work_as_unfinished(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze"])
    claude = fake_claude(
        "prompt=\"$(cat)\"\n"
        f"if printf '%s' \"$prompt\" | grep -q \"{REVIEW_MARKER}\"; then\n"
        "  exit 1\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt\n"
        '  specs="$(sed -n "s|^AIDE_SPECS_PATH=||p" "$PWD/.aide/config" | head -1)"\n'
        f"  printf 'spec work\\n' > \"$specs/{workspace['folder']}/implement-note\"\n"
        f"  echo '{json.dumps(_result(IMPLEMENT_SESSION, 'done'))}'\n"
        "fi\n"
    )
    rc, out, _ = run(runner, workspace, claude, command="implement", review_model="claude-sonnet-4")
    assert out["terminalReason"] == "cli-error", out
    project_message = git(workspace["project"], "log", "-1", "--pretty=%B", "aide/81-queue-and-runner")
    assert project_message.startswith("WIP: "), project_message
    message = git(workspace["specs"], "log", "-1", "--pretty=%B", "aide/81-queue-and-runner")
    assert message.rstrip().endswith(" (stopped: cli-error)"), message


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


def test_a_review_with_no_defects_in_codex_gets_a_fresh_thread_never_resumed_ac_2_ac_5_ac_8(runner, workspace, fake_codex):
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
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, command="implement", review_model="gpt-6.1-sol")
    assert out["terminalReason"] == "completed", out
    assert out["sessionId"] == CODEX_THREAD_ID, out
    calls = fake_codex.calls.read_text().splitlines()
    assert len(calls) == 2, calls
    assert "resume" not in calls[1], calls[1]


def test_defects_found_in_codex_resumes_the_implement_thread_never_the_reviews_own_ac_2_ac_5(runner, workspace, fake_codex):
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
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, command="implement", review_model="gpt-6.1-sol")
    assert out["terminalReason"] == "completed", out
    calls = fake_codex.calls.read_text().splitlines()
    assert len(calls) == 3, calls
    assert calls[2].startswith("exec resume ") and calls[2].endswith(f" {CODEX_THREAD_ID} -"), calls[2]
    assert REVIEW_THREAD_ID not in calls[2], calls[2]


def test_a_red_suite_after_a_codex_review_fix_resumes_the_thread_once_more_with_one_prompt(
    runner, workspace, fake_codex
):
    """The review's defects went back to the implement thread, and the
    suite is red after that fix: the red-suite turn is one more plain
    `exec resume <thread> -`, never a resume of the already-resumed call."""
    with_status(workspace, ["create", "analyze"])
    manifest = workspace["project"] / ".aide" / "project.yaml"
    manifest.write_text(manifest.read_text().replace("AIDE_TEST_CMD: true", "AIDE_TEST_CMD: test -f green.txt"))
    ok = emits(CODEX_STREAM_OK).replace("cat > /dev/null; ", "")
    codex = fake_codex(
        "prompt=\"$(cat)\"\n"
        f"if printf '%s' \"$prompt\" | grep -q \"{REVIEW_MARKER}\"; then\n"
        "  " + emits(_codex_review_stream("review: 1 defect(s) found" + chr(10) + "1. Something is off")).replace(
            "cat > /dev/null; ", ""
        ) + "\n"
        "elif printf '%s' \"$prompt\" | grep -q 'test suite is red'; then\n"
        "  printf 'green\\n' > green.txt && git add -A && git commit -q -m 'the test fix'\n"
        f"  {ok}\n"
        f"elif printf '%s' \"$prompt\" | grep -q \"{FIX_MARKER}\"; then\n"
        "  printf 'fixed\\n' > fixed.txt && git add -A && git commit -q -m 'the fix'\n"
        f"  {ok}\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        f"  {ok}\n"
        "fi\n"
    )
    rc, out, _ = run(runner, workspace, tool="codex", codex=codex, command="implement", review_model="gpt-6.1-sol")
    assert out["terminalReason"] == "completed", out
    calls = fake_codex.calls.read_text().splitlines()
    assert len(calls) == 4, calls
    assert calls[3].startswith("exec resume ") and calls[3].endswith(f" {CODEX_THREAD_ID} -"), calls[3]
    assert calls[3].split().count("resume") == 1 and calls[3].split().count("-") == 1, calls[3]


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
        f"  echo '{json.dumps(_result(IMPLEMENT_SESSION, 'done', 0.30))}'\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        f"  echo '{json.dumps(_result(IMPLEMENT_SESSION, 'done', 0.10))}'\n"
        "fi\n"
    )


def test_a_description_with_an_out_of_scope_section_tells_the_review_so_at_level_off(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    _with_out_of_scope_section(workspace)
    claude = _out_of_scope_reviewer(fake_claude, tmp_path)
    rc, out, _ = run(runner, workspace, claude, command="implement", review_model="claude-sonnet-4")
    assert rc == 0, out
    assert OUT_OF_SCOPE_MARKER in (tmp_path / "review-prompt.txt").read_text()


def test_an_out_of_scope_defect_goes_back_in_the_one_fix_turn_and_is_not_reviewed_again(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    _with_out_of_scope_section(workspace)
    claude = _out_of_scope_reviewer(fake_claude, tmp_path)
    rc, out, _, err = run(runner, workspace, claude, command="implement", review_model="claude-sonnet-4", return_stderr=True)
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    stages = _stamped(err)
    assert "review: 1. A change under an out-of-scope item" in stages, stages
    assert WENT_BACK in stages, stages
    calls = fake_claude.calls.read_text().splitlines()
    assert len(calls) == 3, calls
    assert "--resume" in calls[2] and IMPLEMENT_SESSION in calls[2], calls[2]
    assert "testedGreen" in out, out


def test_a_description_without_the_section_gets_the_review_as_before(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    claude = _out_of_scope_reviewer(fake_claude, tmp_path)
    rc, out, _ = run(runner, workspace, claude, command="implement", review_model="claude-sonnet-4")
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
    rc, out, _ = run(runner, workspace, claude, command="implement", review_model="claude-sonnet-4")
    assert rc == 0, out
    prompt = (tmp_path / "review-prompt.txt").read_text()
    assert f"git diff {fork}" in prompt, prompt
    assert "real work" not in prompt, prompt
    assert str(workspace["folder"]) + "/1-description.md" in prompt, prompt


VERIFY_MARKER = "A review of this spec's branch reported the defects below"
IMPLEMENT_USAGE = (10, 100, 1000, 50)
REVIEW_USAGE = (30, 700, 4000, 200)
VERIFY_USAGE = (12, 400, 2500, 90)
FIX_USAGE = (7, 300, 2000, 100)


def _session_so_far(*usages):
    """A resumed session reports its whole usage so far, not the turn's own."""
    return tuple(map(sum, zip(*usages)))


def _metered(session_id, text, cost, usage):
    """A result that also carries what its turn metered, as `modelUsage`."""
    result = _result(session_id, text, cost)
    result["modelUsage"] = {"claude-sonnet-4": dict(zip(
        ("inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens"), usage))}
    return result


def _every_session_claude(fake_claude):
    """An implement, a review that finds one defect, a verification that
    keeps it and the fix turn, each saying something no other turn says. The
    fix turn resumes the implement session, so it reports that session's
    cost and tokens so far, as Claude does."""
    def reply(session, text, cost, usage):
        return f"echo '{json.dumps(_metered(session, text, cost, usage))}'"
    return fake_claude(
        "prompt=\"$(cat)\"\n"
        f"if printf '%s' \"$prompt\" | grep -q \"{VERIFY_MARKER}\"; then\n"
        f"  {reply('verify-session', 'keep 1 VERIFY-SAYS-THIS', 0.08, VERIFY_USAGE)}\n"
        f"elif printf '%s' \"$prompt\" | grep -q \"{REVIEW_MARKER}\"; then\n"
        f"  {reply(REVIEW_SESSION, 'review: 1 defect(s) found' + chr(10) + '1. REVIEW-SAYS-THIS', 0.05, REVIEW_USAGE)}\n"
        f"elif printf '%s' \"$prompt\" | grep -q \"{FIX_MARKER}\"; then\n"
        "  printf 'fixed\\n' > fixed.txt && git add -A && git commit -q -m 'the fix'\n"
        f"  {reply(IMPLEMENT_SESSION, 'FIX-SAYS-THIS', 0.30, _session_so_far(IMPLEMENT_USAGE, FIX_USAGE))}\n"
        "else\n"
        "  printf 'real work\\n' > implemented.txt && git add -A && git commit -q -m 'the step'\n"
        f"  {reply(IMPLEMENT_SESSION, 'IMPLEMENT-SAYS-THIS', 0.10, IMPLEMENT_USAGE)}\n"
        "fi\n"
    )


def _run_every_session(runner, workspace, fake_claude, tmp_path):
    with_status(workspace, ["create", "analyze"])
    stream = tmp_path / "job.stream.jsonl"
    rc, out, _ = run(runner, workspace, _every_session_claude(fake_claude), command="implement",
                     review_model="claude-sonnet-4", verify_model="claude-opus-4", stream_file=str(stream))
    assert rc == 0 and out["terminalReason"] == "completed", out
    return out, stream.read_bytes()


def test_the_result_carries_the_review_and_the_verification_each_with_its_own_figures_ac_1_ac_2_ac_7(
    runner, workspace, fake_claude, tmp_path
):
    out, _ = _run_every_session(runner, workspace, fake_claude, tmp_path)
    for field, cost, usage in (("review", 0.05, REVIEW_USAGE), ("verify", 0.08, VERIFY_USAGE)):
        side = out[field]
        assert side["outcome"] == "completed" and side["tool"] == "claude", side
        assert abs(side["costUsd"] - cost) < 1e-6, side
        assert side["tokens"]["total"] == sum(usage), side
        assert side["durationSec"] >= 0, side
        assert_written_as_in_fixture(field, side)


def test_the_steps_tokens_count_every_turn_once_and_its_cost_stays_the_sum_of_them_ac_5(
    runner, workspace, fake_claude, tmp_path
):
    """The implement turn, the review, the verification and the review's fix
    turn each metered their own tokens; the step's figure is all four."""
    out, _ = _run_every_session(runner, workspace, fake_claude, tmp_path)
    every_turn = (IMPLEMENT_USAGE, REVIEW_USAGE, VERIFY_USAGE, FIX_USAGE)
    assert out["tokens"]["input"] == sum(u[0] for u in every_turn), out["tokens"]
    assert out["tokens"]["total"] == sum(sum(u) for u in every_turn), out["tokens"]
    assert abs(out["costUsd"] - 0.43) < 1e-6, out


def test_each_side_sessions_byte_range_holds_its_own_reply_and_no_other_turns_ac_3(
    runner, workspace, fake_claude, tmp_path
):
    out, transcript = _run_every_session(runner, workspace, fake_claude, tmp_path)
    ranges = {}
    for field, own in (("review", b"REVIEW-SAYS-THIS"), ("verify", b"VERIFY-SAYS-THIS")):
        span = out[field]["transcript"]
        ranges[field] = span
        part = transcript[span["from"]:span["to"]]
        assert own in part, part
        assert b"IMPLEMENT-SAYS-THIS" not in part and b"FIX-SAYS-THIS" not in part, part
    assert ranges["review"]["to"] <= ranges["verify"]["from"], ranges


def test_a_run_with_no_review_model_leaves_both_fields_out_ac_6(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze"])
    claude = _reviewing_claude(fake_claude, "review: no defects found")
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert out["terminalReason"] == "completed", out
    assert "review" not in out and "verify" not in out, out


def test_a_review_that_found_nothing_leaves_the_verification_field_out_ac_6(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze"])
    claude = _reviewing_claude(fake_claude, "review: no defects found")
    rc, out, _ = run(runner, workspace, claude, command="implement",
                     review_model="claude-sonnet-4", verify_model="claude-opus-4")
    assert out["review"]["outcome"] == "completed", out
    assert "verify" not in out, out
