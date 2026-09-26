"""The wiki skill and the analyze skill call `aide-wiki` by the names the
script answers to; a renamed subcommand would leave both calling nothing.
Names only — never a sentence of the skills.
"""
import subprocess

SUBCOMMANDS = ("write", "schema", "index", "prune", "status", "verify")


def test_the_analyze_skill_reads_the_wiki_through_aide_wiki_status_AC_5(workspace_root):
    text = (workspace_root / "core" / "skills" / "aide-analyze" / "SKILL.md").read_text()
    assert "aide-wiki status" in text


def test_the_wiki_skill_names_every_subcommand_it_uses_AC_5(workspace_root):
    text = (workspace_root / "core" / "skills" / "aide-wiki" / "SKILL.md").read_text()
    for name in ("write", "schema", "index", "prune", "status"):
        assert f"aide-wiki {name}" in text, name


def test_every_subcommand_the_skills_call_exists_in_the_script_AC_5(workspace_root):
    script = workspace_root / "core" / "scripts" / "aide-wiki"
    help_text = subprocess.run([str(script), "--help"], capture_output=True, text=True).stdout
    for name in SUBCOMMANDS:
        assert f"aide-wiki {name}" in help_text
