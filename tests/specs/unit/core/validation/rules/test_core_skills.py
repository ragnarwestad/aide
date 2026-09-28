"""Structure validation of all SKILL.md files in core/skills/.

core/skills/ is the source that install.sh copies to ~/.claude/skills/.
test_skill_structure.py only covers the repo's own .claude/skills/, so this
test covers the distributable skills — including that the effort field,
when set, has a valid value.
"""
import re
import subprocess
from pathlib import Path

import pytest

# tests/specs/unit/core/validation/test_core_skills.py -> aide/
CORE_SKILLS_DIR = Path(__file__).parents[6] / "core" / "skills"

VALID_EFFORT_LEVELS = {"low", "medium", "high", "xhigh"}


def get_skill_dirs() -> list[Path]:
    if not CORE_SKILLS_DIR.exists():
        return []
    return [
        d for d in CORE_SKILLS_DIR.iterdir()
        if d.is_dir() and (d / "SKILL.md").exists()
    ]


def parse_frontmatter(content: str) -> dict:
    """Extract flat YAML frontmatter fields from a SKILL.md file."""
    match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return {}
    fields = {}
    for line in match.group(1).splitlines():
        # Only column-0 keys are frontmatter fields — indented lines are
        # continuations of folded values (e.g. the description block).
        if re.match(r"^[A-Za-z][A-Za-z0-9_-]*:", line):
            key, _, value = line.partition(":")
            fields[key.strip()] = value.strip()
    return fields


# The frontmatter contract: the Agent Skills spec's fields plus the Claude
# Code extras aide accepts because they degrade additively. The loaders
# read `name` (it must match the directory) and `description`; `effort`
# is set deliberately per skill.
SPEC_FRONTMATTER_FIELDS = {
    "name", "description", "license", "compatibility", "metadata",
    "allowed-tools",
}
ACCEPTED_CLAUDE_CODE_EXTRAS = {"effort", "argument-hint"}
ALLOWED_FRONTMATTER_FIELDS = SPEC_FRONTMATTER_FIELDS | ACCEPTED_CLAUDE_CODE_EXTRAS


@pytest.mark.validation
def test_every_core_skill_has_the_frontmatter_the_loaders_read():
    skills = get_skill_dirs()
    assert skills, "No skill directories with SKILL.md in core/skills/"
    problems = []
    for skill_dir in skills:
        content = (skill_dir / "SKILL.md").read_text()
        fields = parse_frontmatter(content)
        name = skill_dir.name
        if not content.startswith("---"):
            problems.append(f"{name}: no frontmatter")
            continue
        if fields.get("name") != name:
            problems.append(f"{name}: name {fields.get('name')!r} does not match the directory")
        if "description" not in fields:
            problems.append(f"{name}: no description")
        if fields.get("effort") not in VALID_EFFORT_LEVELS:
            problems.append(f"{name}: effort {fields.get('effort')!r} not in {sorted(VALID_EFFORT_LEVELS)}")
        rogue = set(fields) - ALLOWED_FRONTMATTER_FIELDS
        if rogue:
            problems.append(f"{name}: fields outside the allowlist: {sorted(rogue)}")
    assert not problems, "\n".join(problems)


@pytest.mark.validation
class TestUninstallListsEverySkill:
    """install.sh and uninstall.sh must mirror each other.

    Every skill in core/skills/ is installed to ~/.claude/skills/ — so every
    one of them must be in uninstall.sh's SKILLS list, or uninstalling
    leaves it behind silently. The one exception is spec-structure, which
    install.sh excludes by name (see the comment on the filter below).
    """

    def test_every_core_skill_is_in_the_uninstall_list(self):
        uninstall = (
            CORE_SKILLS_DIR.parents[1]
            / "implementations" / "claude-code" / "uninstall.sh"
        )
        content = uninstall.read_text()
        missing = [
            d.name for d in get_skill_dirs()
            if f'"{d.name}"' not in content
            # spec-structure is the one exception, and it is excluded by
            # name in implementations/claude-code/install.sh too: Claude
            # Code already has that content as a path-scoped rule
            # (core/rules/spec-structure.md), so the generated skill is
            # for Codex/Copilot's ~/.agents/skills/ only. Never installed
            # to ~/.claude/skills/, so never uninstalled from it.
            and d.name != "spec-structure"
        ]
        assert not missing, (
            f"Skills missing from uninstall.sh's SKILLS list: {missing}"
        )



@pytest.mark.validation
class TestUninstallReadsTheManifest:
    """Spec 142: the static SKILLS list is a snapshot of what is shipped
    TODAY, and a name is taken out of it by the very commit that stops
    shipping the skill — which is the moment removal starts to matter.
    That is what happened on 2026-08-20: four skills left core/skills/
    and their installed copies could no longer be removed by the
    uninstaller at all.

    The manifest each install writes on the target machine is the record
    the list cannot be. uninstall.sh reads it IN ADDITION to the static
    list, so a machine with an orphaned copy is cleaned up without
    waiting for another install first.
    """

    @staticmethod
    def uninstall(workspace_root, home):
        return subprocess.run(
            [str(workspace_root / "implementations" / "claude-code" / "uninstall.sh")],
            input="y\n",
            capture_output=True,
            text=True,
            env={"HOME": str(home), "PATH": "/usr/bin:/bin"},
        )

    def test_a_retired_skill_named_only_by_the_manifest_is_removed(self, workspace_root, tmp_path):
        """Criterion 9: 'aide-to-html' is in no SKILLS array anymore."""
        home = tmp_path / "home"
        skills = home / ".claude" / "skills"
        (skills / "aide-to-html").mkdir(parents=True)
        (skills / "aide-to-html" / "SKILL.md").write_text("# retired\n")
        (skills / ".aide-installed-manifest").write_text("aide-to-html\n")

        result = self.uninstall(workspace_root, home)

        assert result.returncode == 0, result.stderr
        assert not (skills / "aide-to-html").exists()
        assert not (skills / ".aide-installed-manifest").exists()

    def test_a_skill_no_manifest_names_is_left_alone(self, workspace_root, tmp_path):
        """~/.claude/skills/ is allowed to hold skills aide never put
        there — the same guarantee install.sh's rsync gives by refusing
        --delete."""
        home = tmp_path / "home"
        skills = home / ".claude" / "skills"
        (skills / "dataviz").mkdir(parents=True)
        (skills / ".aide-installed-manifest").write_text("aide-create\n")

        result = self.uninstall(workspace_root, home)

        assert result.returncode == 0, result.stderr
        assert (skills / "dataviz").exists()

    def test_a_machine_with_no_manifest_uninstalls_exactly_as_before(self, workspace_root, tmp_path):
        """The manifest is new; a machine that installed before it
        existed has none, and the static list is all there is."""
        home = tmp_path / "home"
        skills = home / ".claude" / "skills"
        (skills / "aide-create").mkdir(parents=True)

        result = self.uninstall(workspace_root, home)

        assert result.returncode == 0, result.stderr
        assert not (skills / "aide-create").exists()

    def test_the_installer_and_the_uninstaller_name_the_same_file(self, workspace_root):
        """The name is written down twice — once as
        AIDE_SKILL_MANIFEST_NAME in the shared installer, once as a
        literal in uninstall.sh, which sources nothing. Two spellings
        would mean an install that writes a file no uninstall ever
        reads, which is the failure this whole mechanism exists to
        prevent, one level up.

        The same shape .claude/rules/development.md pins for
        WORKFLOW_STEPS and DEPENDENCY_GATED_STEPS: edited by hand
        together, held together by a test that reads both sides.
        """
        core = workspace_root / "core" / "scripts" / "_install-skills.sh"
        written = re.search(
            r'^AIDE_SKILL_MANIFEST_NAME="([^"]+)"', core.read_text(), re.MULTILINE
        )
        assert written, "_install-skills.sh must define AIDE_SKILL_MANIFEST_NAME"

        uninstall = (
            workspace_root / "implementations" / "claude-code" / "uninstall.sh"
        ).read_text()
        read = re.search(r'^MANIFEST="\$HOME/\.claude/skills/([^"]+)"', uninstall, re.MULTILINE)
        assert read, "uninstall.sh must read the manifest out of ~/.claude/skills/"
        assert read.group(1) == written.group(1), (
            f"uninstall.sh reads {read.group(1)!r} but the installers write "
            f"{written.group(1)!r}"
        )


@pytest.mark.validation
class TestManifestTemplate:
    """The example manifest ships with the skill and carries every
    documented top key (spec 78). String-based on purpose: no YAML
    parser in the test env — real parsing is spec 79's decision."""

    TEMPLATE = CORE_SKILLS_DIR / "aide-manifest" / "references" / "project.yaml"
    TOP_KEYS = [
        "name", "description", "generated", "stack", "dependencies",
        "deployment", "logging", "statistics", "reports", "docs",
        "worktreeLinks",
    ]

    def test_template_has_every_documented_top_key(self):
        assert self.TEMPLATE.exists(), f"missing: {self.TEMPLATE}"
        lines = self.TEMPLATE.read_text(encoding="utf-8").splitlines()
        missing = [
            k for k in self.TOP_KEYS
            if not any(line.startswith(f"{k}:") for line in lines)
        ]
        assert not missing, f"template lacks top keys: {missing}"


@pytest.mark.validation
class TestInstallRetiresTheRulesThatBecameSkills:
    """Spec 147: four rules became skills, and the rules side has no
    pruning mechanism of its own.

    install.sh's rule loop only ever COPIES the files still on its list —
    it never diffs against what a previous install left behind. Without an
    explicit removal step, a machine that installed before this change
    keeps loading ~/.claude/rules/workflows.md forever, so the four rules
    stay resident in every prompt AND ship again as skills: the resident
    footprint goes up, not down. prune_retired_skills (spec 142) is the
    equivalent on the skills side; this is the rules side.
    """

    RETIRED = ["workflows.md", "documentation.md", "tools-and-scripts.md",
               "markdown-linting.md"]

    @staticmethod
    def install(workspace_root, home):
        return subprocess.run(
            [str(workspace_root / "implementations" / "claude-code" / "install.sh")],
            capture_output=True,
            text=True,
            env={"HOME": str(home), "PATH": "/usr/bin:/bin"},
        )

    def test_a_retired_rule_from_an_earlier_install_is_removed(self, workspace_root, tmp_path):
        home = tmp_path / "home"
        rules = home / ".claude" / "rules"
        rules.mkdir(parents=True)
        for name in self.RETIRED:
            (rules / name).write_text("# stale copy from an earlier install\n")

        result = self.install(workspace_root, home)

        assert result.returncode == 0, result.stderr
        left = [name for name in self.RETIRED if (rules / name).exists()]
        assert not left, (
            f"install.sh left retired rules behind in ~/.claude/rules/: {left} — "
            "they became skills, and nothing else will ever remove them"
        )

    def test_the_rules_that_stayed_are_still_installed(self, workspace_root, tmp_path):
        """The removal must be surgical: four names, not a wipe."""
        home = tmp_path / "home"

        result = self.install(workspace_root, home)

        assert result.returncode == 0, result.stderr
        rules = home / ".claude" / "rules"
        for name in ("llm-discipline.md", "git.md", "testing.md",
                     "communication.md", "spec-structure.md"):
            assert (rules / name).is_file(), \
                f"~/.claude/rules/{name} was not installed"

    def test_spec_structure_is_not_installed_as_a_claude_code_skill(self, workspace_root, tmp_path):
        """It reaches Codex/Copilot via ~/.agents/skills/ only.

        Claude Code has the same content path-scoped as a rule; a second,
        model-triggered copy would be redundant guidance competing with
        itself.
        """
        home = tmp_path / "home"

        result = self.install(workspace_root, home)

        assert result.returncode == 0, result.stderr
        assert not (home / ".claude" / "skills" / "spec-structure").exists(), (
            "install.sh copied core/skills/spec-structure/ into "
            "~/.claude/skills/ — exclude it from the skill rsync by name"
        )

    def test_the_skills_that_replaced_the_rules_are_installed(self, workspace_root, tmp_path):
        home = tmp_path / "home"

        result = self.install(workspace_root, home)

        assert result.returncode == 0, result.stderr
        skills = home / ".claude" / "skills"
        for name in ("workflows", "documentation", "tools-and-scripts",
                     "markdown-linting"):
            assert (skills / name / "SKILL.md").is_file(), \
                f"~/.claude/skills/{name}/SKILL.md was not installed"
