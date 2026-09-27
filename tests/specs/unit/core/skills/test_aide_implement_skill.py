"""Content checks for core/skills/aide-implement/SKILL.md's VERIFY
step (spec 329).

REQ-2 requires the full-suite step to call `aide-record-test-run`
instead of running the command directly and self-reporting the result
— the exact gap spec 325 showed can be skipped while still being ticked
done. REQ-3 requires `aide-run-spec` to carry no second, independent
copy of that mechanism; the skill is the only call site.
"""


def test_verify_step_calls_the_record_script(workspace_root):
    text = (workspace_root / "core" / "skills" / "aide-implement" / "SKILL.md").read_text()
    phase_3 = text.split("### Step 4 of 4: VERIFY")[1].split("\n### ")[0]
    assert "aide-record-test-run" in phase_3, phase_3
    assert "never run it directly and self-report the result" in phase_3, phase_3


def test_verify_step_names_the_old_heading_as_equivalent(workspace_root):
    """AC-4/AC-6 carve-out: an older spec's `## Phase 4: REFACTOR` table
    is the same one this step ticks, under its old heading — a model
    told only to look for the new heading would miss it."""
    text = (workspace_root / "core" / "skills" / "aide-implement" / "SKILL.md").read_text()
    phase_3 = text.split("### Step 4 of 4: VERIFY")[1].split("\n### ")[0]
    assert "## Phase 4: REFACTOR" in phase_3, phase_3
