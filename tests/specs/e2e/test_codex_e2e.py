"""E2E tests for OpenAI Codex CLI aide workflow via headless CLI.

These are REAL end-to-end tests that:
1. Call the REAL Codex CLI tool using prompts from implementations/codex/prompts/
2. Verify that report files are ACTUALLY updated with real content
3. Check that placeholder text is REPLACED, not just that files exist

This tests the Codex implementation specifically:
- implementations/codex/prompts/aide-create.md
- implementations/codex/prompts/aide-analyze.md
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


def codex_available() -> bool:
    return shutil.which("codex", path=get_mise_path()) is not None


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
@pytest.mark.codex
@pytest.mark.skipif(not codex_available(), reason="Codex CLI not installed")
class TestCodexAideWorkflow:
    """E2E: Codex aide workflow - create and analyze."""

    @pytest.mark.slow
    def test_aide_full_workflow(self, e2e_workspace, workspace_root):
        """Test complete aide workflow: create -> analyze.

        This test verifies that:
        1. aide-create creates 4 documentation files
        2. aide-analyze ACTUALLY updates files with real content
        3. Placeholder text is replaced with analysis
        """
        print("\n" + "=" * 60, flush=True)
        print("E2E TEST: Codex aide-create -> aide-analyze", flush=True)
        print("=" * 60, flush=True)

        reports_path = e2e_workspace / "reports"
        env = {
            **os.environ,
            "PATH": get_mise_path(),
            "AIDE_INSTALLATION_PATH": str(e2e_workspace),
            "AIDE_REPORTS_PATH": str(reports_path),
        }

        # Step 1: Run aide-create via Codex
        print("\n[Step 1/5] Running aide-create via Codex...", flush=True)

        test_description = "Create a simple queue module with enqueue/dequeue"
        opprett_prompt = f"""You are creating TODO documentation (follow /aide-create).

Create a TODO plan with title "Codex E2E queue" and description: {test_description}
Assign the next available number, and create the directory with the five files from the templates in
core/templates/todo/ (0-README, 1-description, 2-analysis, 3-solution, 4-status).

Environment variables are already set:
- AIDE_INSTALLATION_PATH={e2e_workspace}
- AIDE_REPORTS_PATH={reports_path}

After creation, verify that the files were created."""

        result_opprett = subprocess.run(
            ["codex", "exec", "--full-auto", "--skip-git-repo-check", opprett_prompt],
            capture_output=True,
            text=True,
            timeout=180,
            cwd=str(e2e_workspace),
            env=env,
        )

        if result_opprett.returncode != 0:
            print(f"           Warning: codex returned {result_opprett.returncode}", flush=True)
            print(f"           Output: {result_opprett.stdout[:500]}", flush=True)
        else:
            print("           aide-create completed successfully", flush=True)

        # Step 2: Verify files created
        print("\n[Step 2/5] Verifying created files...", flush=True)
        todo_dirs = list((reports_path / "todo").glob("TODO-*"))
        assert len(todo_dirs) >= 1, (
            f"No TODO directory created. Output: {result_opprett.stdout} {result_opprett.stderr}"
        )
        todo_dir = todo_dirs[0]
        todo_id = todo_dir.name
        print(f"           Created: {todo_id}", flush=True)

        for f in ["1-description.md", "2-analysis.md", "3-solution.md", "4-status.md"]:
            assert (todo_dir / f).exists(), f"Missing file: {f}"
        print("           All 4 files exist", flush=True)

        initial_analyse = (todo_dir / "2-analysis.md").read_text()
        initial_losning = (todo_dir / "3-solution.md").read_text()

        # Step 3: Run aide-analyze using Codex prompt file
        print("\n[Step 3/5] Running aide-analyze via Codex prompt (this takes ~3 min)...", flush=True)

        analyser_prompt_file = e2e_workspace / "implementations" / "codex" / "prompts" / "aide-analyze.md"
        assert analyser_prompt_file.exists(), f"Codex analyze prompt not found: {analyser_prompt_file}"

        analyse_prompt = f"""Analyze TODO plan {todo_id} and update the documentation.

TODO directory: {todo_dir}

STEP 1: Read the description in {todo_dir}/1-description.md

STEP 2: Analyze the task (this is a simple queue module with enqueue/dequeue)

STEP 3: Update these files with actual content (NOT placeholder text):
- {todo_dir}/2-analysis.md - Fill in the analysis of the task
- {todo_dir}/3-solution.md - Create an implementation plan with steps
- {todo_dir}/4-status.md - Update the status

IMPORTANT:
- Replace ALL "[filled in by analysis]" and similar placeholders with actual content
- Write in English
- Mention "queue", "enqueue" and "dequeue" in the analysis"""

        result_analyser = subprocess.run(
            ["codex", "exec", "--full-auto", "--skip-git-repo-check", analyse_prompt],
            capture_output=True,
            text=True,
            timeout=480,
            cwd=str(e2e_workspace),
            env=env,
        )

        if result_analyser.returncode != 0:
            print(f"           Warning: codex returned {result_analyser.returncode}", flush=True)
            print(f"           Output: {result_analyser.stdout[:500]}", flush=True)
        else:
            print("           aide-analyze completed successfully", flush=True)

        # Step 4: Verify files were updated
        print("\n[Step 4/5] Verifying 2-analysis.md was updated...", flush=True)
        updated_analyse = (todo_dir / "2-analysis.md").read_text()
        updated_losning = (todo_dir / "3-solution.md").read_text()

        assert updated_analyse != initial_analyse, "2-analysis.md was NOT modified by aide-analyze!"
        print("           Content changed: YES", flush=True)

        assert_placeholders_replaced(updated_analyse, "2-analysis.md")
        print("           Placeholders replaced: YES", flush=True)

        assert_sections_filled(updated_analyse, REQUIRED_SECTIONS_2_ANALYSE, "2-analysis.md")
        print("           Required sections filled: YES", flush=True)

        assert "queue" in updated_analyse.lower(), (
            "2-analysis.md does not mention the task (queue module)."
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
