"""What 4-status.md carries: the line each workflow step writes into
it, each phase's own outcome record, and the note about manual
testing.

Split out of test_templates.py 2026-09-04 (1048 lines); the tests are
unchanged and keep their names.
"""

import pytest
import re
from pathlib import Path

from .test_templates import structure_block


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
    the line from them, and the step-completing skills do not touch
    it at all — which is what this class pins, since a SKILL.md is an
    instruction to a model and there is nothing else a test can execute.
    """

    FIELD = "**Workflow steps completed:**"

    # The three skills that used to write the line, and the value each
    # one used to add. `aide-review-plan` was a fourth until spec 181
    # folded the review back into analyze.
    WRITERS = {
        "aide-analyze": "analyze",
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

    # Criterion 6: the grep. Not one of those skills writes the line.
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
        for step in ("create", "analyze", "implement", "archive"):
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


@pytest.mark.validation
class TestPhaseOutcomeRecord:
    """Spec 245: every phase writes its own outcome — `Repo`/`Model`/
    `Result`/`Time spent`/`Cost` — into the Tracking info of the file
    that is ITS OWN artifact, not centralized in 4-status.md the way
    spec 217's `Model (<step>):` lines were.

    `Workflow steps completed` (above) still answers "did it run", for
    the spec as a whole, in 4-status.md. This record answers "how did
    THIS phase go" — who ran it, what it cost, how long it took, and
    whether it finished — and each of the four phases owns its own copy,
    in its own file, derived from the same process/commit data
    `aide-run-spec` already trusts, never from a model's account of
    itself.
    """

    # The file each phase's own record lives in, and the date field on
    # that same file that gains a time of day.
    OWN_FILE = {
        "aide-create": ("1-description.md", "Created"),
        "aide-analyze": ("2-analysis.md", "Last analyzed"),
        "aide-implement": ("3-solution.md", "Last updated"),
        "aide-archive": ("4-status.md", "Last updated"),
    }
    WRITERS = {skill: skill.removeprefix("aide-") for skill in OWN_FILE}

    @staticmethod
    def _text(workspace_root, *parts):
        path = workspace_root.joinpath(*parts)
        if not path.exists():
            pytest.skip(f"{path.name} not found")
        return path.read_text()

    # The skill does not write the record itself. It names the field and
    # the file it lives in, so a model knows which lines not to touch —
    # exactly as it already does for `Workflow steps completed`.
    @pytest.mark.parametrize("skill", sorted(WRITERS))
    def test_the_skill_does_not_write_the_phase_outcome_itself(self, workspace_root, skill):
        content = self._text(workspace_root, "core", "skills", skill, "SKILL.md")
        lowered = content.lower()
        own_file, _ = self.OWN_FILE[skill]
        assert "model" in lowered, \
            f"{skill} must name the Model field, so a model knows which line not to touch"
        assert own_file.lower() in lowered, \
            f"{skill} must name {own_file}, the file its own phase outcome record lives in"
        assert "leave those lines" in lowered, \
            f"{skill} must say plainly that those lines are not its to write"

    # The interactive path keeps the signal by OFFERING the model suffix
    # on the commit it asks to make — unaffected by this spec, and still
    # true after the record moved files.
    @pytest.mark.parametrize("skill", sorted(WRITERS))
    def test_the_skill_offers_the_model_suffix_only_when_it_knows(self, workspace_root, skill):
        content = self._text(workspace_root, "core", "skills", skill, "SKILL.md")
        step = self.WRITERS[skill]
        assert f"Run /aide-{step} for " in content, \
            f"{skill} must name the commit subject that records the step"
        assert "(model:" in content, \
            f"{skill} must show the model suffix on the commit it offers"
        lowered = content.lower()
        assert "only when you can name your own model" in lowered, \
            f"{skill} must make the suffix conditional on actually knowing the model"
        assert "never guess" in lowered, \
            f"{skill} must say what to do when it cannot: leave it out, never guess"

    # A fresh spec has had no phase run against it, so no template
    # claims a phase outcome record for any of the four files.
    @pytest.mark.parametrize("name", [
        "1-description.md.template", "2-analysis.md.template",
        "3-solution.md.template", "4-status.md.template",
    ])
    def test_templates_claim_no_phase_outcome(self, workspace_root, name):
        content = self._template(workspace_root, name)
        for field in ("Repo", "Model", "Result", "Time spent", "Cost"):
            line = next(
                (ln for ln in content.splitlines() if f"**{field}:**" in ln), None
            )
            assert line is None, \
                f"{name} must not claim {field!r}: it is written by aide-run-spec " \
                f"once the phase has actually run, and the template said {line!r}"

    # The dormant, unenforced "Repositories used during analysis" HTML
    # comment is superseded by the script-derived Repo line and removed
    # outright — like every other field here, nothing is claimed until
    # aide-run-spec has something true to say.
    @pytest.mark.parametrize("name", [
        "2-analysis.md.template", "3-solution.md.template", "4-status.md.template",
    ])
    def test_templates_carry_no_dormant_repo_comment(self, workspace_root, name):
        content = self._template(workspace_root, name)
        assert "Repositories used during analysis" not in content, \
            f"{name} must not carry the dormant, unenforced Repo placeholder comment"

    # file-templates.md: each of the four files' section says where its
    # own phase outcome record lives and who writes it.
    @pytest.mark.parametrize("stem,own_file", [
        ("1-description", "1-description.md"), ("2-analysis", "2-analysis.md"),
        ("3-solution", "3-solution.md"), ("4-status", "4-status.md"),
    ])
    def test_file_templates_name_the_phase_outcome_and_its_writer(
        self, workspace_root, stem, own_file
    ):
        content = self._text(workspace_root, "core", "skills", "aide-create",
                             "references", "file-templates.md")
        section = next(chunk for chunk in content.split("\n## ")
                       if chunk.splitlines()[0].startswith(stem))
        lowered = section.lower()
        assert "aide-run-spec" in lowered, \
            f"file-templates.md's {own_file} section must name the runner as the writer"
        assert "model" in lowered, \
            f"file-templates.md's {own_file} section must name the Model field"

    # The rule — the contract every tool is given — defines the record,
    # names its writer, its per-file locations, and the update rule.
    def test_the_rule_defines_the_phase_outcome_record(self, workspace_root):
        section = TestWorkflowStepRecord._status_section(self._rule(workspace_root))
        lowered = section.lower()
        for field in ("repo", "model", "result", "time spent", "cost"):
            assert field in lowered, \
                f"spec-structure.md's 4-status section must define the {field!r} field"
        for own_file in ("1-description.md", "2-analysis.md", "3-solution.md"):
            assert own_file in section, \
                f"spec-structure.md must say {own_file} carries its own phase outcome record"
        assert "aide-run-spec" in lowered, \
            "the rule must name the runner as the writer, so nobody edits the fields by hand"
        assert "newest" in lowered or "overwrite" in lowered, \
            "the rule must give the update rule: the newest run's outcome is the one kept"

    def test_the_rule_says_an_absent_model_line_proves_nothing(self, workspace_root):
        """The description's hand-written creation scenario: a person
        writes `1-description.md` by hand and commits it under their own
        message. No commit can be attributed to `create`, so no line is
        written — and a reader must not read that silence as "create
        never ran", nor the runner invent "human" to fill it."""
        lowered = TestWorkflowStepRecord._status_section(self._rule(workspace_root)).lower()
        assert "does not prove" in lowered, \
            "the rule must say an absent Model line does not prove the phase never ran"

    def test_the_rule_notes_historical_specs_keep_the_old_field_name(self, workspace_root):
        """Risk analysis (3-solution.md): specs archived before this
        record existed still show the old, centralized `Model (<step>):`
        lines in 4-status.md — undisturbed, not migrated."""
        lowered = TestWorkflowStepRecord._status_section(self._rule(workspace_root)).lower()
        assert "model (<step>)" in lowered or "model (create)" in lowered, \
            "the rule must acknowledge the old per-step Model lines survive in old archives"

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
