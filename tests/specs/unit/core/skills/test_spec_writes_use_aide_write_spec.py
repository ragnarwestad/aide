"""Guards the three skills that write spec-file content (spec 282):
/aide-analyze, /aide-implement and /aide-archive must never instruct a
direct Write/Edit of a spec file — `aide-write-spec` is the only
legitimate path, closing the gap spec 248 left open for /aide-create's
own file creation.

Every assertion here is POSITIVE (the instruction actually names
`aide-write-spec`), not just the absence of the old wording — a guard
that only checks old text is gone gives false confidence against a
differently worded regression that reintroduces a direct write.
"""
import pytest


def _section(text, heading):
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith(heading))
    end = next(
        (i for i in range(start + 1, len(lines))
         if lines[i].startswith("### ") or lines[i].startswith("## ")),
        len(lines),
    )
    return "\n".join(lines[start:end])


@pytest.fixture
def aide_analyze_skill(workspace_root):
    return (workspace_root / "core" / "skills" / "aide-analyze" / "SKILL.md").read_text()


@pytest.fixture
def plan_review(workspace_root):
    return (
        workspace_root / "core" / "skills" / "aide-analyze" / "references" / "plan-review.md"
    ).read_text()


@pytest.fixture
def aide_implement_skill(workspace_root):
    return (workspace_root / "core" / "skills" / "aide-implement" / "SKILL.md").read_text()


@pytest.fixture
def tdd_phases(workspace_root):
    return (
        workspace_root / "core" / "skills" / "aide-implement" / "references" / "tdd-phases.md"
    ).read_text()


@pytest.fixture
def aide_archive_skill(workspace_root):
    return (workspace_root / "core" / "skills" / "aide-archive" / "SKILL.md").read_text()


class TestAideAnalyzeWritesViaScript:
    def test_step_5_writes_analysis_via_aide_write_spec(self, aide_analyze_skill):
        step = _section(aide_analyze_skill, "### Step 5:")
        assert "aide-write-spec" in step
        assert "2-analysis.md" in step

    def test_step_6_writes_solution_via_aide_write_spec(self, aide_analyze_skill):
        step = _section(aide_analyze_skill, "### Step 6:")
        assert "aide-write-spec" in step
        assert "3-solution.md" in step

    def test_step_8_writes_status_via_aide_write_spec(self, aide_analyze_skill):
        step = _section(aide_analyze_skill, "### Step 8:")
        assert "aide-write-spec" in step
        assert "4-status.md" in step

    def test_no_direct_write_to_specs_instruction_remains(self, aide_analyze_skill):
        assert "Write to `specs/" not in aide_analyze_skill

    def test_plan_review_writes_via_aide_write_spec(self, plan_review):
        assert "aide-write-spec" in plan_review
        assert "3-solution.md" in plan_review
        assert "4-status.md" in plan_review


class TestAideImplementWritesViaScript:
    def test_red_phase_ticks_via_aide_write_spec(self, aide_implement_skill):
        phase = _section(aide_implement_skill, "### Phase 1: RED")
        assert "aide-write-spec" in phase
        assert "4-status.md" in phase

    def test_green_phase_ticks_via_aide_write_spec(self, aide_implement_skill):
        phase = _section(aide_implement_skill, "### Phase 2: GREEN")
        assert "aide-write-spec" in phase
        assert "4-status.md" in phase

    def test_refactor_phase_ticks_via_aide_write_spec(self, aide_implement_skill):
        phase = _section(aide_implement_skill, "### Phase 3: REFACTOR")
        assert "aide-write-spec" in phase
        assert "4-status.md" in phase

    def test_tdd_phases_reference_updates_via_aide_write_spec(self, tdd_phases):
        assert "aide-write-spec" in tdd_phases
        assert "4-status.md" in tdd_phases


class TestAideArchiveWritesViaScript:
    def test_headless_step_2_writes_via_aide_write_spec(self, aide_archive_skill):
        step = _section(aide_archive_skill, "### Step 2:")
        assert "aide-write-spec" in step
        assert "4-status.md" in step

    def test_no_direct_append_instruction_remains(self, aide_archive_skill):
        assert "Append the\n  proposal to `4-status.md`" not in aide_archive_skill
