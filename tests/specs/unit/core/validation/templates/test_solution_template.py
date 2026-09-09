"""What 3-solution.md owns — the acceptance criteria, the scope, the
complexity and the risks — and how a requirement is traced from the
description through to the criteria that check it.

Split out of test_templates.py 2026-09-04; the tests are unchanged and
keep their names.
"""

import pytest
import re
from pathlib import Path

from .test_templates import structure_block


@pytest.mark.validation
class TestSolutionOwnsTheCriteria:
    """3-solution.md owns the testable acceptance criteria and the
    behavior delta.

    The strict separation says 1-description carries at most the AC-n
    SHALL-statement source list — the testable given/when/then scenarios
    that verify each one are part of the solution. And the solution must
    state what it changes in BEHAVIOR (adds/modifies/removes), not just
    which files it touches.
    """

    @staticmethod
    def _template(workspace_root, name):
        path = workspace_root / "core" / "templates" / "todo" / name
        if not path.exists():
            pytest.skip(f"{name} not found")
        return path.read_text()

    def test_solution_template_has_behavior_delta(self, workspace_root):
        content = self._template(workspace_root, "3-solution.md.template")
        assert "## Behavior delta" in content
        for marker in ("**Adds:**", "**Modifies:**", "**Removes:**"):
            assert marker in content, f"Behavior delta must have {marker}"

    def test_solution_template_has_given_when_then(self, workspace_root):
        content = self._template(workspace_root, "3-solution.md.template")
        assert "## Acceptance criteria" in content
        for word in ("Given", "when", "then"):
            assert word in content, \
                f"Acceptance criteria must be given/when/then scenarios ({word} missing)"

    def test_description_template_has_no_testable_given_when_then_criteria(self, workspace_root):
        content = self._template(workspace_root, "1-description.md.template")
        assert not any(line.startswith("## Acceptance criteria")
                       for line in content.splitlines()), \
            "1-description scaffolds no heading — its own optional Acceptance " \
            "criteria section is authored from scratch, never a placeholder middle state"
        assert "Given" not in content, \
            "1-description's optional Acceptance criteria section holds AC-n SHALL " \
            "statements only — testable given/when/then scenarios live in 3-solution"

    def test_file_templates_put_testable_criteria_in_solution(self, workspace_root):
        path = (workspace_root / "core" / "skills" / "aide-create"
                / "references" / "file-templates.md")
        if not path.exists():
            pytest.skip("file-templates.md not found")
        sections = {}
        for chunk in path.read_text().split("\n## "):
            header = chunk.splitlines()[0]
            sections[header] = chunk
        desc = next(v for k, v in sections.items() if k.startswith("1-description"))
        sol = next(v for k, v in sections.items() if k.startswith("3-solution"))
        assert "Given" not in desc, \
            "file-templates.md's 1-description.md section must not describe testable " \
            "given/when/then scenarios — only 3-solution.md does"
        assert "cceptance criteria" in sol, \
            "file-templates.md must put acceptance criteria in 3-solution"


@pytest.mark.validation
class TestScopeComplexityRiskLiveInSolution:
    """Scope, complexity and risk analysis belong to 3-solution.md.

    1-description is ONLY the problem as reported and 2-analysis is ONLY
    what the investigation found — an affected-files count, a complexity
    grade, an estimate and a risk assessment are all statements about the
    solution we intend to build, so they live in 3-solution.md.
    """

    @staticmethod
    def _rule(workspace_root):
        path = workspace_root / "core" / "rules" / "spec-structure.md"
        if not path.exists():
            pytest.skip("spec-structure.md not found")
        return path.read_text()

    @staticmethod
    def _template(workspace_root, name):
        path = workspace_root / "core" / "templates" / "todo" / name
        if not path.exists():
            pytest.skip(f"{name} not found")
        return path.read_text()

    @staticmethod
    def _file_templates(workspace_root):
        path = (workspace_root / "core" / "skills" / "aide-create"
                / "references" / "file-templates.md")
        if not path.exists():
            pytest.skip("file-templates.md not found")
        return path.read_text()

    @staticmethod
    def _section(content, prefix):
        """Slice the `## <prefix>...` section out of a headings-only doc."""
        headings = list(re.finditer(r"^## (.*)$", content, re.M))
        for index, heading in enumerate(headings):
            if heading.group(1).startswith(prefix):
                end = (headings[index + 1].start()
                       if index + 1 < len(headings) else len(content))
                return content[heading.start():end]
        raise AssertionError(f"no '## {prefix}' section found")

    # Criterion 1
    def test_rule_description_example_has_no_scope(self, workspace_root):
        block = structure_block(self._rule(workspace_root), "1-description")
        assert "## Scope" not in block, \
            "1-description is ONLY the problem — scope belongs to 3-solution"
        assert "- Scope" not in block, \
            "the 1-description table of contents must not list Scope"

    # Criterion 2
    def test_rule_analysis_example_has_no_scope_complexity_or_risk(self, workspace_root):
        block = structure_block(self._rule(workspace_root), "2-analysis")
        for heading in ("## Scope", "## Complexity", "## Risk analysis"):
            assert heading not in block, \
                f"2-analysis is findings only — '{heading}' belongs to 3-solution"

    # Criterion 3
    def test_rule_solution_example_has_scope_and_risk(self, workspace_root):
        block = structure_block(self._rule(workspace_root), "3-solution")
        for heading in ("## Scope", "## Risk analysis"):
            assert heading in block, \
                f"3-solution must own '{heading}'"

    def test_rule_separation_table_maps_to_solution(self, workspace_root):
        table = self._section(self._rule(workspace_root), "Separation of content")
        for row in ("Complexity analysis", "Risk analysis", "Scope"):
            line = next((l for l in table.splitlines() if l.startswith(f"| {row}")), None)
            assert line, f"the separation table must have a '{row}' row"
            assert "3-solution.md" in line, \
                f"'{row}' must be mapped to 3-solution.md, not: {line}"

    # Criterion 4
    def test_file_templates_description_has_no_scope(self, workspace_root):
        section = self._section(self._file_templates(workspace_root), "1-description.md")
        assert "Scope" not in section, \
            "file-templates.md must not put Scope in 1-description"

    # Criterion 5
    def test_file_templates_analysis_has_no_complexity_or_risk(self, workspace_root):
        section = self._section(self._file_templates(workspace_root), "2-analysis.md")
        for word in ("Complexity", "Risk analysis"):
            assert word not in section, \
                f"file-templates.md must not put {word} in 2-analysis"

    # Criterion 6
    def test_file_templates_solution_has_scope_and_risk(self, workspace_root):
        section = self._section(self._file_templates(workspace_root), "3-solution.md")
        for word in ("Scope", "Risk analysis"):
            assert word in section, \
                f"file-templates.md must put {word} in 3-solution"

    # Criterion 7
    def test_description_template_has_no_scope(self, workspace_root):
        content = self._template(workspace_root, "1-description.md.template")
        assert "## Scope" not in content

    def test_analysis_template_has_no_scope_complexity_or_risk(self, workspace_root):
        content = self._template(workspace_root, "2-analysis.md.template")
        for heading in ("## Scope", "## Complexity", "## Risk analysis"):
            assert heading not in content, f"2-analysis must not own '{heading}'"

    # Criterion 8
    def test_solution_template_has_scope_and_risk(self, workspace_root):
        content = self._template(workspace_root, "3-solution.md.template")
        for heading in ("## Scope", "## Risk analysis"):
            assert heading in content, f"3-solution must own '{heading}'"

    # Criterion 9
    def test_readme_templates_use_a_toc_heading(self, workspace_root):
        readme = self._template(workspace_root, "0-README.md.template")
        blurbs = structure_block(
            self._file_templates(workspace_root), "0-README.md", level="##"
        )
        for name, content in (("0-README.md.template", readme),
                              ("file-templates.md", blurbs)):
            assert "## Table of contents" in content, \
                f"{name} must use a '## Table of contents' heading"
            assert "**Table of contents:**" not in content, \
                f"{name} must not use a bold table-of-contents line"


@pytest.mark.validation
class TestRequirementsTracingIsDocumented:
    """Spec 279: an optional Requirements/REQ-n section in 1-description.md,
    threaded by /aide-analyze into 2-analysis.md findings, 3-solution.md
    acceptance criteria, and a Step 7 must-fix traceability check.

    Documentation-level only, per the spec's own scoping: no runtime code
    reads 1-description.md, so nothing here constructs or parses a live
    spec — only /aide-analyze's own in-session Step 7 can verify a real
    REQ chain (3-solution.md § Testing, Unit tests).
    """

    @staticmethod
    def _rule(workspace_root):
        path = workspace_root / "core" / "rules" / "spec-structure.md"
        if not path.exists():
            pytest.skip("spec-structure.md not found")
        return path.read_text()

    @staticmethod
    def _template(workspace_root, name):
        path = workspace_root / "core" / "templates" / "todo" / name
        if not path.exists():
            pytest.skip(f"{name} not found")
        return path.read_text()

    @staticmethod
    def _file_templates(workspace_root):
        path = (workspace_root / "core" / "skills" / "aide-create"
                / "references" / "file-templates.md")
        if not path.exists():
            pytest.skip("file-templates.md not found")
        return path.read_text()

    @staticmethod
    def _skill(workspace_root, name):
        path = workspace_root / "core" / "skills" / name / "SKILL.md"
        if not path.exists():
            pytest.skip(f"{name}/SKILL.md not found")
        return path.read_text()

    @staticmethod
    def _requirements_tracing(workspace_root):
        path = (workspace_root / "core" / "skills" / "aide-analyze"
                / "references" / "requirements-tracing.md")
        if not path.exists():
            pytest.skip("requirements-tracing.md not found")
        return path.read_text()

    @staticmethod
    def _plan_review(workspace_root):
        path = (workspace_root / "core" / "skills" / "aide-analyze"
                / "references" / "plan-review.md")
        if not path.exists():
            pytest.skip("plan-review.md not found")
        return path.read_text()

    @staticmethod
    def _step(content, prefix):
        headings = list(re.finditer(r"^### (.*)$", content, re.M))
        for index, heading in enumerate(headings):
            if heading.group(1).startswith(prefix):
                end = (headings[index + 1].start()
                       if index + 1 < len(headings) else len(content))
                return content[heading.start():end]
        raise AssertionError(f"no '### {prefix}' step found")

    @staticmethod
    def _section(content, prefix):
        headings = list(re.finditer(r"^## (.*)$", content, re.M))
        for index, heading in enumerate(headings):
            if heading.group(1).startswith(prefix):
                end = (headings[index + 1].start()
                       if index + 1 < len(headings) else len(content))
                return content[heading.start():end]
        raise AssertionError(f"no '## {prefix}' section found")

    # Criterion 1
    def test_rule_documents_the_ac_format(self, workspace_root):
        block = structure_block(self._rule(workspace_root), "1-description")
        assert "## Acceptance criteria" in block, \
            "1-description's structure example must show an Acceptance criteria section"
        assert "AC-" in block and "SHALL" in block, \
            "the Acceptance criteria example must use AC-n ids and SHALL statements"

    def test_rule_key_points_state_additive_ids_and_jira_never_adds(self, workspace_root):
        content = self._rule(workspace_root)
        start = content.index("\n### 1-description\n")
        end = content.index("\n### 2-analysis\n", start)
        key_points = content[content.index("**Key points:**", start):end]
        lowered = key_points.lower()
        assert "optional" in lowered, \
            "Key points must say Requirements is optional"
        assert "additive" in lowered, \
            "Key points must state the additive, never-renumbered id rule"
        assert "jira" in lowered and "never" in lowered, \
            "Key points must state JIRA mode never adds a Requirements section"

    # Criterion 2
    def test_rule_separation_table_has_acceptance_criteria_row_for_description(self, workspace_root):
        table = self._section(self._rule(workspace_root), "Separation of content")
        line = next(
            (l for l in table.splitlines()
             if l.startswith("| Acceptance criteria") and "1-description.md" in l),
            None,
        )
        assert line, \
            "the separation table must have an 'Acceptance criteria' row mapped to 1-description.md"

    # Criterion 3
    def test_description_template_adds_no_new_heading_or_placeholder(self, workspace_root):
        content = self._template(workspace_root, "1-description.md.template")
        assert not any(line.startswith("## Acceptance criteria")
                       for line in content.splitlines()), \
            "1-description template must not scaffold an Acceptance criteria heading — " \
            "the section is either written or absent, no placeholder middle state"

    # Criterion 4
    def test_solution_template_documents_the_ac_prefix(self, workspace_root):
        content = self._template(workspace_root, "3-solution.md.template")
        section = content.split("## Acceptance criteria", 1)[1]
        assert "AC-" in section, \
            "3-solution's Acceptance criteria intro/example must mention the AC-id prefix"

    # Criterion 5
    def test_create_step_4_asks_before_guessing_and_skips_jira(self, workspace_root):
        step = self._step(self._skill(workspace_root, "aide-create"), "Step 4:")
        lowered = step.lower()
        assert "ac-n" in lowered, \
            "aide-create Step 4 must instruct formulating AC-n statements"
        assert "ask" in lowered, \
            "aide-create Step 4 must ask for clarification when the description is too thin"
        assert "jira" in lowered and "skip" in lowered, \
            "aide-create Step 4 must state JIRA mode skips REQ-n formulation entirely"

    # Criterion 6
    def test_create_step_6_states_no_preview_and_review_responsibility(self, workspace_root):
        step = self._step(self._skill(workspace_root, "aide-create"), "Step 6:")
        lowered = step.lower()
        assert "never preview" in lowered or "not preview" in lowered, \
            "aide-create Step 6 must state the composed description is never previewed in chat"
        assert "responsibility" in lowered, \
            "aide-create Step 6 must state reviewing/editing before analyze is the user's responsibility"

    # Criterion 7
    def test_file_templates_documents_the_optional_acceptance_criteria_bullet(self, workspace_root):
        section = self._section(self._file_templates(workspace_root), "1-description.md")
        assert "AC-" in section and "Acceptance criteria" in section, \
            "file-templates.md's 1-description.md section must document the optional Acceptance criteria bullet"

    # Criterion 8
    def test_analyze_steps_point_at_the_reference_file_without_inline_mechanics(self, workspace_root):
        content = self._skill(workspace_root, "aide-analyze")
        for prefix in ("Step 1:", "Step 5: Update 2-analysis.md",
                       "Step 6: Create the implementation plan", "Step 7:"):
            step = self._step(content, prefix)
            assert "requirements-tracing.md" in step, \
                f"aide-analyze {prefix!r} must point at references/requirements-tracing.md"
        assert "REQ-n → file:line" not in content, \
            "aide-analyze/SKILL.md must not inline the finding-prefix mechanics — " \
            "they belong in requirements-tracing.md"

    # Criterion 9
    def test_requirements_tracing_file_documents_all_branch_points(self, workspace_root):
        content = self._requirements_tracing(workspace_root)
        for heading in ("Step 1", "Step 5", "Step 6", "Step 7"):
            assert heading in content, \
                f"requirements-tracing.md must document {heading}"
        assert "must-fix" in content.lower(), \
            "requirements-tracing.md's Step 7 must name the missing-id must-fix check"

    # Criterion 10
    def test_plan_review_coherence_item_checks_ac_coverage(self, workspace_root):
        content = self._plan_review(workspace_root)
        coherence = content.split("**Coherence**", 1)[1]
        # Isolate the Coherence bullet from the next numbered reviewer/section.
        coherence = re.split(r"\n\d\.\s|\n## ", coherence, maxsplit=1)[0]
        assert "AC" in coherence, \
            "plan-review.md's Coherence reviewer must ask about AC-id coverage"
        assert "must-fix" in coherence.lower(), \
            "a missing AC-id must be named a must-fix"

    # Spec 313
    def test_acceptance_criteria_row_sources_from_description_not_solution(self, workspace_root):
        for content, label in (
            (self._rule(workspace_root), "spec-structure.md"),
            (self._requirements_tracing(workspace_root), "requirements-tracing.md"),
        ):
            assert "verbatim from 1-description.md" in content, \
                f"{label} must state the Acceptance criteria row text comes " \
                "verbatim from 1-description.md"
            assert "verbatim from 3-solution.md" not in content, \
                f"{label} must not source the Acceptance criteria row text " \
                "from 3-solution.md — a person cannot judge a test scenario"

    # Spec 313
    def test_acceptance_criteria_is_one_row_per_ac_id_ascending(self, workspace_root):
        rule = self._rule(workspace_root)
        rule_section = rule[rule.index("#### Acceptance criteria (optional)"):]
        rule_section = rule_section[:rule_section.index("\n---", rule_section.index("archive-spec"))]

        tracing = self._requirements_tracing(workspace_root)
        tracing_section = tracing[tracing.index("## Step 8"):]

        for section, label in (
            (rule_section, "spec-structure.md"),
            (tracing_section, "requirements-tracing.md"),
        ):
            lowered = section.lower()
            assert "one row per" in lowered and "ac-n" in lowered, \
                f"{label}'s Acceptance criteria section must state one row per AC-n id"
            assert "ascending" in lowered, \
                f"{label}'s Acceptance criteria section must state ascending id order"

        skill = self._skill(workspace_root, "aide-analyze")
        assert "REQ-tagged criterion" not in skill, \
            "aide-analyze/SKILL.md's Step 8 pointer must no longer say " \
            "'REQ-tagged criterion' — it names one row per AC-n id instead"
        assert "AC-n id" in skill, \
            "aide-analyze/SKILL.md's Step 8 pointer must say 'AC-n id'"

    # Spec 386
    def test_requirements_tracing_documents_the_run_level_switch(self, workspace_root):
        section = self._requirements_tracing(workspace_root)[
            self._requirements_tracing(workspace_root).index("## Step 8"):
        ]
        assert "386" in section, \
            "requirements-tracing.md's Step 8 must cite spec 386 for the run-level switch branch"
        lowered = section.lower()
        assert "one plain sentence" in lowered, \
            "the switch branch must say the note is one plain sentence, never a table row"
        assert "never a table row" in lowered, \
            "the switch branch must explicitly rule out a table row"
        assert "1-description.md" in section and "req-6" in lowered, \
            "the switch branch must state requirements still land in 1-description.md (REQ-6)"
        assert "req-7" in lowered and "without the switch" in lowered, \
            "the switch branch must state a later run without the switch writes the ordinary table (REQ-7)"
