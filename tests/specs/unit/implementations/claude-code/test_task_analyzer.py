"""The task-analyzer agent writes spec files the one way a spec file is written.

A spec file goes through `aide-write-spec`, never the Write or Edit tool —
the same rule the analyze skill follows — so an agent that still wrote
with Write would stop working the moment Write is denied on spec folders.
"""
import re

import pytest

SPEC_FILES = ["2-analysis.md", "3-solution.md", "4-status.md"]


@pytest.mark.claude_code
def test_task_analyzer_writes_every_spec_file_through_aide_write_spec(workspace_root):
    agent = (workspace_root / "implementations" / "claude-code" / "agents" / "task-analyzer.md").read_text()
    for name in SPEC_FILES:
        assert re.search(rf"aide-write-spec [^\n]*\\\n\s*--file {re.escape(name)}", agent), name
        assert not re.search(rf"^\s*(Write|Edit) \S*{re.escape(name)}", agent, re.M), name
