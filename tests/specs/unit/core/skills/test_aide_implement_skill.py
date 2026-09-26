"""Content checks for core/skills/aide-implement/SKILL.md's Phase 3
(spec 329).

REQ-2 requires the full-suite step to call `aide-record-test-run`
instead of running the command directly and self-reporting the result
— the exact gap spec 325 showed can be skipped while still being ticked
done. REQ-3 requires `aide-run-spec` to carry no second, independent
copy of that mechanism; the skill is the only call site.
"""


def test_phase_3_calls_the_record_script(workspace_root):
    text = (workspace_root / "core" / "skills" / "aide-implement" / "SKILL.md").read_text()
    phase_3 = text.split("### Phase 3: REFACTOR")[1].split("\n### ")[0]
    assert "aide-record-test-run" in phase_3, phase_3
    assert "never run it directly and self-report the result" in phase_3, phase_3
