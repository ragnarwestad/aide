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
