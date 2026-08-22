"""Validation tests for template processing and placeholder replacement."""
import pytest
import re
from pathlib import Path


# Opening fence of a markdown example block, e.g. ```markdown or ````markdown.
_FENCE_OPEN = re.compile(r"^(`{3,})markdown[ \t]*$", re.M)


def structure_block(content: str, heading: str, level: str = "###") -> str:
    """Return the fenced markdown example under `<level> <heading>`.

    spec-structure.md (and the core/skills/spec-structure/SKILL.md
    generated from it) documents each spec file as a fenced example whose
    BODY contains `## ` headings.
    Splitting the whole document on `\\n## ` therefore collides on headings
    that several examples share — `## Scope` appears in both the
    1-description and the 2-analysis example. Isolate one example first,
    then look for headings inside it.
    """
    start = content.index(f"\n{level} {heading}\n")
    opening = _FENCE_OPEN.search(content, start)
    assert opening, f"no fenced example under '{level} {heading}'"
    fence = opening.group(1)
    body_start = opening.end() + 1
    closing = re.compile(rf"^{fence}[ \t]*$", re.M).search(content, body_start)
    assert closing, f"unterminated fenced example under '{level} {heading}'"
    return content[body_start:closing.start()]


@pytest.mark.validation
class TestPlaceholderReplacement:
    """Test that templates contain expected placeholders."""

    def test_todo_templates_contain_placeholders(self, workspace_root):
        """Test that TODO templates actually contain placeholders (sanity check)."""
        # Arrange
        templates_dir = workspace_root / "core" / "templates" / "todo"

        if not templates_dir.exists():
            pytest.skip("Templates directory not found - using mock workspace")

        # Act & Assert
        template_files = list(templates_dir.glob("*.template"))
        assert len(template_files) > 0, "Should have template files"

        placeholder_pattern = re.compile(r'\{\{[A-Z_]+\}\}')

        for template_path in template_files:
            # Skip README template - it doesn't have placeholders
            if template_path.name.startswith("0-README"):
                continue
            content = template_path.read_text()
            placeholders = placeholder_pattern.findall(content)
            assert len(placeholders) > 0, \
                f"{template_path.name} should contain placeholders, but found none"


@pytest.mark.validation
class TestSolutionOwnsTheCriteria:
    """3-solution.md owns acceptance criteria and the behavior delta.

    The strict separation says 1-description is ONLY the problem as
    reported — criteria for done-ness are part of the solution. And the
    solution must state what it changes in BEHAVIOR (adds/modifies/
    removes), not just which files it touches.
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

    def test_description_template_has_no_acceptance_criteria(self, workspace_root):
        content = self._template(workspace_root, "1-description.md.template")
        assert "cceptance criteria" not in content, \
            "1-description is ONLY the problem as reported — criteria live in 3-solution"

    def test_file_templates_put_criteria_in_solution(self, workspace_root):
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
        assert "cceptance criteria" not in desc, \
            "file-templates.md must not put acceptance criteria in 1-description"
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
class TestTaskWorkflowAssistantMatchesTheLayout:
    """The task-analyzer agent restates the 4-file layout — independently.

    It is a second source of truth for what each file contains, so it has
    to move Scope, Complexity and Risk analysis to solution.md too.
    """

    @staticmethod
    def _skill_sections(workspace_root):
        path = (workspace_root / "core" / "skills" / "task-workflow-assistant"
                / "SKILL.md")
        if not path.exists():
            pytest.skip("task-workflow-assistant/SKILL.md not found")
        content = path.read_text()
        sections = {}
        headings = list(re.finditer(r"^### (.*)$", content, re.M))
        for index, heading in enumerate(headings):
            end = (headings[index + 1].start()
                   if index + 1 < len(headings) else len(content))
            sections[heading.group(1)] = content[heading.start():end]
        return sections

    @staticmethod
    def _bullets(section):
        return [line for line in section.splitlines() if line.startswith("- ")]

    # Criterion 10 — checked against the list items, not the whole file:
    # the word "scope" also turns up in ordinary prose.
    def test_description_content_has_no_scope_bullet(self, workspace_root):
        bullets = self._bullets(self._skill_sections(workspace_root)["1. description.md"])
        assert not [b for b in bullets if "Scope" in b], \
            "description.md must not claim to hold Scope"

    def test_analysis_content_has_no_complexity_or_risk_bullet(self, workspace_root):
        bullets = self._bullets(self._skill_sections(workspace_root)["2. analysis.md"])
        for word in ("Complexity", "Risk analysis"):
            assert not [b for b in bullets if word in b], \
                f"analysis.md must not claim to hold {word}"

    def test_solution_content_has_scope_and_risk_bullets(self, workspace_root):
        bullets = self._bullets(self._skill_sections(workspace_root)["3. solution.md"])
        for word in ("Scope", "Risk analysis"):
            assert [b for b in bullets if word in b], \
                f"solution.md must claim to hold {word}"


@pytest.mark.validation
class TestAnalyzeSkillFillsTheRightFiles:
    """/aide-analyze is what actually writes 2-analysis.md and 3-solution.md.

    Its step-by-step instructions name the contents of each file directly,
    so a template fix that leaves them alone still produces specs with
    complexity and risk in the analysis.
    """

    @staticmethod
    def _step(workspace_root, prefix):
        # Named by number AND title. Inserting a step renumbers every one
        # after it (spec 187 inserted Step 4), and a bare number would
        # quietly start asserting against whichever step took the place.
        path = workspace_root / "core" / "skills" / "aide-analyze" / "SKILL.md"
        if not path.exists():
            pytest.skip("aide-analyze/SKILL.md not found")
        content = path.read_text()
        headings = list(re.finditer(r"^### (.*)$", content, re.M))
        for index, heading in enumerate(headings):
            if heading.group(1).startswith(prefix):
                end = (headings[index + 1].start()
                       if index + 1 < len(headings) else len(content))
                return content[heading.start():end]
        raise AssertionError(f"no '### {prefix}' step found")

    def test_analysis_step_asks_for_findings_only(self, workspace_root):
        step = self._step(workspace_root, "Step 5: Update 2-analysis.md")
        instruction = step.split("Include:", 1)[1].split("\n\n", 1)[0]
        for word in ("complexity", "risk analysis", "estimate"):
            assert word not in instruction.lower(), \
                f"/aide-analyze must not ask for {word} in 2-analysis.md"

    def test_solution_step_asks_for_scope_and_risk(self, workspace_root):
        step = self._step(workspace_root, "Step 6: Create the implementation plan")
        for marker in ("**Scope:**", "**Risk analysis:**"):
            assert marker in step, \
                f"/aide-analyze must ask for {marker} in 3-solution.md"


@pytest.mark.validation
class TestSkillsResumeWorkAlreadyBegun:
    """A step stopped by its clock commits what it wrote and the branch is
    landed (spec 187), so the NEXT run of that step opens files that are
    already part-written. Both writing skills have to look before they
    write, or the second run pays for the first run's work again.

    Static assertions only: whether a live model actually obeys the
    instruction is not something a test can execute — see the Manual
    testing note in the spec's 3-solution.md.
    """

    @staticmethod
    def _skill(workspace_root, name):
        path = workspace_root / "core" / "skills" / name / "SKILL.md"
        if not path.exists():
            pytest.skip(f"{name}/SKILL.md not found")
        return path.read_text()

    def test_analyze_checks_for_work_already_begun_before_writing(self, workspace_root):
        content = self._skill(workspace_root, "aide-analyze")
        headings = [m.group(1) for m in re.finditer(r"^### (Step \d+): (.*)$", content, re.M)]
        assert headings, "aide-analyze/SKILL.md has no numbered workflow steps"
        check = [h for h, title in
                 [(m.group(1), m.group(2)) for m in re.finditer(r"^### (Step \d+): (.*)$", content, re.M)]
                 if "already begun" in title.lower()]
        assert check, \
            "/aide-analyze must have a step that checks for work already begun"
        # Before the file-writing steps: checking afterwards is checking
        # what this run just wrote.
        order = headings.index(check[0])
        for writes in ("2-analysis.md", "3-solution.md", "4-status.md"):
            writing = [h for h, title in
                       [(m.group(1), m.group(2)) for m in re.finditer(r"^### (Step \d+): (.*)$", content, re.M)]
                       if writes in title]
            assert writing, f"/aide-analyze must still have a step that writes {writes}"
            assert order < headings.index(writing[0]), \
                f"the already-begun check must come before the step writing {writes}"

    def test_analyze_names_the_placeholder_rule_not_the_headings(self, workspace_root):
        content = self._skill(workspace_root, "aide-analyze")
        step = content.split("### Step 4: Check for work already begun", 1)[1].split("\n### ", 1)[0]
        # The literal placeholder text is the signal, named outright.
        assert "[not analyzed yet]" in step and "[not started]" in step, \
            "the check must name the template's own placeholder text"
        # And heading-counting is ruled out: a half-written section has
        # its heading exactly as a finished one does.
        assert "heading" in step.lower(), \
            "the check must say that counting headings is not enough"

    def test_implement_reads_the_phase_table_before_starting_red(self, workspace_root):
        content = self._skill(workspace_root, "aide-implement")
        prep = content.split("### Preparation", 1)[1].split("\n### ", 1)[0]
        assert "4-status.md" in prep, \
            "/aide-implement's Preparation must read 4-status.md"
        assert "phase" in prep.lower(), \
            "/aide-implement's Preparation must name the phase table it reads"
        for symbol in ("✅", "⬜"):
            assert symbol in prep, \
                f"/aide-implement's Preparation must name the {symbol} status the table uses"
@pytest.mark.validation
class TestE2eSuiteExpectsTheNewAnalysisLayout:
    """The e2e suites assert which sections a real 2-analysis.md must have.

    They run the actual slash commands, so they fail for real once the
    templates stop producing `## Scope` and `## Complexity` there. Reading
    their source needs no CLI, so this check is not skip-gated the way the
    e2e tests themselves are.
    """

    @pytest.mark.parametrize("tool", ["claude", "codex", "copilot"])
    def test_required_sections_dropped_scope_and_complexity(self, workspace_root, tool):
        path = workspace_root / "tests" / "specs" / "e2e" / f"test_{tool}_e2e.py"
        if not path.exists():
            pytest.skip(f"test_{tool}_e2e.py not found")
        content = path.read_text()
        listing = content.split("REQUIRED_SECTIONS_2_ANALYSE = [", 1)[1].split("]", 1)[0]
        for section in ('"## Scope"', '"## Complexity"'):
            assert section not in listing, \
                f"test_{tool}_e2e.py still requires {section} in 2-analysis.md"
        assert '"## Findings"' in listing, \
            f"test_{tool}_e2e.py must still require findings in 2-analysis.md"


@pytest.mark.validation
class TestRequiredPlaceholders:
    """Test that all expected placeholders exist in templates."""

    def test_todo_templates_have_required_placeholders(self, workspace_root):
        """Test TODO templates contain all required placeholders."""
        # Arrange
        templates_dir = workspace_root / "core" / "templates" / "todo"

        if not templates_dir.exists():
            pytest.skip("Templates directory not found")

        required_placeholders = {
            "{{TITLE_FORMATTED}}",  # TODO templates use TITLE_FORMATTED instead of TITLE
            "{{DESCRIPTION}}",
            "{{FOLDER_NAME}}"
        }

        # Act & Assert - Check description template has required fields
        description_template = templates_dir / "1-description.md.template"
        if description_template.exists():
            content = description_template.read_text()
            for placeholder in required_placeholders:
                assert placeholder in content, \
                    f"1-description.md.template should contain {placeholder}"


@pytest.mark.validation
class TestManualTestingIsANote:
    """Manual testing is a note about what no test covers — not a task.

    A checkbox row a headless run can never tick holds a finished spec
    open forever: /aide-archive sees the open mark and refuses. The
    section survives (the limitation is still worth recording), but it
    states a fact instead of scaffolding steps to execute.
    """

    @staticmethod
    def _template(workspace_root, name):
        path = workspace_root / "core" / "templates" / "todo" / name
        if not path.exists():
            pytest.skip(f"{name} not found")
        return path.read_text()

    @staticmethod
    def _rule(workspace_root):
        path = workspace_root / "core" / "rules" / "spec-structure.md"
        if not path.exists():
            pytest.skip("spec-structure.md not found")
        return path.read_text()

    @staticmethod
    def _manual_section(content):
        """The `### Manual testing` body, up to the next heading or rule."""
        assert "### Manual testing" in content, \
            "the Manual testing section must stay — the note replaces the checklist"
        rest = content.split("### Manual testing", 1)[1]
        return re.split(r"^(?:#{1,3} |---\s*$)", rest, maxsplit=1, flags=re.M)[0]

    # Criterion 1
    def test_status_template_has_no_manual_testing_row(self, workspace_root):
        content = self._template(workspace_root, "4-status.md.template")
        assert "Manual testing" not in content, \
            "4-status.md must not scaffold a checkbox no headless run can tick"

    # Criterion 2 (and 7)
    def test_solution_template_manual_testing_is_a_note(self, workspace_root):
        section = self._manual_section(
            self._template(workspace_root, "3-solution.md.template"))
        for marker in ("Steps:", "Test case", "Expected result"):
            assert marker not in section, \
                f"Manual testing must read as a note, not a checklist ({marker} found)"
        assert "not covered" in section.lower(), \
            "the note must name what is NOT covered by a test, and why"

    # Criterion 3 (and 7)
    def test_rule_solution_example_frames_manual_testing_as_a_note(self, workspace_root):
        block = structure_block(self._rule(workspace_root), "3-solution")
        section = self._manual_section(block)
        assert "must be tested manually" not in section.lower(), \
            "the golden example must not ask for a manual test plan"
        assert "not covered" in section.lower(), \
            "the golden example must use the same 'not covered by a test' framing"

    def test_rule_key_points_say_the_note_blocks_nothing(self, workspace_root):
        content = self._rule(workspace_root)
        start = content.index("\n### 3-solution\n")
        end = content.index("\n### 4-status\n", start)
        key_points = content[content.index("**Key points:**", start):end]
        assert "Manual testing" in key_points, \
            "3-solution's Key points must state what the Manual testing section is"
        assert "note" in key_points.lower() and "not a checklist" in key_points.lower(), \
            "Key points must say plainly that Manual testing is a note, not a checklist"

    # Criterion 4
    def test_file_templates_describe_manual_testing_as_a_note(self, workspace_root):
        path = (workspace_root / "core" / "skills" / "aide-create"
                / "references" / "file-templates.md")
        if not path.exists():
            pytest.skip("file-templates.md not found")
        solution = next(
            chunk for chunk in path.read_text().split("\n## ")
            if chunk.splitlines()[0].startswith("3-solution"))
        testing = next(
            line for line in solution.splitlines()
            if line.startswith("- **Testing:**"))
        assert "note" in testing.lower(), \
            "file-templates.md must describe manual testing as a note"
        assert "not a checklist" in testing.lower(), \
            "file-templates.md must say the note is not a checklist item"

    # Criterion 5
    def test_implement_skill_step_is_optional_not_a_test_plan(self, workspace_root):
        path = (workspace_root / "core" / "skills" / "aide-implement" / "SKILL.md")
        if not path.exists():
            pytest.skip("aide-implement/SKILL.md not found")
        after = path.read_text().split("\n## After implementation", 1)[1]
        assert "test plan" not in after.lower(), \
            "the After-implementation step must not call the note a 'test plan' to follow"
        assert "optional" in after.lower(), \
            "the After-implementation step must say plainly that it is optional"


@pytest.mark.validation
class TestWorkflowStepRecord:
    """Spec 154: the RUNNER owns the line that says how far a spec has got.

    Spec 139 put the record on one line of `4-status.md` and had each
    step write its own value. Two incidents on 2026-08-21 showed what
    that costs: 147's implement was killed by its own time limit before
    the model reached the instruction, so the line lagged behind a
    finished branch; 153's files were copied from a sibling, so a
    brand-new spec claimed three steps it had never had.

    The commits are the record now. `core/scripts/aide-run-spec` writes
    the line from them, and the four step-completing skills do not touch
    it at all — which is what this class pins, since a SKILL.md is an
    instruction to a model and there is nothing else a test can execute.
    """

    FIELD = "**Workflow steps completed:**"

    # The four skills that used to write the line, and the value each
    # one used to add.
    WRITERS = {
        "aide-analyze": "analyze",
        "aide-review-plan": "review-plan",
        "aide-implement": "implement",
        "aide-archive": "archive",
    }

    # The instruction spec 139 gave and spec 154 takes away, in the
    # wordings all four skills used. Any of them surviving means a model
    # is still being told to write a line it no longer owns.
    BANNED = (
        "record the step on the line",
        "keep the values already there",
    )

    @staticmethod
    def _text(workspace_root, *parts):
        path = workspace_root.joinpath(*parts)
        if not path.exists():
            pytest.skip(f"{path.name} not found")
        return path.read_text()

    # Criterion 6: the grep. Not one skill of the four writes the line.
    @pytest.mark.parametrize("skill", sorted(WRITERS))
    def test_the_skill_does_not_write_the_line_itself(self, workspace_root, skill):
        lowered = self._text(workspace_root, "core", "skills", skill, "SKILL.md").lower()
        for phrase in self.BANNED:
            assert phrase not in lowered, \
                f"{skill} still tells the model to write the record: {phrase!r}"
        # Naming the line is fine — saying to LEAVE it is the point.
        assert "workflow steps completed" in lowered, \
            f"{skill} must name the line, so a model knows which one not to touch"
        assert "leave that line" in lowered, \
            f"{skill} must say plainly that the line is not its to write"

    # ...and the interactive path keeps the signal rather than losing
    # it: the skill OFFERS the commit whose subject the reader
    # recognises, and asks first.
    @pytest.mark.parametrize("skill", sorted(WRITERS))
    def test_the_skill_offers_the_commit_that_records_the_step(self, workspace_root, skill):
        content = self._text(workspace_root, "core", "skills", skill, "SKILL.md")
        subject = f"Run /aide-{skill.removeprefix('aide-')} for "
        assert subject in content, \
            f"{skill} must name the commit subject that records the step: {subject!r}"
        lowered = content.lower()
        assert "ask" in lowered.split(subject.lower(), 1)[0][-600:], \
            f"{skill} must ASK before committing — this repo never commits unasked"

    # Criterion 1, reversed: a new spec starts with nothing claimed,
    # because nothing has run. The `create` step's own commit is what
    # puts `create` on the line, exactly like every other step.
    def test_status_template_claims_no_steps(self, workspace_root):
        content = self._template(workspace_root, "4-status.md.template")
        line = next((ln for ln in content.splitlines() if self.FIELD in ln), None)
        assert line is None, \
            "4-status.md.template must not claim a step: the line is written by " \
            f"the runner from the commits, and the template said {line!r}"

    def test_file_templates_say_the_line_is_not_the_models(self, workspace_root):
        content = self._text(workspace_root, "core", "skills", "aide-create",
                             "references", "file-templates.md")
        status = next(chunk for chunk in content.split("\n## ")
                      if chunk.splitlines()[0].startswith("4-status"))
        lowered = status.lower()
        assert "workflow steps completed" not in lowered, \
            "file-templates.md must stop telling /aide-create to write the line"

    @staticmethod
    def _status_section(rule):
        """The `### 4-status` section, fenced examples and all.

        Not `split("\n## ")`: those examples CONTAIN `## ` headings —
        `## Table of contents`, `## Phase 1` — so a plain split ends the
        section inside the first code block.
        """
        lines = rule.splitlines()
        start = next(i for i, ln in enumerate(lines) if ln.startswith("### 4-status"))
        fenced = False
        for i in range(start + 1, len(lines)):
            if lines[i].startswith("```"):
                fenced = not fenced
            elif not fenced and lines[i].startswith("## "):
                return "\n".join(lines[start:i])
        return "\n".join(lines[start:])

    # The contract itself, in the one rule every tool is given.
    def test_the_rule_defines_the_line_and_its_values(self, workspace_root):
        rule = self._rule(workspace_root)
        assert "Workflow steps completed" in rule, \
            "spec-structure.md must define the workflow-steps line"
        section = self._status_section(rule)
        for step in ("create", "analyze", "review-plan", "implement", "archive"):
            assert step in section, \
                f"spec-structure.md's 4-status section must name '{step}' as an allowed value"

    def test_the_rule_says_the_runner_writes_the_line(self, workspace_root):
        lowered = self._status_section(self._rule(workspace_root)).lower()
        assert "aide-run-spec" in lowered, \
            "the rule must name the runner as the writer, so nobody edits the line by hand"
        assert "commit" in lowered, \
            "the rule must say the record is the commits, not the file"
        assert "do not edit" in lowered or "never edit" in lowered, \
            "the rule must say plainly that the line is not written by hand"
        assert "dashboard" in lowered, \
            "the rule must say who reads the line, so nobody edits it as decoration"

    @staticmethod
    def _template(workspace_root, name):
        path = workspace_root / "core" / "templates" / "todo" / name
        if not path.exists():
            pytest.skip(f"{name} not found")
        return path.read_text()

    @staticmethod
    def _rule(workspace_root):
        path = workspace_root / "core" / "rules" / "spec-structure.md"
        if not path.exists():
            pytest.skip("spec-structure.md not found")
        return path.read_text()
