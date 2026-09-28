"""The skills call `aide-wiki` by the names the script answers to; a
renamed subcommand would leave them calling nothing."""
import re
import subprocess


def test_every_aide_wiki_subcommand_a_skill_calls_exists_in_the_script(workspace_root):
    called = set()
    for path in (workspace_root / "core" / "skills").rglob("*.md"):
        called |= set(re.findall(r"aide-wiki ([a-z]+)", path.read_text()))
    assert {"status", "write"} <= called, called
    script = workspace_root / "core" / "scripts" / "aide-wiki"
    help_text = subprocess.run([str(script), "--help"], capture_output=True, text=True).stdout
    missing = sorted(name for name in called if f"aide-wiki {name}" not in help_text)
    assert not missing, f"skills call aide-wiki subcommands the script lacks: {missing}"
