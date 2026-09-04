"""What each skill's own text has to say: what reopen and reset keep,
what create stages and offers to commit, and the rule against citing a
spec's history in a living document.

Split out of test_core_skills.py 2026-09-04; the tests are unchanged and
keep their names.
"""

import re
import subprocess
from pathlib import Path
import pytest

from .test_core_skills import (
    CORE_SKILLS_DIR,
    get_skill_dirs,
)


@pytest.mark.validation
class TestReopenSkillKeepsWhatTheDescriptionAsksFor:
    """Spec 198. Three of the seven acceptance criteria are the SKILL's
    own promises rather than the runner's, and no fixture repo can reach
    them: what a model writes into `4-status.md`, which files it leaves
    alone, and whether it says the same thing to a terminal that the
    dashboard's control says to `aide-run-spec`. What CAN be checked is
    that the instructions still name them — the same net
    `test_templates.py` keeps over the spec layout, and for the same
    reason: a partial edit here fails the suite instead of escaping into
    the next reopened spec.
    """

    @pytest.fixture
    def skill(self):
        path = CORE_SKILLS_DIR / "aide-reopen" / "SKILL.md"
        assert path.exists(), "core/skills/aide-reopen/SKILL.md is missing"
        return path.read_text()

    def test_the_description_and_the_readme_are_named_as_untouched(self, skill):
        """AC7. The description is WHY the spec exists and is what the
        new round is for."""
        assert "1-description.md" in skill
        assert "0-README.md" in skill

    def test_the_three_reset_files_are_named(self, skill):
        for name in ("2-analysis.md", "3-solution.md", "4-status.md"):
            assert name in skill, f"{name} is not named as one of the files reset"

    def test_the_archive_trail_is_kept(self, skill):
        """AC3. The commits cannot be deleted and should not be; the
        spec's own archive trail has to go on reading."""
        assert "**Archived:**" in skill

    def test_the_boundary_mark_is_written_in_the_grammar_the_readers_parse(self, skill):
        """One grammar, four readers: `completed_steps_for` in
        `core/scripts/aide-run-spec`, `parse-status.ts`,
        `workflow-history.ts` and `description-freshness.ts`."""
        assert "**Reopened:**" in skill
        assert "history before" in skill


@pytest.mark.validation
class TestResetSkillKeepsTheActiveSpecHistory:
    @pytest.fixture
    def skill(self):
        path = CORE_SKILLS_DIR / "aide-reset" / "SKILL.md"
        assert path.exists(), "core/skills/aide-reset/SKILL.md is missing"
        return path.read_text()

    def test_it_keeps_the_owned_files_and_regenerates_the_work_files(self, skill):
        for name in ("0-README.md", "1-description.md", "2-analysis.md", "3-solution.md", "4-status.md"):
            assert name in skill

    def test_it_writes_the_reset_boundary_and_refuses_archived_specs(self, skill):
        assert "**Reset:**" in skill
        assert "history before" in skill
        assert "active folder" in skill

    def test_the_four_places_a_branch_hides_are_named(self, skill):
        """AC2, incident 1: a local ref left behind in one of the four
        (project-local, project-origin, specs-local, specs-origin) and
        the next run refuses on a conflict nobody can see."""
        for word in ("origin", "local"):
            assert word in skill.lower()

    def test_it_says_the_headless_run_gets_its_commit_for_free(self, skill):
        """AC4. Both surfaces have to leave the spec in the same state,
        and a skill that stops to ask in a headless run leaves it in
        neither."""
        assert "headless" in skill.lower()


@pytest.mark.validation
class TestCreateSkillStagesAndOffersToCommit:
    """Spec 219, AC9. Of the four step skills, aide-create was the only
    one that never offered a commit — Step 5 unconditionally SKIPPED
    `git add` whenever the specs root sat outside the project (the
    `aide-specs` shape), so the ordinary interactive flow produced no
    aide-authored commit for commit-msg-spec-guard to recognize. A
    human committing that scaffold by hand from the IDE would then be
    blocked by the very hook meant to catch hand-written specs, even
    though the files were genuinely produced by the skill.
    """

    SKILL = CORE_SKILLS_DIR / "aide-create" / "SKILL.md"

    def _step_5_text(self) -> str:
        text = self.SKILL.read_text(encoding="utf-8")
        start = text.index("### Step 5:")
        end = text.index("### Step 6:", start)
        return text[start:end]

    def test_step_5_no_longer_unconditionally_skips_git_add(self):
        step5 = self._step_5_text()
        assert "SKIP" not in step5, (
            "Step 5 still skips `git add` for an external specs root — "
            "a spec created there never gets staged, so there is "
            "nothing for Step 5's commit offer to commit"
        )
        assert "git add" in step5

    def test_step_5_offers_the_create_commit_with_the_convention_message(self):
        step5 = self._step_5_text()
        assert "Run /aide-create for" in step5, (
            "Step 5 does not offer the `Run /aide-create for <spec-folder>` "
            "commit — the one convention-carrying commit aide-create was "
            "missing"
        )

    def test_it_says_the_headless_run_gets_its_commit_for_free(self):
        """Matches the other three step skills' identical wording, so a
        headless `aide-run-spec` run and an interactive one leave the
        spec in the same state."""
        step5 = self._step_5_text()
        assert "headless" in step5.lower()

    def test_validation_is_local_only_without_package_download_fallback(self):
        skill = self.SKILL.read_text(encoding="utf-8")
        assert "markdownlint-cli2" in skill
        assert "installed locally" in skill
        assert "must not invoke `npx`" in skill


@pytest.mark.validation
class TestCreateSkillStep4CallsTheScript:
    """Spec 248, AC8. Step 4 used to write the 5 spec files with the
    Write tool directly — indistinguishable, at the permission layer,
    from an AI assistant mistakenly hand-writing spec files outside any
    skill. It now calls aide-create-spec over Bash instead, so a future
    edit cannot silently regress Step 4 back to inline Write-tool
    instructions without a test noticing.
    """

    SKILL = CORE_SKILLS_DIR / "aide-create" / "SKILL.md"

    def _step_4_text(self) -> str:
        text = self.SKILL.read_text(encoding="utf-8")
        start = text.index("### Step 4:")
        end = text.index("### Step 5:", start)
        return text[start:end]

    def test_step_4_invokes_the_script_over_bash(self):
        step4 = self._step_4_text()
        assert "aide-create-spec" in step4
        assert "```bash" in step4

    def test_step_4_contains_no_write_tool_instruction(self):
        step4 = self._step_4_text()
        assert "never the Write tool" in step4
        assert "Create the files with content from" not in step4


@pytest.mark.validation
class TestMarkdownHookDefaultsAreLocalOnly:
    def test_claude_hook_does_not_use_npx_for_markdownlint(self):
        settings_path = CORE_SKILLS_DIR.parents[1] / "implementations" / "claude-code" / "settings.json"
        settings = settings_path.read_text(encoding="utf-8")
        assert "npx markdownlint-cli2" not in settings


NARRATION_PATTERN = re.compile(r"\bspec\s+\d+\b")


def _strip_fenced_code_blocks(text: str) -> str:
    return re.sub(r"```.*?```", "", text, flags=re.DOTALL)


@pytest.mark.validation
class TestNoHistoricalSpecCitations:
    """A bare 'spec N' citation in a SKILL.md body is always attribution,
    never an instruction — every occurrence found in spec 249's audit
    read the same or better with the citation deleted. Guards against a
    future skill edit reintroducing the pattern this spec removed.
    """

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_skill_body_has_no_spec_number_citation(self, skill_dir):
        content = (skill_dir / "SKILL.md").read_text(encoding="utf-8")
        body = re.sub(r"^---\n.*?\n---\n", "", content, count=1, flags=re.DOTALL)
        body = _strip_fenced_code_blocks(body)
        match = NARRATION_PATTERN.search(body)
        assert match is None, (
            f"{skill_dir.name}/SKILL.md cites a spec number "
            f"({match.group(0)!r}) — state the instruction directly, "
            f"without the historical citation"
        )
