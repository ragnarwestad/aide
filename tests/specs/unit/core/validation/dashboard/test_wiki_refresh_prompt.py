"""A wiki-refresh schedule entry rebuilds the wiki the way the Build button
does, and — unlike a `wiki` step run from that button — lets the board land
whatever it commits under wiki/ once the run ends (spec 558, AC-7).
"""
import pytest

PROMPT = "docs/prompts/wiki-refresh.md"


@pytest.fixture
def prompt(workspace_root):
    return (workspace_root / PROMPT).read_text()


@pytest.mark.validation
class TestWikiRefreshPromptCommitsUnderWiki:
    def test_it_runs_the_wiki_skill_AC_7(self, prompt):
        assert "/aide-wiki" in prompt

    def test_it_says_it_may_commit_under_the_specs_root_s_wiki_folder_AC_7(self, prompt):
        assert "wiki/" in prompt

    def test_it_leaves_the_merge_to_the_board_rather_than_doing_it_itself_AC_7(self, prompt):
        assert "the board lands the work" in prompt
        assert "do not run the skill's own Step 5" in prompt

    def test_it_does_not_carry_the_report_only_wording_of_the_other_schedule_prompts(self, prompt):
        # docs/prompts/check-news.md and nightly-e2e.md are report-only —
        # this one is deliberately not, so it must not repeat their sentence.
        assert "Commit nothing and push nothing" not in prompt
