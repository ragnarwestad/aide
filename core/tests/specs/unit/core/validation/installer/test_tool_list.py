import subprocess

from .tool_list import read_tools


def test_reader_returns_every_tool_and_field_ac_1(workspace_root):
    tools = read_tools(workspace_root)
    assert [tool["id"] for tool in tools] == ["claude", "copilot", "codex", "opencode"]
    reader = workspace_root / "core/scripts/lib/ai-tools/read.sh"
    result = subprocess.run(
        ["/bin/bash", "-c", f'source "{reader}"; ai_tool_field codex implementation'],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "codex"


def test_tool_list_matches_implementation_folders_ac_1(workspace_root):
    listed = sorted(tool["implementation"] for tool in read_tools(workspace_root))
    actual = sorted(
        path.parent.name
        for path in (workspace_root / "core/implementations").glob("*/install.sh")
        if (path.parent / "uninstall.sh").is_file()
    )
    assert listed == actual
