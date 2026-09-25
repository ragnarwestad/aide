"""A scheduled job produces a report and never changes a repository: the
news check's prompt writes what it found into its report, and asks for no
change to the news log and no push.
"""
import pytest

PROMPT = "docs/prompts/check-news.md"


@pytest.fixture
def prompt(workspace_root):
    return (workspace_root / PROMPT).read_text()


@pytest.mark.validation
class TestNewsCheckPromptIsAReport:
    def test_it_writes_the_report_and_says_it_changes_nothing_AC_5(self, prompt):
        assert "$AIDE_SCHEDULE_OUTPUT_DIR/index.html" in prompt
        assert "Change no file in the repository" in prompt
        assert "Commit nothing and push nothing" in prompt

    def test_it_no_longer_asks_for_the_log_stamp_lint_or_commit_AC_5(self, prompt):
        for old in ("Commit the two files", "Run `scripts/stamp-versions`", "npx markdownlint-cli2"):
            assert old not in prompt, old
