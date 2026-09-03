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

ROOT = Path(__file__).parents[5]
RULES_DIR = ROOT / "core" / "rules"
SKILLS_DIR = ROOT / "core" / "skills"

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
    """The plan review (spec 77) must be part of the documented flow.

    Spec 181 took away the step of its own: the review runs inside
    `/aide-analyze` now. A review nothing describes is a review nobody
    knows happens, so the workflow rule and the skills list still have
    to say it runs — and say it runs there.
    """

    @pytest.mark.parametrize("skill", ["workflows", "tools-and-scripts"])
    def test_docs_mention_the_review_step(self, skill):
        """Both were rules until spec 147 moved them to core/skills/.

        The whole skill directory is searched, not just SKILL.md: a skill
        over the size guidance keeps its detail in references/, and the
        review may legitimately be described there.
        """
        directory = SKILLS_DIR / skill
        assert directory.is_dir(), f"core/skills/{skill}/ is missing"
        content = "\n".join(
            path.read_text(encoding="utf-8") for path in sorted(directory.rglob("*.md"))
        )
        assert "aide-review-plan" not in content, (
            f"the {skill} skill still names aide-review-plan — the review "
            "stopped being a step of its own in spec 181"
        )
        assert "aide-analyze" in content and "feasibility" in content, (
            f"the {skill} skill does not describe the plan review as part of "
            "/aide-analyze — the review is not wired into the documented workflow"
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
class TestTestingRuleHasNoPathsScoping:
    """core/rules/testing.md must apply repo-wide, unlike
    spec-structure.md — it must never gain a paths: scope."""

    def test_testing_rule_carries_no_paths_frontmatter(self):
        globs = rule_paths(RULES_DIR / "testing.md")
        assert not globs, (
            "core/rules/testing.md has gained a paths: frontmatter key — "
            "this rule must apply repo-wide, not be scoped to matching files"
        )


@pytest.mark.validation
class TestManifestIsWired:
    """The project manifest (spec 78) must be documented, consumed and
    not hidden by the old wide-ignore recommendation."""

    ROOT = Path(__file__).parents[5]

    def test_tools_and_scripts_documents_the_manifest(self):
        directory = SKILLS_DIR / "tools-and-scripts"
        content = "\n".join(
            path.read_text(encoding="utf-8") for path in sorted(directory.rglob("*.md"))
        )
        assert "aide-manifest" in content and "project.yaml" in content, (
            "the tools-and-scripts skill does not document the project manifest"
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


# The four rules that became skills in spec 147, so that AGENTS.md fits
# inside Codex's read window and Claude Code stops carrying all four in
# every prompt regardless of the task.
RETIRED_RULES = ["workflows", "documentation", "tools-and-scripts", "markdown-linting"]


@pytest.mark.validation
class TestRetiredRulesAreGoneFromTheSource:
    """The four task-specific rules live in core/skills/ now, not core/rules/.

    A copy left behind in core/rules/ is worse than useless: the installer
    would ship both, the generator would concatenate the rule back into
    AGENTS.md, and the two copies would drift.
    """

    @pytest.mark.parametrize("name", RETIRED_RULES)
    def test_the_rule_file_is_gone(self, name):
        assert not (RULES_DIR / f"{name}.md").exists(), (
            f"core/rules/{name}.md still exists — it became "
            f"core/skills/{name}/SKILL.md in spec 147"
        )

    @pytest.mark.parametrize("name", RETIRED_RULES)
    def test_the_skill_took_its_place(self, name):
        assert (SKILLS_DIR / name / "SKILL.md").exists(), (
            f"core/skills/{name}/SKILL.md is missing — the rule was retired "
            "without its replacement"
        )

    def test_spec_structure_stays_a_rule(self):
        """It is the one that does NOT fully move: Claude Code keeps
        loading it path-scoped, and only Codex/Copilot get the skill."""
        rule = RULES_DIR / "spec-structure.md"
        assert rule.exists(), "core/rules/spec-structure.md must stay a rule"
        assert rule_paths(rule), (
            "core/rules/spec-structure.md lost its paths frontmatter — "
            "without it Claude Code would load the whole spec layout in "
            "every prompt, which is what spec 147 exists to stop"
        )


@pytest.mark.validation
class TestNoLinksToRetiredRules:
    """No document may point at core/rules/<retired>.md any more.

    Ten documents linked to the four by that path before spec 147. A link
    that survives the move is a 404 for a reader and a dead end for a
    model.
    """

    def test_no_document_links_to_a_retired_rule_path(self):
        import subprocess

        offenders = []
        for name in RETIRED_RULES:
            needle = f"core/rules/{name}.md"
            result = subprocess.run(
                ["git", "grep", "-nF", "--", needle],
                cwd=ROOT, capture_output=True, text=True,
            )
            for line in result.stdout.splitlines():
                # This test names the paths it forbids; so does the spec
                # documentation that records the move.
                if line.startswith(f"{Path(__file__).relative_to(ROOT)}:"):
                    continue
                offenders.append(line)
        assert not offenders, (
            "documents still link to a rule that became a skill in spec "
            "147 (point them at core/skills/<name>/SKILL.md instead):\n  "
            + "\n  ".join(offenders)
        )
