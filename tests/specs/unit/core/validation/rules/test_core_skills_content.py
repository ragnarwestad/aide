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

    def test_the_boundary_mark_is_written_in_the_grammar_the_readers_parse(self, skill):
        """One grammar, four readers: `completed_steps_for` in
        `core/scripts/aide-run-spec`, `parse-status.ts`,
        `workflow-history.ts` and `description-freshness.ts`."""
        assert "**Reopened:**" in skill
        assert "history before" in skill


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

    def test_step_5_offers_the_create_commit_with_the_convention_message(self):
        step5 = self._step_5_text()
        assert "Run /aide-create for" in step5, (
            "Step 5 does not offer the `Run /aide-create for <spec-folder>` "
            "commit — the one convention-carrying commit aide-create was "
            "missing"
        )


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


class TestTheAcceptanceRowSaysWhatThePlanDecided:
    """A reading the plan chose, a requirement no test covers, and a
    browser test as the only proof are said on the row the user ticks,
    not only deep in the plan's own review."""

    @pytest.fixture
    def step_8(self):
        tracing = (
            CORE_SKILLS_DIR / "aide-analyze" / "references" / "requirements-tracing.md"
        ).read_text(encoding="utf-8")
        return tracing.split("## Step 8", 1)[1].split("## A held-back", 1)[0]

    @pytest.mark.parametrize("prefix", ["`Read as:", "`Not tested:", "`Browser test:"])
    def test_each_decision_has_its_sentence(self, step_8, prefix):
        assert prefix in step_8, f"Step 8 must name the {prefix} note"

    def test_an_ordinary_row_says_nothing(self, step_8):
        assert "Notes cell stays empty" in step_8


@pytest.mark.validation
class TestReopenAsksBeforeItResetsTheFiles:
    """Spec 511. A reopen keeps the analysis, the plan and the status
    unless the person asks for them to be reset; the skill is where that
    question is asked at a keyboard."""

    @pytest.fixture
    def skill(self):
        return (CORE_SKILLS_DIR / "aide-reopen" / "SKILL.md").read_text()

    def test_the_keep_mode_names_the_mechanical_script_AC_2(self, skill):
        assert "aide-reopen-spec" in skill
        assert "**Round boundary:**" in skill


REPO_ROOT = CORE_SKILLS_DIR.parent.parent


@pytest.mark.validation
class TestNotVerifiedStartState:
    """Spec 509: analyze starts a `Not tested:` row as `Not verified`,
    implement never writes that mark, and the spec-structure text names it."""

    def test_step_8_starts_a_not_tested_row_as_not_verified_AC_21(self):
        text = (CORE_SKILLS_DIR / "aide-analyze" / "references" / "requirements-tracing.md").read_text()
        step8 = text[text.index("## Step 8"):]
        assert re.search(r"`Not tested:`[^.]*starts with Status\s+`Not verified`", step8), (
            "Step 8 must say a `Not tested:` row starts as `Not verified`"
        )

    @pytest.mark.parametrize("path", [
        REPO_ROOT / "core" / "rules" / "spec-structure.md",
    ], ids=["rule"])
    def test_spec_structure_names_the_mark_in_legend_and_acceptance_section(self, path):
        text = path.read_text()
        assert "| Not verified |" in text
        assert re.search(r"`Not tested:`[^.]*starts as\s+`Not verified`", text)


@pytest.mark.validation
class TestFailedMark:
    """Spec 510: `❌ Failed` is written by the user only, and its `Failed:` note
    survives the implement step's rewrite of an open row's Notes cell."""

    @pytest.mark.parametrize("path", [
        REPO_ROOT / "core" / "rules" / "spec-structure.md",
    ], ids=["rule"])
    def test_spec_structure_names_failed_in_legend_and_acceptance_section(self, path):
        text = path.read_text()
        assert "| ❌ Failed |" in text
        assert re.search(r"marked\s+`❌ Failed`[^.]*`Failed:`", text)
        assert re.search(r"Reopening the spec puts the row back to\s+`⬜`", text)
