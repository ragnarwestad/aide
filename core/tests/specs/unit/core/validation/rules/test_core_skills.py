"""Structure validation of all SKILL.md files in core/skills/.

core/skills/ is the source that install.sh copies to ~/.claude/skills/.
test_skill_structure.py only covers the repo's own .claude/skills/, so this
test covers the distributable skills — including that the effort field,
when set, has a valid value.
"""
import json
import re
from urllib.parse import unquote
import subprocess
from pathlib import Path

import pytest

# core/tests/specs/unit/core/validation/test_core_skills.py -> aide/
CORE_SKILLS_DIR = Path(__file__).parents[7] / "core" / "skills"

VALID_EFFORT_LEVELS = {"low", "medium", "high", "xhigh"}


def get_skill_dirs() -> list[Path]:
    if not CORE_SKILLS_DIR.exists():
        return []
    return [
        d for d in CORE_SKILLS_DIR.iterdir()
        if d.is_dir() and (d / "SKILL.md").exists()
    ]


def skills_over_the_size_limit(skills_dir):
    problems = []
    for path in sorted(skills_dir.glob("*/SKILL.md")):
        text = path.read_text(encoding="utf-8")
        lines, characters = len(text.splitlines()), len(text)
        if lines >= 500 or characters >= 20_000:
            problems.append(f"{path.parent.name}: {lines} lines, {characters} characters")
    return problems


@pytest.mark.validation
def test_every_core_skill_is_under_the_size_limit_AC_1_AC_5():
    assert get_skill_dirs(), "No skill directories with SKILL.md in core/skills/"
    assert not (problems := skills_over_the_size_limit(CORE_SKILLS_DIR)), "\n".join(problems)


@pytest.mark.validation
@pytest.mark.parametrize("lines,characters,over", [
    (499, 19_999, False),
    (500, 19_999, True),
    (499, 20_000, True),
    (500, 20_000, True),
])
def test_skill_size_boundaries_name_the_skill_AC_5(tmp_path, lines, characters, over):
    skill = tmp_path / "boundary-skill"
    skill.mkdir()
    (skill / "SKILL.md").write_text("é" * (characters - lines) + "\n" * lines, encoding="utf-8")
    (tmp_path / "not-a-skill").mkdir()
    expected = [f"boundary-skill: {lines} lines, {characters} characters"] if over else []
    assert skills_over_the_size_limit(tmp_path) == expected


@pytest.mark.validation
def test_long_analyze_references_start_with_contents_AC_4():
    problems = []
    for path in sorted((CORE_SKILLS_DIR / "aide-analyze" / "references").glob("*.md")):
        lines = path.read_text(encoding="utf-8").splitlines()
        if len(lines) <= 100:
            continue
        nonempty = [line for line in lines if line.strip()]
        if not (nonempty[0].startswith("# ") and nonempty[1] == "## Table of contents"):
            problems.append(path.name)
    assert not problems, f"References without contents directly after the title: {problems}"


def parse_frontmatter(content: str) -> dict:
    """Extract flat YAML frontmatter fields from a SKILL.md file."""
    match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return {}
    fields = {}
    entries = re.split(r"(?m)^([A-Za-z][A-Za-z0-9_-]*):", match.group(1))
    for key, raw in zip(entries[1::2], entries[2::2]):
        fields[key] = decode_scalar(raw)
    return fields


def decode_scalar(raw):
    lines = raw.splitlines()
    value = lines[0].strip() if lines else ""
    if re.fullmatch(r"[>|][-+]?", value):
        body = lines[1:]
        indents = [len(line) - len(line.lstrip()) for line in body if line.strip()]
        if not indents:
            return ""
        indent = min(indents)
        if indent == 0:
            return None
        body = [line[indent:] if line.strip() else "" for line in body]
        text = ""
        for i, line in enumerate(body):
            text += line
            following = body[i + 1] if i + 1 < len(body) else None
            separator = "\n"
            if value[0] == ">" and following is not None:
                if line and following and not line.startswith(" ") and not following.startswith(" "):
                    separator = " "
                elif not line and following and not following.startswith(" "):
                    preceding = next((part for part in reversed(body[:i]) if part), "")
                    if preceding and not preceding.startswith(" "):
                        separator = ""
            text += separator
        return text.rstrip("\n") if value.endswith("-") else text if value.endswith("+") else text.rstrip("\n") + "\n"
    if value.startswith(('"', "'")) and any(line.strip() for line in lines[1:]):
        return None
    if value.startswith('"'):
        try:
            decoded, end = json.JSONDecoder().raw_decode(value)
            if value[end:].strip() and not value[end:].lstrip().startswith("#"):
                return None
            return decoded
        except ValueError:
            return None
    if value.startswith("'"):
        match = re.fullmatch(r"'((?:[^']|'')*)'\s*(?:#.*)?", value)
        return match.group(1).replace("''", "'") if match else None
    value = re.split(r"\s+#", value, maxsplit=1)[0]
    if (not value or value.lower() in {"null", "~", "true", "false"}
            or value[0] in "[{}]&*!|>" or re.match(r"^-?\d+(?:\.\d+)?$", value)
            or re.search(r":\s", value)):
        return None
    if any(line.strip() for line in lines[1:]):
        return None
    return value


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
            / "core" / "implementations" / "claude-code" / "uninstall.sh"
        )
        content = uninstall.read_text()
        missing = [
            d.name for d in get_skill_dirs()
            if f'"{d.name}"' not in content
            # spec-structure is the one exception, and it is excluded by
            # name in core/implementations/claude-code/install.sh too: Claude
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
            [str(workspace_root / "core" / "implementations" / "claude-code" / "uninstall.sh")],
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
            workspace_root / "core" / "implementations" / "claude-code" / "uninstall.sh"
        ).read_text()
        read = re.search(r'^MANIFEST="\$HOME/\.claude/skills/([^"]+)"', uninstall, re.MULTILINE)
        assert read, "uninstall.sh must read the manifest out of ~/.claude/skills/"
        assert read.group(1) == written.group(1), (
            f"uninstall.sh reads {read.group(1)!r} but the installers write "
            f"{written.group(1)!r}"
        )


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
            [str(workspace_root / "core" / "implementations" / "claude-code" / "install.sh")],
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


def resource_candidates(content):
    # Example sections and explicitly labelled examples demonstrate syntax;
    # ordinary code fences still carry executable resource instructions.
    kept = []
    example_level = None
    example_block = False
    fence = None
    example_content = False
    for line in content.splitlines():
        heading = re.match(r"^(#{1,6})\s+(.+)", line) if fence is None else None
        if heading:
            level = len(heading[1])
            if example_level is not None and level <= example_level:
                example_level = None
            if re.search(r"\bexamples?\b", heading[2], re.I):
                example_level = level
        marker = re.match(r"^\s*(`{3,}|~{3,})", line)
        if marker:
            if fence is None:
                fence = marker[1]
            elif marker[1][0] == fence[0] and len(marker[1]) >= len(fence):
                fence = None
                if example_block:
                    example_block = False
                    continue
        if re.match(r"^\s*(?:\*\*)?(?:[A-Za-z]+ )?Examples?:", line, re.I):
            example_block = True
            example_content = bool(line.split(":", 1)[1].strip(" *"))
            continue
        if example_block and fence is None:
            if not line.strip() and example_content:
                example_block = False
            elif line.strip():
                example_content = True
        if example_level is not None or example_block:
            continue
        if re.match(r"^\s*- Reference images in markdown:", line):
            continue
        kept.append(line)
    text = "\n".join(kept)
    definitions = {}
    for match in re.finditer(r"(?m)^\s*\[([^]]+)\]:\s*(<[^>]+>|\S+).*$", text):
        definitions[match[1].casefold()] = match[2].strip("<>")
    text = re.sub(r"(?m)^\s*\[[^]]+\]:.*$", "", text)
    candidates = []
    for match in re.finditer(r"!?\[[^]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)", text):
        candidates.append(match[1].strip("<>"))
    for match in re.finditer(r"\[([^]\n]+)\](?:\[([^]\n]*)\])?(?!\()", text):
        label = (match[2] or match[1]).casefold()
        if label in definitions:
            candidates.append(definitions[label])
    # Remove links, then scan standalone resource tokens. In particular,
    # core/scripts/... and URLs must not yield a scripts/... substring.
    text = re.sub(r"!?\[[^]\n]*\]\([^)]*\)", "", text)
    candidates.extend(m[0].rstrip(".,;:") for m in re.finditer(
        r"(?<![\w/.:<>-])(?:\.\.?/)*(?:references|scripts|assets)/[^\s`'\"()\[\]]+", text))
    return sorted({path for path in candidates
                   if not path.startswith(("#", "//"))
                   and not re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", path)
                   and not path.endswith("/")
                   and not any(char in path for char in "<>*{}")})


def skill_standard_problems(skill_dir):
    content = (skill_dir / "SKILL.md").read_text(encoding="utf-8")
    fields = parse_frontmatter(content)
    problems = []
    name = fields.get("name")
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name) or len(name) > 64:
        problems.append(f"{skill_dir.name}: name must be 1–64 lowercase letters, digits and single separating hyphens")
    for field, limit in [("description", 1024), ("compatibility", 500)]:
        if field == "compatibility" and field not in fields:
            continue
        value = fields.get(field)
        if not isinstance(value, str) or not 1 <= len(value) <= limit:
            problems.append(f"{skill_dir.name}: {field} must be a supported string of 1–{limit} characters")
    for original in resource_candidates(content):
        path = Path(unquote(re.split(r"[?#]", original, maxsplit=1)[0]))
        target = skill_dir / path
        prefix = f"{skill_dir.name}: {original}: "
        if not target.resolve().is_relative_to(skill_dir.resolve()):
            problems.append(prefix + "outside the skill folder")
        if len(path.parts) > 2:
            problems.append(prefix + "more than one folder below the skill")
        if not target.exists():
            problems.append(prefix + "file does not exist")
        elif not target.is_file():
            problems.append(prefix + "not a file")
    return problems


def all_skill_standard_problems(skills_dir):
    return [problem for skill in sorted(skills_dir.iterdir())
            if (skill / "SKILL.md").is_file()
            for problem in skill_standard_problems(skill)]


@pytest.fixture
def sample_skill(tmp_path):
    skill = tmp_path / "sample"
    skill.mkdir()

    def write(fields="", body="", name="sample", description="valid"):
        (skill / "SKILL.md").write_text(
            f"---\nname: {name}\ndescription: {description}\neffort: high\n"
            f"{fields}---\n{body}", encoding="utf-8")
        return skill

    return write


@pytest.mark.parametrize("value,valid", [
    ("a", True), ("a" * 64, True), ("abc-012", True),
    ("''", False), ("a" * 65, False), ("Upper", False),
    ("under_score", False), ("é", False), ("-start", False),
    ("end-", False), ("two--hyphens", False),
])
def test_name_boundaries_AC_1(sample_skill, value, valid):
    problems = skill_standard_problems(sample_skill(name=value))
    assert bool(problems) is not valid
    assert all("sample: name" in p for p in problems)


@pytest.mark.parametrize("field,limit", [("description", 1024), ("compatibility", 500)])
@pytest.mark.parametrize("size", [0, 1, -1, 1_000_000])
@pytest.mark.parametrize("style", ["plain", "single", "double", "folded", "literal"])
def test_decoded_field_limits_AC_2_AC_3(sample_skill, field, limit, size, style):
    size = limit if size == -1 else limit + 1 if size == 1_000_000 else size
    value = "é" * size
    scalar = {"plain": value, "single": "'" + value + "'",
              "double": '"' + value + '"', "folded": ">-\n  " + value,
              "literal": "|-\n  " + value}[style]
    skill = sample_skill(description=scalar) if field == "description" else sample_skill(fields=f"{field}: {scalar}\n")
    problems = skill_standard_problems(skill)
    assert bool(problems) == (size == 0 or size > limit)
    assert all(f"sample: {field}" in p for p in problems)


@pytest.mark.parametrize("scalar,expected", [
    (">-\n  one\n  two", "one two"), ("|-\n  one\n  two", "one\ntwo"),
    (">\n  one\n  two", "one two\n"), ("|+\n  one\n\n", "one\n\n\n"),
    (">-\n  one\n\n  two", "one\ntwo"),
    (">-\n  one\n\n\n  two", "one\n\ntwo"),
    ("'it''s fine'", "it's fine"), ('"one\\ntwo"', "one\ntwo"),
    ('"\\u00e9"', "é"), ("text # comment", "text"), ('" "', " "),
])
def test_scalar_decoding_AC_2_AC_3(scalar, expected):
    assert parse_frontmatter(f"---\ndescription: {scalar}\neffort: high\n---\n")["description"] == expected


@pytest.mark.parametrize("scalar", ["null", "~", "[]", "{}", "*alias", "&anchor text", "!tag text", '"unclosed', "'unclosed", ">2-\n  text"])
def test_unsupported_scalars_fail_by_field_AC_2_AC_3(sample_skill, scalar):
    problems = skill_standard_problems(sample_skill(description=scalar, fields=f"compatibility: {scalar}\n"))
    assert len(problems) == 2
    assert problems[0].startswith("sample: description")
    assert problems[1].startswith("sample: compatibility")


@pytest.mark.parametrize("body", [
    "[Read](references/missing.md)", "![Image](assets/missing.png)",
    "[Read][guide]\n\n[guide]: references/missing.md", "[guide][]\n\n[guide]: references/missing.md",
    "[guide]\n\n[guide]: references/missing.md", "Read `references/missing.md`.",
    "```bash\npython scripts/extract.py\n```", "```text\nreferences/missing.md\n```",
    "```markdown\n[Read](references/missing.md)\n```",
])
def test_resource_discovery_AC_4(sample_skill, body):
    problems = skill_standard_problems(sample_skill(body=body))
    assert len(problems) == 1
    assert problems[0].endswith(": file does not exist")


@pytest.mark.parametrize("body", [
    "[Web](https://example.com/references/missing.md) [mail](mailto:a@b.com) [here](#section)",
    "`core/scripts/missing.py` `core/skills/other/references/missing.md`",
    "`references/` `references/<file>.md` `references/*.md`",
    "[unused]: references/missing.md", "Other skill's `guide.md` explains this.",
    "**Example:**\n```markdown\n[Read](references/missing.md)\n```",
    "## Example\n[Read](references/missing.md)\n## Instructions\nNo resource here.",
    "- Reference images in markdown: `![Description](./assets/screenshot.png)`",
])
def test_non_resources_are_ignored_AC_4(sample_skill, body):
    assert skill_standard_problems(sample_skill(body=body)) == []


def test_example_does_not_hide_following_instruction_AC_4(sample_skill):
    body = "**Example:**\n```markdown\n[Demo](references/demo.md)\n```\n\nRead `references/real.md`."
    assert skill_standard_problems(sample_skill(body=body)) == ["sample: references/real.md: file does not exist"]


def test_resource_rules_and_deduplication_AC_4(sample_skill, tmp_path):
    skill = sample_skill(body="[outside](../outside.md) [nested](references/deep/file.md)\n"
                         "`references/folder` `references/link.md` `references/missing.md`\n"
                         "[again](references/missing.md)")
    refs = skill / "references"
    (refs / "deep").mkdir(parents=True)
    (refs / "folder").mkdir()
    (refs / "deep/file.md").write_text("exists")
    (tmp_path / "outside.md").write_text("outside")
    (refs / "link.md").symlink_to(tmp_path / "outside.md")
    assert skill_standard_problems(skill) == [
        "sample: ../outside.md: outside the skill folder",
        "sample: references/deep/file.md: more than one folder below the skill",
        "sample: references/folder: not a file",
        "sample: references/link.md: outside the skill folder",
        "sample: references/missing.md: file does not exist",
    ]


def test_valid_skill_and_encoded_links_AC_4_AC_5(sample_skill):
    skill = sample_skill(fields="metadata:\n  nested: value\n", body="[root](guide.md#part) [space](<references/a%20b.md?raw=1#part>)")
    (skill / "guide.md").write_text("# part")
    (skill / "references").mkdir()
    (skill / "references/a b.md").write_text("valid")
    assert skill_standard_problems(skill) == []


def test_all_skills_report_all_failures_AC_1_AC_2_AC_3_AC_4_AC_5(tmp_path):
    for name in ["a", "b"]:
        skill = tmp_path / name
        skill.mkdir()
        (skill / "SKILL.md").write_text("---\nname: BAD\ndescription: ''\ncompatibility: ''\n---\n[missing](references/missing.md)")
    problems = all_skill_standard_problems(tmp_path)
    assert len(problems) == 8
    assert all(p.startswith("a:") for p in problems[:4])
    assert all(p.startswith("b:") for p in problems[4:])


def test_every_skill_meets_the_standard_AC_5():
    assert not (problems := all_skill_standard_problems(CORE_SKILLS_DIR)), "\n".join(problems)


@pytest.mark.parametrize("body", [
    "Example: `references/demo.md`\n\nRead `references/real.md`.",
    "**Example:**\n`references/demo.md`\n\nRead `references/real.md`.",
])
def test_inline_examples_end_before_real_instructions_AC_4(sample_skill, body):
    assert skill_standard_problems(sample_skill(body=body)) == ["sample: references/real.md: file does not exist"]


def test_missing_deep_escape_reports_each_breach_AC_4(sample_skill):
    assert skill_standard_problems(sample_skill(body="[bad](../elsewhere/missing.md)")) == [
        "sample: ../elsewhere/missing.md: outside the skill folder",
        "sample: ../elsewhere/missing.md: more than one folder below the skill",
        "sample: ../elsewhere/missing.md: file does not exist",
    ]


@pytest.mark.parametrize("scalar", ['"valid"\n  extra', "'valid'\n  extra"])
def test_unsupported_quoted_continuations_are_not_truncated_AC_2(sample_skill, scalar):
    assert len(skill_standard_problems(sample_skill(description=scalar))) == 1
