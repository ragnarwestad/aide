"""E2E tests for Claude Code aide workflow via headless CLI.

These are REAL end-to-end tests that:
1. Call the REAL Claude CLI tool using SLASH COMMANDS (/aide-create, /aide-analyze)
2. Verify that report files are ACTUALLY updated with real content
3. Check that placeholder text is REPLACED, not just that files exist

This tests the Claude Code implementation specifically:
- .claude/commands/aide-create.md (slash command)
- .claude/commands/aide-analyze.md (slash command)
"""
import pytest
import subprocess
import shutil
import os
import re
from pathlib import Path


def get_mise_path() -> str:
    """Get PATH with mise shims included."""
    mise_shims = Path.home() / ".local" / "share" / "mise" / "shims"
    current_path = os.environ.get("PATH", "")
    if str(mise_shims) not in current_path:
        return f"{mise_shims}:{current_path}"
    return current_path


def claude_available() -> bool:
    return shutil.which("claude", path=get_mise_path()) is not None


# Template placeholders that should be REPLACED by AI analysis
TEMPLATE_PLACEHOLDERS = [
    "[filled in by analysis]",
    "[How the analysis was performed",
    "[description of change]",
    "[Detailed description of complexity",
    "[list of complexity factors]",
    "[X hours/days]",
    "[Detailed findings from",
]

# Required sections in 2-analysis.md
REQUIRED_SECTIONS_2_ANALYSE = [
    "## Scope",
    "## Complexity",
    "## Findings",
]


def assert_placeholders_replaced(content: str, filename: str):
    """Assert that template placeholders have been replaced with actual content."""
    found_placeholders = [p for p in TEMPLATE_PLACEHOLDERS if p in content]
    assert not found_placeholders, (
        f"{filename} still contains template placeholders that should have been replaced:\n"
        f"  {found_placeholders}\n"
        f"This means the AI did NOT actually fill out the template."
    )


def assert_sections_filled(content: str, required_sections: list, filename: str):
    """Assert that required sections exist and have content after them."""
    for section in required_sections:
        assert section in content, f"{filename} is missing required section: {section}"
        section_idx = content.find(section)
        if section_idx != -1:
            after_section = content[section_idx + len(section):]
            next_section = after_section.find("\n## ")
            section_content = after_section[:next_section] if next_section != -1 else after_section
            meaningful_content = re.sub(r'[\s\-#*`]', '', section_content.strip())
            assert len(meaningful_content) > 20, (
                f"{filename} section '{section}' appears empty or has only formatting."
            )


@pytest.mark.e2e
@pytest.mark.claude_code
@pytest.mark.skipif(not claude_available(), reason="Claude CLI not installed")
class TestClaudeAideWorkflow:
    """E2E: Claude Code aide workflow - create and analyze."""

    @pytest.mark.slow
    def test_aide_full_workflow(self, e2e_workspace, workspace_root):
        """Test complete aide workflow: create -> analyze.

        This test verifies that:
        1. aide-create creates 4 documentation files
        2. aide-analyze ACTUALLY updates files with real content
        3. Placeholder text is replaced with analysis
        """
        print("\n" + "=" * 60, flush=True)
        print("E2E TEST: Claude aide-create -> aide-analyze", flush=True)
        print("=" * 60, flush=True)

        reports_path = e2e_workspace / "specs"
        aide_dir = e2e_workspace / ".aide"
        aide_dir.mkdir(exist_ok=True)
        (aide_dir / "config").write_text(f"AIDE_SPECS_PATH={reports_path}\n")
        env = {
            **os.environ,
            "PATH": get_mise_path(),
            "AIDE_INSTALLATION_PATH": str(e2e_workspace),
        }

        # Step 1: Run /aide-create slash command (Claude Code specific)
        print("\n[Step 1/5] Running /aide-create via slash command...", flush=True)
        test_description = "Create a simple greeting function with greet(name)"

        # Use the actual slash command that users use
        # This tests .claude/commands/aide-create.md
        result_opprett = subprocess.run(
            ["claude", "-p",
             f'/aide-create TODO-e2e-greeting {test_description}',
             "--allowedTools", "Bash,Read,Write,Edit"],
            capture_output=True, text=True, timeout=180,
            cwd=str(e2e_workspace),
            env=env
        )

        assert result_opprett.returncode == 0, f"/aide-create failed: {result_opprett.stderr}"
        print("           /aide-create completed successfully", flush=True)

        # Step 2: Verify files created
        print("\n[Step 2/5] Verifying created files...", flush=True)
        todo_dirs = list((reports_path / "todo").glob("TODO-*"))
        assert len(todo_dirs) >= 1, "No TODO directory created"
        todo_dir = todo_dirs[0]
        todo_id = todo_dir.name
        print(f"           Created: {todo_id}", flush=True)

        for f in ["1-description.md", "2-analysis.md", "3-solution.md", "4-status.md"]:
            assert (todo_dir / f).exists(), f"Missing file: {f}"
        print("           All 4 files exist", flush=True)

        initial_analyse = (todo_dir / "2-analysis.md").read_text()
        initial_losning = (todo_dir / "3-solution.md").read_text()

        # Step 3: Run /aide-analyze slash command (Claude Code specific)
        print("\n[Step 3/5] Running /aide-analyze via slash command (this takes ~2 min)...", flush=True)

        # Use the actual slash command that users use
        # This tests .claude/commands/aide-analyze.md
        result_analyser = subprocess.run(
            ["claude", "-p",
             f'/aide-analyze {todo_id}',
             "--allowedTools", "Bash,Read,Write,Edit"],
            capture_output=True, text=True, timeout=300,
            cwd=str(e2e_workspace),
            env=env
        )

        assert result_analyser.returncode == 0, f"/aide-analyze failed: {result_analyser.stderr}"
        print("           /aide-analyze completed successfully", flush=True)

        # Step 4: Verify files were updated
        print("\n[Step 4/5] Verifying 2-analysis.md was updated...", flush=True)
        updated_analyse = (todo_dir / "2-analysis.md").read_text()
        updated_losning = (todo_dir / "3-solution.md").read_text()

        # 1. Content must have changed
        assert updated_analyse != initial_analyse, (
            "2-analysis.md was NOT modified by aide-analyze!"
        )
        print("           Content changed: YES", flush=True)

        # 2. Placeholder text must be replaced
        assert_placeholders_replaced(updated_analyse, "2-analysis.md")
        print("           Placeholders replaced: YES", flush=True)

        # 3. Required sections must have content
        assert_sections_filled(updated_analyse, REQUIRED_SECTIONS_2_ANALYSE, "2-analysis.md")
        print("           Required sections filled: YES", flush=True)

        # 4. Should mention the actual task
        assert "greeting" in updated_analyse.lower() or "greet" in updated_analyse.lower(), (
            "2-analysis.md does not mention the task (greeting function)."
        )
        print("           Task mentioned: YES", flush=True)

        # Step 5: Verify 3-losning.md
        print("\n[Step 5/5] Verifying 3-solution.md was updated...", flush=True)
        assert updated_losning != initial_losning, "3-solution.md was NOT modified"
        assert any(word in updated_losning.lower() for word in ["step", "phase", "implementation plan"]), (
            "3-solution.md does not contain implementation steps"
        )
        print("           Implementation steps found: YES", flush=True)

        print("\n" + "=" * 60, flush=True)
        print("E2E TEST PASSED: All verifications successful!", flush=True)
        print("=" * 60, flush=True)
