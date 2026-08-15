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

RULES_DIR = Path(__file__).parents[5] / "core" / "rules"

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


# Documents that only existed in the original customer workspace. The shared rules
# are installed globally, so a routing reference to one of these is a dead
# end in every other project (spec 74 in aide-specs).
PHANTOM_DOC_NAMES = [
    "frontend code standard",
    "backend overview",
    "backend patterns",
    "API mapping guide",
    "API quick reference",
]

SHARED_CONTENT_DIRS = ["core/rules", "core/skills", "implementations/claude-code/agents"]


@pytest.mark.validation
class TestNoPhantomDocReferences:
    """Shared content must not route to documents projects do not have."""

    def test_no_phantom_document_names(self):
        root = Path(__file__).parents[5]
        offenders = []
        for rel in SHARED_CONTENT_DIRS:
            for path in (root / rel).rglob("*.md"):
                content = path.read_text(encoding="utf-8")
                for name in PHANTOM_DOC_NAMES:
                    if name in content:
                        offenders.append(f"{path.relative_to(root)}: '{name}'")
        assert not offenders, (
            "Shared content references documents that only existed in the "
            "original customer workspace:\n  " + "\n  ".join(sorted(offenders))
        )


@pytest.mark.validation
class TestPlanReviewIsWired:
    """The plan review step (spec 77) must be part of the documented flow.

    A step that exists only as a skill is invisible: the workflow rule
    and the skills list are what tell the model (and the user) that the
    step exists between analyze and implement.
    """

    @pytest.mark.parametrize("rule", ["workflows.md", "tools-and-scripts.md"])
    def test_docs_mention_the_review_step(self, rule):
        content = (RULES_DIR / rule).read_text(encoding="utf-8")
        assert "aide-review-plan" in content, (
            f"{rule} does not mention aide-review-plan — the step is "
            "not wired into the documented workflow"
        )


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
class TestManifestIsWired:
    """The project manifest (spec 78) must be documented, consumed and
    not hidden by the old wide-ignore recommendation."""

    ROOT = Path(__file__).parents[5]

    def test_tools_and_scripts_documents_the_manifest(self):
        content = (RULES_DIR / "tools-and-scripts.md").read_text(encoding="utf-8")
        assert "aide-manifest" in content and "project.yaml" in content, (
            "tools-and-scripts.md does not document the project manifest"
        )

    def test_aide_analyze_reads_the_manifest(self):
        skill = self.ROOT / "core" / "skills" / "aide-analyze" / "SKILL.md"
        assert ".aide/project.yaml" in skill.read_text(encoding="utf-8"), (
            "aide-analyze never reads the manifest — the description's "
            "whole payoff (context-aware analyses) is missing"
        )

    @pytest.mark.parametrize("doc", ["README.md", "docs/INSTALLATION.md"])
    def test_no_wide_ignore_recommendation_survives(self, doc):
        content = (self.ROOT / doc).read_text(encoding="utf-8")
        assert "`.aide/`" not in content, (
            f"{doc} still recommends ignoring the whole .aide/ directory — "
            "the manifest is committable team knowledge; only .aide/config "
            "is personal"
        )
