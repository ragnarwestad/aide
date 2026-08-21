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
CORE_SKILLS_DIR = Path(__file__).parents[5] / "core" / "skills"

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


@pytest.mark.validation
class TestCoreSkillsExist:
    """Every skill directory in core/skills/ must have a SKILL.md."""

    def test_core_skills_directory_exists(self):
        assert CORE_SKILLS_DIR.exists(), f"core/skills/ not found: {CORE_SKILLS_DIR}"

    def test_at_least_one_skill_found(self):
        assert len(get_skill_dirs()) > 0, "No skill directories with SKILL.md in core/skills/"

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_skill_md_exists(self, skill_dir):
        assert (skill_dir / "SKILL.md").exists()


@pytest.mark.validation
class TestCoreSkillFrontmatter:
    """SKILL.md files in core/skills/ must have valid YAML frontmatter."""

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_has_frontmatter(self, skill_dir):
        content = (skill_dir / "SKILL.md").read_text()
        assert content.startswith("---"), (
            f"{skill_dir.name}: SKILL.md must start with YAML frontmatter (---)"
        )

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_has_name_field(self, skill_dir):
        fields = parse_frontmatter((skill_dir / "SKILL.md").read_text())
        assert fields.get("name"), f"{skill_dir.name}: frontmatter must have a non-empty 'name' field"

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_name_matches_directory(self, skill_dir):
        fields = parse_frontmatter((skill_dir / "SKILL.md").read_text())
        if "name" in fields:
            assert fields["name"] == skill_dir.name, (
                f"{skill_dir.name}: frontmatter 'name' ({fields['name']}) "
                f"must match the directory name ({skill_dir.name})"
            )

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_has_description_field(self, skill_dir):
        fields = parse_frontmatter((skill_dir / "SKILL.md").read_text())
        assert "description" in fields, f"{skill_dir.name}: frontmatter must have a 'description' field"


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

    def uninstall(self, workspace_root, home):
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
class TestCoreSkillEffort:
    """The effort field controls reasoning level per skill (Claude Code)."""

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_effort_value_is_valid_when_present(self, skill_dir):
        fields = parse_frontmatter((skill_dir / "SKILL.md").read_text())
        if "effort" in fields:
            assert fields["effort"] in VALID_EFFORT_LEVELS, (
                f"{skill_dir.name}: 'effort' ({fields['effort']!r}) must be one of "
                f"{sorted(VALID_EFFORT_LEVELS)}"
            )

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_has_effort_field(self, skill_dir):
        fields = parse_frontmatter((skill_dir / "SKILL.md").read_text())
        assert "effort" in fields, (
            f"{skill_dir.name}: frontmatter must have an 'effort' field "
            f"(one of {sorted(VALID_EFFORT_LEVELS)}) — set the reasoning level deliberately per skill"
        )


# The frontmatter contract (report 71 in aide-specs): the Agent Skills spec's
# six fields, plus the Claude Code extras aide accepts because they degrade
# additively — a tool that ignores them loses a nicety, never a guarantee.
# Behavior-critical fields (disable-model-invocation, user-invocable, context,
# hooks, ...) are banned by default; extending this list is a deliberate
# policy decision, not a formality.
SPEC_FRONTMATTER_FIELDS = {
    "name", "description", "license", "compatibility", "metadata",
    "allowed-tools",
}
ACCEPTED_CLAUDE_CODE_EXTRAS = {"effort", "argument-hint"}
ALLOWED_FRONTMATTER_FIELDS = SPEC_FRONTMATTER_FIELDS | ACCEPTED_CLAUDE_CODE_EXTRAS


@pytest.mark.validation
class TestCoreSkillFrontmatterAllowlist:
    """No skill may carry a frontmatter field outside the allowlist."""

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_skill_uses_only_allowed_fields(self, skill_dir):
        fields = parse_frontmatter((skill_dir / "SKILL.md").read_text())
        rogue = set(fields) - ALLOWED_FRONTMATTER_FIELDS
        assert not rogue, (
            f"{skill_dir.name}: field(s) {sorted(rogue)} are outside the "
            f"frontmatter allowlist. aide only accepts the Agent Skills spec "
            f"fields plus additive Claude Code extras "
            f"({sorted(ACCEPTED_CLAUDE_CODE_EXTRAS)}) — see report 71."
        )

    def test_a_rogue_field_is_detected(self, tmp_path):
        (tmp_path / "SKILL.md").write_text(
            "---\nname: rogue\ndescription: x\ncontext: fork\n---\n\nBody.\n"
        )
        fields = parse_frontmatter((tmp_path / "SKILL.md").read_text())
        assert set(fields) - ALLOWED_FRONTMATTER_FIELDS == {"context"}


@pytest.mark.validation
class TestCoreSkillInvocation:
    """Skills must be invocable both by the user and by the model.

    disable-model-invocation blocked "ask the assistant in prose" (decided
    removed 2026-08-13 — the field was inherited from the commands era).
    It is also Claude Code-only: Copilot and Codex ignore it, so it made
    the same skill stricter in one tool than the others.
    """

    @pytest.mark.parametrize("skill_dir", get_skill_dirs(), ids=lambda d: d.name)
    def test_model_invocation_is_not_disabled(self, skill_dir):
        fields = parse_frontmatter((skill_dir / "SKILL.md").read_text())
        assert "disable-model-invocation" not in fields, (
            f"{skill_dir.name}: remove 'disable-model-invocation' — aide skills "
            "must work when the user asks for them in prose, and the field is "
            "ignored by Copilot/Codex anyway"
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

    def install(self, workspace_root, home):
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
