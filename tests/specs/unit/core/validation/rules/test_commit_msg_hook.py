"""The commit-msg hook in .githooks refuses a message that names a tool:
a Co-Authored-By trailer or a Claude-Session line, in any case."""
import subprocess

import pytest


def run_hook(workspace_root, tmp_path, message):
    msg = tmp_path / "COMMIT_EDITMSG"
    msg.write_text(message)
    return subprocess.run(
        ["bash", str(workspace_root / ".githooks" / "commit-msg"), str(msg)],
        capture_output=True, text=True,
    )


@pytest.mark.parametrize("line", [
    "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
    "co-authored-by: Someone <x@y.z>",
    "Claude-Session: https://claude.ai/code/session_x",
])
def test_a_line_naming_a_tool_refuses_the_commit(workspace_root, tmp_path, line):
    proc = run_hook(workspace_root, tmp_path, f"Fix the thing\n\nWhy it was broken.\n\n{line}\n")
    assert proc.returncode == 1
    assert line in proc.stderr


def test_an_ordinary_message_passes(workspace_root, tmp_path):
    proc = run_hook(workspace_root, tmp_path, "Fix the thing\n\nThe co-authored-by trailer is refused.\n")
    assert proc.returncode == 0, proc.stderr
