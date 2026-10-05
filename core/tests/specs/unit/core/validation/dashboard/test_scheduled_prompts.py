"""A scheduled prompt that writes a report names the file the board reads it from."""
import re

import pytest

PROMPT = "docs/prompts/check-news.md"


@pytest.fixture
def prompt(workspace_root):
    return (workspace_root / PROMPT).read_text()


@pytest.mark.validation
class TestNewsCheckPromptIsAReport:
    def test_it_names_the_file_the_board_reads_AC_6(self, prompt, workspace_root):
        source = (workspace_root / "dashboard/src/queue/spec-proposals.ts").read_text()
        name = re.search(r'PROPOSALS_FILE = "([^"]+)"', source).group(1)
        assert f"$AIDE_SCHEDULE_OUTPUT_DIR/{name}" in prompt


@pytest.mark.validation
class TestWikiCheckPromptIsAReport:
    def test_it_names_the_file_the_board_reads_as_the_run_s_report(self, workspace_root):
        source = (workspace_root / "dashboard/src/queue/schedule.ts").read_text()
        name = re.search(r'scheduleRunOutputDir\([^)]*\), "([^"]+)"', source).group(1)
        prompt = (workspace_root / "docs/prompts/wiki-check.md").read_text()
        assert f"$AIDE_SCHEDULE_OUTPUT_DIR/{name}" in prompt
