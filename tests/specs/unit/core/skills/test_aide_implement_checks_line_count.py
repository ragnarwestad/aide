"""Content check for core/skills/aide-implement/SKILL.md's Phase 2
(spec 443, AC-4).

Phase 2's implementation step is the one place a run writes to a source
file, so it is where a line-count check before writing has to sit — a
run that never checks a file's size before appending to it is the exact
gap the dashboard's own code-health rule (dashboard/CLAUDE.md) exists to
close.
"""


def test_phase_2_checks_line_count_before_writing(workspace_root):
    text = (workspace_root / "core" / "skills" / "aide-implement" / "SKILL.md").read_text()
    phase_2 = text.split("### Phase 2: GREEN")[1].split("\n### ")[0]
    assert "check its current line count" in phase_2, phase_2
