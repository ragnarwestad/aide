"""Validation of the rule files in core/rules/.

The `paths` frontmatter scopes a rule to matching files in Claude Code.
The spec-structure rule originally carried a location-based glob that
matched neither the default `specs/` location nor an external specs repo —
the rule never activated via path matching (spec 71 in aide-specs).
The globs must be based on the spec file NAMES, which hold wherever
the specs live.
"""
import fnmatch
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[6]
RULES_DIR = ROOT / "core" / "rules"

# Paths the rule must activate for: the default in-project location and an
# external specs repo (AIDE_SPECS_PATH).
SAMPLE_SPEC_PATHS = [
    "specs/05-PROJ-1234-slug/2-analysis.md",
    "aide-specs/71-frontmatter-and-instruction-file-support/4-status.md",
]


def rule_paths(rule_file: Path) -> list[str]:
    match = re.match(r"^---\n(.*?)\n---", rule_file.read_text(), re.DOTALL)
    if not match:
        return []
    return re.findall(r'-\s*"([^"]+)"', match.group(1))


@pytest.mark.validation
class TestSpecStructureRuleScope:
    @pytest.mark.parametrize("sample", SAMPLE_SPEC_PATHS)
    def test_globs_match_spec_files_wherever_they_live(self, sample):
        globs = rule_paths(RULES_DIR / "spec-structure.md")
        assert globs, "spec-structure.md must have paths frontmatter"
        assert any(fnmatch.fnmatch(sample, g) for g in globs), (
            f"none of the paths globs {globs} match {sample!r} — the rule "
            "never activates for the files it is about"
        )


@pytest.mark.validation
class TestTestingRuleHasNoPathsScoping:
    """core/rules/testing.md must apply repo-wide, unlike
    spec-structure.md — it must never gain a paths: scope."""

    def test_testing_rule_carries_no_paths_frontmatter(self):
        globs = rule_paths(RULES_DIR / "testing.md")
        assert not globs, (
            "core/rules/testing.md has gained a paths: frontmatter key — "
            "this rule must apply repo-wide, not be scoped to matching files"
        )
