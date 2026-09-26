"""The rule that a spec deletes the tests for behaviour it replaced.

Two files carry it, and they are only useful together: `core/rules/testing.md`
states it, and `core/skills/aide-archive/SKILL.md` is where it is acted on —
Step 2, before the commit in Step 3. A rule nothing invokes is a rule
nobody applies, so these tests read both sides.
"""
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[6]
TESTING_RULE = ROOT / "core" / "rules" / "testing.md"
ARCHIVE_SKILL = ROOT / "core" / "skills" / "aide-archive" / "SKILL.md"
HEADING = "## Replaced behaviour takes its tests with it"


@pytest.fixture
def rule_text():
    return TESTING_RULE.read_text()


@pytest.fixture
def skill_text():
    return ARCHIVE_SKILL.read_text()


class TestTheRule:
    def test_the_testing_rule_has_the_section(self, rule_text):
        assert HEADING in rule_text, \
            f"core/rules/testing.md must state the rule under '{HEADING}'"


class TestTheArchiveStep:
    def test_the_skill_acts_on_it(self, skill_text):
        assert "replaced behaviour" in skill_text.lower(), \
            "aide-archive must tell the step to delete the tests for the " \
            "behaviour the spec replaced"

    def test_it_names_the_rule_it_comes_from(self, skill_text):
        assert "core/rules/testing.md" in skill_text, \
            "the step must name the rule, so the wording lives in one place"

    def test_it_happens_before_the_commit(self, skill_text):
        step2 = skill_text.split("### Step 2", 1)[1].split("### Step 3", 1)[0]
        assert "Step 3" in step2 and "delete" in step2.lower(), \
            "the deletion belongs in Step 2, before Step 3 commits"
