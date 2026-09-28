"""The archive skill's own text: the wiki-rewrite step counts among its
steps, names the `aide-wiki` subcommands it calls, and skips plainly when
the project has no wiki. Names and step counts only — never a sentence
of the skill, per the testing rule's "No wording pins".
"""


def _skill_text(workspace_root):
    return (workspace_root / "core" / "skills" / "aide-archive" / "SKILL.md").read_text()


def test_the_skill_has_six_steps_AC_1(workspace_root):
    text = _skill_text(workspace_root)
    headings = [l for l in text.splitlines() if l.startswith("### Step ")]
    assert len(headings) == 6, headings
    for n, heading in enumerate(headings, start=1):
        assert heading.startswith(f"### Step {n} of 6:"), heading


def test_the_wiki_rewrite_step_calls_status_and_affected_AC_1(workspace_root):
    text = _skill_text(workspace_root)
    assert "aide-wiki status" in text
    assert "aide-wiki affected" in text
    assert "aide-wiki write" in text


def test_a_project_with_no_wiki_is_skipped_plainly_AC_5(workspace_root):
    text = _skill_text(workspace_root)
    assert "the project has no wiki" in text


def test_every_subcommand_the_skill_calls_exists_in_the_script_AC_1(workspace_root):
    import subprocess

    script = workspace_root / "core" / "scripts" / "aide-wiki"
    help_text = subprocess.run([str(script), "--help"], capture_output=True, text=True).stdout
    for name in ("status", "affected", "write"):
        assert f"aide-wiki {name}" in help_text
