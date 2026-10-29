"""The run writes its own timeline to its log: the clock, and seconds
since the start, at each stage that can wait on something outside it.
A create step stood still for seven minutes before its model started,
and nothing in its log said where (2026-09-19).
"""

import json
import pathlib
import re
import shlex
import pytest
from ...conftest import STOP_DEADLINE_SEC, run
from ..run_spec_results import CODEX_STREAM_OK, CODEX_THREAD_ID, CODEX_USAGE, OPENCODE_SESSION_ID, OPENCODE_STEPS, RESULT_OK
from ..run_spec_status_files import with_status


def test_the_log_names_each_waiting_stage_in_order(runner, workspace, fake_claude):
    with_status(workspace, ["create", "analyze"])
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    _, out, _, err = run(runner, workspace, claude, command="implement", return_stderr=True)
    stages = [m.group(2) for m in re.finditer(r"^aide-run-spec (\d\d:\d\d:\d\d \+\d+s) (.+)$", err, re.M)]
    order = ["waiting for the checkout lock", "lock taken", "adding the worktree", "worktree ready", "model turn started"]
    firsts = [next(i for i, s in enumerate(stages) if s.startswith(o)) for o in order]
    assert firsts == sorted(firsts), stages


def _stamped(err):
    return [m.group(1) for m in re.finditer(r"^aide-run-spec \d\d:\d\d:\d\d \+\d+s (.+)$", err, re.M)]


def test_the_turn_line_says_where_the_transcript_stood_and_the_commit_comes_after_it(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    claude = fake_claude("cat > /dev/null\nprintf 'work\\n' > made.txt\n" f"echo '{json.dumps(RESULT_OK)}'")
    stream = tmp_path / "job.stream.jsonl"
    _, out, _, err = run(
        runner, workspace, claude, command="implement", stream_file=str(stream), return_stderr=True
    )
    stages = _stamped(err)
    turns = [s for s in stages if s.startswith("model turn started")]
    # implement, then the review that follows it — same reply, so the
    # same length.
    first = len(json.dumps(RESULT_OK)) + 1
    assert turns == [
        "model turn started (transcript at byte 0)",
        f"model turn started (transcript at byte {first})",
    ], stages
    commit = next(i for i, s in enumerate(stages) if s.startswith("committing in "))
    assert commit > stages.index(turns[-1]), stages


# --- the model's own step marks, dated as they appear -------------------------
#
# The model writes `--- Step N of X: <title> — started` while it works; the
# run log carries each such line with the run's clock, written the moment the
# runner sees it, for the three tools alike.

START = "--- Step 3 of 11: Grade the complexity — started"
DONE = "--- Step 3 of 11: Grade the complexity — done"
MARK_CASES = json.loads(
    (pathlib.Path(__file__).resolve().parents[6] / "fixtures" / "model-marks.json").read_text()
)["cases"]

CLAUDE_RESULT = f"echo {shlex.quote(json.dumps(RESULT_OK))}"


def claude_said(text, parent=None):
    return json.dumps({"type": "assistant", "parent_tool_use_id": parent, "message": {"content": [{"type": "text", "text": text}]}})


def codex_said(text, kind="item_type"):
    return json.dumps({"type": "item.completed", "item": {"id": "item_0", kind: "agent_message", "text": text}})


def opencode_said(text):
    return json.dumps({"type": "text", "sessionID": OPENCODE_SESSION_ID, "part": {"type": "text", "text": text}})


def body(*items, tail=None):
    """A stand-in's body that prints each event as a line, in order. A number
    is a pause in seconds; `("raw", text)` is printed with no newline;
    `("big", n)` is one event line of about n bytes."""
    out = ["cat > /dev/null"]
    for item in items:
        if isinstance(item, (int, float)):
            out.append(f"sleep {item}")
        elif item[0] == "big":
            out.append("printf '%s' '{\"type\":\"user\",\"message\":\"'")
            out.append(f"head -c {item[1]} /dev/zero | tr '\\0' a")
            out.append("printf '%s\\n' '\"}'")
        elif isinstance(item, tuple):
            out.append(f"printf '%s' {shlex.quote(item[1])}")
        else:
            out.append(f"printf '%s\\n' {shlex.quote(item)}")
    if tail:
        out.append(tail)
    return "\n".join(out)


def model_marks(err):
    """The marks the run log holds: (seconds into the run, the line)."""
    return [
        (int(m.group(1)), m.group(2))
        for m in re.finditer(r"^aide-run-spec \d\d:\d\d:\d\d \+(\d+)s (--- Step \d+ of \d+: .+)$", err, re.M)
    ]


def lines_of(err):
    return [line for _, line in model_marks(err)]


def test_a_mark_is_dated_while_the_model_writes_it_not_after_the_turn(runner, workspace, fake_claude):
    claude = fake_claude(body(claude_said(START), 2, claude_said(DONE), tail=CLAUDE_RESULT))
    _, out, _, err = run(runner, workspace, claude, return_stderr=True)
    assert out["ok"] is True, out
    marks = model_marks(err)
    assert [line for _, line in marks] == [START, DONE], err
    assert marks[1][0] - marks[0][0] >= 1, f"both marks were dated at the end of the turn: {marks}"


def test_every_case_of_the_shared_table_is_recorded_as_it_lists(runner, workspace, fake_claude):
    claude = fake_claude(body(*[claude_said(c["text"]) for c in MARK_CASES], tail=CLAUDE_RESULT))
    _, _, _, err = run(runner, workspace, claude, return_stderr=True)
    assert lines_of(err) == [line for c in MARK_CASES for line in c["recorded"]]


def test_only_the_model_s_own_text_holds_marks(runner, workspace, fake_claude):
    tool_result = json.dumps({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t", "content": START}]}})
    claude = fake_claude(body(tool_result, claude_said(START, parent="toolu_1"), claude_said(DONE), tail=CLAUDE_RESULT))
    _, _, _, err = run(runner, workspace, claude, return_stderr=True)
    assert lines_of(err) == [DONE]


def test_a_last_line_with_no_newline_is_recorded_once(runner, workspace, fake_claude):
    claude = fake_claude(body(json.dumps(RESULT_OK), ("raw", claude_said(DONE))))
    _, _, _, err = run(runner, workspace, claude, return_stderr=True)
    assert lines_of(err) == [DONE]


def test_a_line_past_one_mebibyte_does_not_stop_the_marks_after_it(runner, workspace, fake_claude):
    claude = fake_claude(body(claude_said(START), ("big", 1300000), claude_said(DONE), tail=CLAUDE_RESULT))
    _, _, _, err = run(runner, workspace, claude, return_stderr=True)
    assert lines_of(err) == [START, DONE]


def test_a_step_still_ends_at_its_time_limit_while_marks_keep_arriving(runner, workspace, fake_claude):
    claude = fake_claude(
        "cat > /dev/null\n"
        f"while true; do printf '%s\\n' {shlex.quote(claude_said(START))}; sleep 0.2; done"
    )
    _, out, _, err = run(runner, workspace, claude, timeout_sec=STOP_DEADLINE_SEC, kill_grace_sec="2", return_stderr=True)
    assert out["terminalReason"] == "timeout"
    assert lines_of(err), "no mark was recorded while the model wrote them"


def test_a_second_turn_of_a_step_records_its_own_marks_and_not_the_first_turn_s(
    runner, workspace, fake_claude
):
    with_status(workspace, ["create", "analyze"])
    claude = fake_claude(body(claude_said(START), claude_said(DONE), tail=CLAUDE_RESULT + "\nprintf 'work\\n' > made.txt"))
    _, _, _, err = run(runner, workspace, claude, command="implement", return_stderr=True)
    # implement, then the review that follows it: the same reply twice.
    assert lines_of(err) == [START, DONE, START, DONE]


def test_the_three_tools_record_the_same_two_marks(runner, workspace, fake_claude, fake_codex, fake_opencode):
    claude = fake_claude(body(claude_said(START), claude_said(DONE), tail=CLAUDE_RESULT))
    _, _, _, err = run(runner, workspace, claude, return_stderr=True)
    assert lines_of(err) == [START, DONE], "claude"

    for kind in ("item_type", "type"):
        events = [
            json.dumps({"type": "thread.started", "thread_id": CODEX_THREAD_ID}),
            json.dumps({"type": "turn.started"}),
            codex_said(START, kind),
            codex_said(DONE, kind),
            json.dumps({"type": "turn.completed", "usage": CODEX_USAGE}),
        ]
        _, _, _, err = run(runner, workspace, tool="codex", codex=fake_codex(body(*events)), return_stderr=True)
        assert lines_of(err) == [START, DONE], f"codex, kind in {kind}"

    events = [
        json.dumps({"type": "step_start", "sessionID": OPENCODE_SESSION_ID, "part": {"type": "step-start"}}),
        opencode_said(START),
        opencode_said(DONE),
        json.dumps(OPENCODE_STEPS[0]),
    ]
    _, _, _, err = run(runner, workspace, tool="opencode", opencode=fake_opencode(body(*events)), return_stderr=True)
    assert lines_of(err) == [START, DONE], "opencode"
