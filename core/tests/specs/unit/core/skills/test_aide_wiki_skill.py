"""The skills and the scheduled prompts call `aide-wiki` by the names the
script answers to; a renamed subcommand would leave them calling nothing."""
import json
import re
import subprocess

from ..scripts.conftest import init_repo

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


def test_archive_and_analyze_call_only_ordinary_wiki_commands_AC_1_AC_3_AC_4(workspace_root):
    for skill in ("aide-archive", "aide-analyze"):
        called = called_in(workspace_root / "core/skills" / skill / "SKILL.md")
        assert not called & {"decision", "decisions", "decision-scope"}, called


def test_the_analyze_and_wiki_skills_name_every_page_a_wiki_must_have_AC_1_AC_3_AC_4(workspace_root, tmp_path):
    project = init_repo(tmp_path / "proj")
    specs_root = tmp_path / "specs"
    (specs_root / "wiki").mkdir(parents=True)
    script = workspace_root / "core" / "scripts" / "aide-wiki"
    proc = subprocess.run(
        [str(script), "status", "--specs-root", str(specs_root), "--project-dir", str(project)],
        capture_output=True, text=True,
    )
    missing = json.loads(proc.stdout)["missing"]
    assert missing, proc.stdout
    for skill in ("aide-analyze", "aide-wiki"):
        text = (workspace_root / "core/skills" / skill / "SKILL.md").read_text()
        unnamed = [page for page in missing if page not in text]
        assert not unnamed, f"{skill} does not name {unnamed}, which every wiki must have"
