"""Content checks for core/skills/aide-implement/SKILL.md's VERIFY step."""


def test_verify_step_names_the_old_heading_as_equivalent(workspace_root):
    """AC-4/AC-6 carve-out: an older spec's `## Phase 4: REFACTOR` table
    is the same one this step ticks, under its old heading — a model
    told only to look for the new heading would miss it."""
    text = (workspace_root / "core" / "skills" / "aide-implement" / "SKILL.md").read_text()
    phase_3 = text.split("### Step 4 of 4: VERIFY")[1].split("\n### ")[0]
    assert "## Phase 4: REFACTOR" in phase_3, phase_3
