"""The run writes its own timeline to its log: the clock, and seconds
since the start, at each stage that can wait on something outside it.
A create step stood still for seven minutes before its model started,
and nothing in its log said where (2026-09-19).
"""

import json
import re
from ..conftest import run
from .run_spec_results import RESULT_OK
from .run_spec_status_files import with_status


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


def test_the_turn_line_says_where_the_transcript_stood_and_the_commit_comes_after_it_AC_3(
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
    assert turns == ["model turn started (transcript at byte 0)"], stages
    commit = next(i for i, s in enumerate(stages) if s.startswith("committing in "))
    assert commit > stages.index(turns[-1]), stages
