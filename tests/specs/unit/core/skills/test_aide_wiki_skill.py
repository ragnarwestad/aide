"""The skills and the scheduled prompts call `aide-wiki` by the names the
script answers to; a renamed subcommand would leave them calling nothing."""
import re
import subprocess

# A call names its subcommand and then a flag; prose that mentions the script does not.
CALL = re.compile(r"aide-wiki ([a-z][a-z-]*) --")


def called_in(path):
    return set(CALL.findall(path.read_text()))


def test_every_aide_wiki_subcommand_a_skill_or_prompt_calls_exists_in_the_script(workspace_root):
    called = set()
    for folder in ("core/skills", "docs/prompts"):
        for path in (workspace_root / folder).rglob("*.md"):
            called |= called_in(path)
    assert {"status", "write"} <= called, called
    script = workspace_root / "core" / "scripts" / "aide-wiki"
    help_text = subprocess.run([str(script), "--help"], capture_output=True, text=True).stdout
    missing = sorted(name for name in called if not re.search(rf"aide-wiki {re.escape(name)}\s", help_text))
    assert not missing, f"skills and prompts call aide-wiki subcommands the script lacks: {missing}"


def test_the_archive_skill_records_decisions_through_the_script_AC_1(workspace_root):
    called = called_in(workspace_root / "core" / "skills" / "aide-archive" / "SKILL.md")
    assert {"decisions", "decision"} <= called, called


def test_the_analyze_skill_finds_the_decisions_linked_from_the_pages_it_reads_AC_5(workspace_root):
    text = (workspace_root / "core" / "skills" / "aide-analyze" / "SKILL.md").read_text()
    assert re.search(r"aide-wiki decisions[^`]*--from", text)
