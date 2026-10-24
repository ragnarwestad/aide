"""The news check writes a report the board reads, and proposes no specs."""
import re

import pytest

PROMPT = "docs/prompts/check-news.md"


@pytest.fixture
def prompt(workspace_root):
    return (workspace_root / PROMPT).read_text()


@pytest.mark.validation
class TestNewsCheckPromptIsAReport:
    def test_it_names_the_file_the_board_reads(self, prompt, workspace_root):
        source = (workspace_root / "dashboard/src/queue/schedule.ts").read_text()
        name = re.search(r'scheduleRunOutputDir\([^)]*\), "([^"]+)"\)', source).group(1)
        assert f"$AIDE_SCHEDULE_OUTPUT_DIR/{name}" in prompt

    def test_it_never_asks_for_the_file_the_board_creates_specs_from(self, prompt, workspace_root):
        source = (workspace_root / "dashboard/src/queue/spec-proposals.ts").read_text()
        name = re.search(r'PROPOSALS_FILE = "([^"]+)"', source).group(1)
        assert f"$AIDE_SCHEDULE_OUTPUT_DIR/{name}" not in prompt
