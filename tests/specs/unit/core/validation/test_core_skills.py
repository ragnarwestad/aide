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

    def test_the_skill_is_told_to_leave_worktree_links_alone(self):
        """Spec 184: `worktreeLinks` is the dashboard's to write, and a
        refresh of a stale manifest is an AI reading the whole file and
        writing it back. Without an instruction, a routine refresh drops
        the key out of the COMMITTED file — and every other machine's
        worktree comes up without the paths its test command needs, while
        the machine that ran the refresh notices nothing."""
        skill = (CORE_SKILLS_DIR / "aide-manifest" / "SKILL.md").read_text(encoding="utf-8")
        assert "worktreeLinks" in skill, (
            "aide-manifest/SKILL.md must name worktreeLinks and say to leave it as found"
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


@pytest.mark.validation
class TestArchiveHeldBackBulletSaysWhereToCloseIt:
    """Spec 182: the held-back bullet is an instruction, not a report.

    `## Archive held back` holds ONE bullet, and the dashboard echoes it
    verbatim in three places — the spec's row, the row's badge and the
    job page's Steps tab. "the manual 375px browser check (Phase 4,
    still unchecked)" describes the app's state; the reader also needs
    to know what to do about it, and since the boxes became clickable
    the answer is a place on the dashboard. The example the skill gives
    is what a run copies, so the example is where the instruction goes.
    """

    SKILL = CORE_SKILLS_DIR / "aide-archive" / "SKILL.md"

    def test_the_example_bullet_names_where_a_person_closes_the_check_out(self):
        text = self.SKILL.read_text(encoding="utf-8")
        example = [
            line for line in text.splitlines()
            if line.lstrip().startswith("`- ") and "still unchecked" in line
        ]
        assert example, "the skill gives no `- ...(still unchecked)` example bullet"
        assert any("spec's page" in line for line in example), (
            "the example held-back bullet says what is open but not where to "
            f"close it out: {example}"
        )


class TestStep3DecidesOnMarksNotProse:
    """Spec 194: Step 3's finish decision reads Status marks only.

    Three specs refused to archive with every Tasks-table row ticked,
    because a Notes cell beside a ticked row still read as unfinished
    and Step 3 asked the session to judge whether the file "clearly
    shows finished work". The dashboard already draws the line the
    other way — `isDoneMark` in `dashboard/src/parse-status.ts` reads
    one column and two literal values — so Step 3 has to state the same
    rule for the session that reads it.
    """

    SKILL = CORE_SKILLS_DIR / "aide-archive" / "SKILL.md"

    def _step_3_text(self) -> str:
        text = self.SKILL.read_text(encoding="utf-8")
        start = text.index("### Step 3: Check that the work is done")
        end = text.index("### Step 4:", start)
        return text[start:end]

    def test_decision_names_the_status_cell_as_sole_input(self):
        step3 = self._step_3_text()
        assert "Status cell" in step3, (
            "Step 3 never names the Status cell, so the finish decision is "
            "still an open reading of the whole file"
        )
        assert "✅" in step3, (
            "Step 3 does not say which mark counts as done"
        )

    def test_notes_cell_is_explicitly_ruled_out(self):
        step3 = self._step_3_text()
        assert "Notes cell" in step3, "Step 3 never mentions the Notes cell"
        assert (
            re.search(r"never\b.{0,60}\bNotes cell", step3, re.DOTALL)
            or re.search(r"Notes cell\b.{0,60}\bnever\b", step3, re.DOTALL)
        ), (
            "Step 3 mentions the Notes cell but never rules it out as an "
            "input to the decision"
        )

    def test_an_open_row_is_named_by_phase_and_task(self):
        step3 = self._step_3_text()
        assert "phase heading" in step3 and "Task cell" in step3, (
            "Step 3 does not require the refusal to name the open row's "
            "phase heading and Task cell"
        )


class TestStep3DistinguishesOrdinaryProgressFromHeldBack:
    """Spec 227: "held back" is a warning, not the ordinary flow.

    A job queued as [analyze, archive] ran its analysis, archive found
    every task row unstarted because implement had never run, declined
    — and wrote `## Archive held back`, which the dashboard shows as an
    amber badge and a warning panel in three places. Declining was
    right; warning about it was not, since by that reading every freshly
    created spec is "held back" too. Step 3's headless branch therefore
    has to tell two shapes apart: work the workflow has simply not
    reached (every open row unstarted and `implement` absent from the
    commit-derived `Workflow steps completed` line) is ordinary
    progression and writes nothing, while a row still open after
    implement ran keeps today's warning. Step 3 has no executable
    counterpart — a headless run follows it as prose — so the rule is
    pinned in its text, the same way TestStep3DecidesOnMarksNotProse
    pins the Status-cell rule.
    """

    SKILL = CORE_SKILLS_DIR / "aide-archive" / "SKILL.md"

    def _headless_branch(self) -> str:
        text = self.SKILL.read_text(encoding="utf-8")
        start = text.index("### Step 3: Check that the work is done")
        end = text.index("### Step 4:", start)
        step3 = text[start:end]
        return step3[step3.index("Nobody is there (headless"):]

    def _split_branches(self) -> tuple[str, str]:
        """The ordinary-progression half and the genuinely-blocked half."""
        headless = self._headless_branch()
        lowered = headless.lower()
        assert "ordinary progression" in lowered, (
            "Step 3's headless branch never names ordinary progression, so it "
            "still treats every open row as a warning"
        )
        assert "genuinely blocked" in lowered, (
            "Step 3's headless branch never names the genuinely-blocked case"
        )
        cut = lowered.index("genuinely blocked")
        return headless[lowered.index("ordinary progression"):cut], headless[cut:]

    def test_ordinary_progression_is_read_off_the_completed_steps_line(self):
        """AC1: unstarted rows plus no implement is the normal flow, and
        the run stops there without writing a warning."""
        headless = self._headless_branch()
        ordinary, _ = self._split_branches()

        assert "Workflow steps completed" in headless, (
            "Step 3 never reads the commit-derived `Workflow steps completed` "
            "line, so it has no way to know whether implement ever ran"
        )
        assert "Not started" in headless and "\u2b1c" in headless, (
            "Step 3 never says what UNSTARTED means, so it cannot ask the "
            "narrower question that separates the two cases"
        )
        assert re.search(r"every open row unstarted", ordinary, re.I), (
            "the ordinary-progression case does not require EVERY open row to "
            "be unstarted"
        )
        assert re.search(r"`?implement`?[^.]{0,80}absent", ordinary), (
            "the ordinary-progression case does not require `implement` to be "
            "absent from the completed-steps line"
        )
        assert re.search(r"(no|not|never)[^.]{0,40}## Archive held back", ordinary), (
            "the ordinary-progression case does not say the `## Archive held "
            "back` section is left unwritten"
        )
        assert re.search(r"do not\s+continue[^.]{0,40}Step 4", ordinary, re.I), (
            "the ordinary-progression case does not stop before Step 4"
        )
        assert "/aide-implement" in ordinary, (
            "the ordinary-progression report does not name the next step"
        )

    def test_a_row_still_open_after_implement_ran_keeps_the_warning(self):
        """AC2: spec 219's shape is unchanged — the section is still
        written, with the same one bullet."""
        _, blocked = self._split_branches()

        assert re.search(r"`?implement`?[^.]{0,60}present", blocked), (
            "the genuinely-blocked case does not trigger on `implement` being "
            "present on the completed-steps line while a row is still open"
        )
        assert "## Archive held back" in blocked, (
            "the genuinely-blocked case no longer writes the `## Archive held "
            "back` section"
        )
        assert "ONE bullet" in blocked, (
            "the genuinely-blocked case lost the one-bullet rule"
        )
        assert re.search(r"do not\s+continue[^.]{0,40}Step 4", blocked, re.I), (
            "the genuinely-blocked case does not stop before Step 4"
        )

    def test_a_stale_section_is_removed_when_the_spec_reads_as_normal(self):
        """AC3: a warning left by an earlier run of this shape does not
        outlive the shape that wrote it."""
        ordinary, _ = self._split_branches()

        assert re.search(
            r"remove\b[^.]{0,120}(stale|already in the file|earlier run)",
            ordinary, re.I | re.DOTALL,
        ), (
            "the ordinary-progression case never removes a `## Archive held "
            "back` section an earlier run left behind"
        )

    def test_a_row_begun_but_unfinished_is_blocked_without_implement(self):
        """AC4: in progress, blocked or waiting is not the normal flow,
        whatever the completed-steps line says."""
        _, blocked = self._split_branches()

        assert re.search(r"not unstarted", blocked, re.I), (
            "the genuinely-blocked case does not trigger on an open row that "
            "was begun but never finished"
        )
        for mark in ("\U0001f504", "\u274c", "\u26a0"):
            assert mark in blocked, (
                f"the genuinely-blocked case does not name the {mark} mark as "
                "a row that was begun"
            )


@pytest.mark.validation
class TestReopenSkillKeepsWhatTheDescriptionAsksFor:
    """Spec 198. Three of the seven acceptance criteria are the SKILL's
    own promises rather than the runner's, and no fixture repo can reach
    them: what a model writes into `4-status.md`, which files it leaves
    alone, and whether it says the same thing to a terminal that the
    dashboard's control says to `aide-run-spec`. What CAN be checked is
    that the instructions still name them — the same net
    `test_templates.py` keeps over the spec layout, and for the same
    reason: a partial edit here fails the suite instead of escaping into
    the next reopened spec.
    """

    @pytest.fixture
    def skill(self):
        path = CORE_SKILLS_DIR / "aide-reopen" / "SKILL.md"
        assert path.exists(), "core/skills/aide-reopen/SKILL.md is missing"
        return path.read_text()

    def test_the_description_and_the_readme_are_named_as_untouched(self, skill):
        """AC7. The description is WHY the spec exists and is what the
        new round is for."""
        assert "1-description.md" in skill
        assert "0-README.md" in skill

    def test_the_three_reset_files_are_named(self, skill):
        for name in ("2-analysis.md", "3-solution.md", "4-status.md"):
            assert name in skill, f"{name} is not named as one of the files reset"

    def test_the_archive_trail_is_kept(self, skill):
        """AC3. The commits cannot be deleted and should not be; the
        spec's own archive trail has to go on reading."""
        assert "**Archived:**" in skill

    def test_the_boundary_mark_is_written_in_the_grammar_the_readers_parse(self, skill):
        """One grammar, four readers: `completed_steps_for` in
        `core/scripts/aide-run-spec`, `parse-status.ts`,
        `workflow-history.ts` and `description-freshness.ts`."""
        assert "**Reopened:**" in skill
        assert "history before" in skill


@pytest.mark.validation
class TestResetSkillKeepsTheActiveSpecHistory:
    @pytest.fixture
    def skill(self):
        path = CORE_SKILLS_DIR / "aide-reset" / "SKILL.md"
        assert path.exists(), "core/skills/aide-reset/SKILL.md is missing"
        return path.read_text()

    def test_it_keeps_the_owned_files_and_regenerates_the_work_files(self, skill):
        for name in ("0-README.md", "1-description.md", "2-analysis.md", "3-solution.md", "4-status.md"):
            assert name in skill

    def test_it_writes_the_reset_boundary_and_refuses_archived_specs(self, skill):
        assert "**Reset:**" in skill
        assert "history before" in skill
        assert "active folder" in skill

    def test_the_four_places_a_branch_hides_are_named(self, skill):
        """AC2, incident 1: a local ref left behind in one of the four
        (project-local, project-origin, specs-local, specs-origin) and
        the next run refuses on a conflict nobody can see."""
        for word in ("origin", "local"):
            assert word in skill.lower()

    def test_it_says_the_headless_run_gets_its_commit_for_free(self, skill):
        """AC4. Both surfaces have to leave the spec in the same state,
        and a skill that stops to ask in a headless run leaves it in
        neither."""
        assert "headless" in skill.lower()


@pytest.mark.validation
class TestCreateSkillStagesAndOffersToCommit:
    """Spec 219, AC9. Of the four step skills, aide-create was the only
    one that never offered a commit — Step 5 unconditionally SKIPPED
    `git add` whenever the specs root sat outside the project (the
    `aide-specs` shape), so the ordinary interactive flow produced no
    aide-authored commit for commit-msg-spec-guard to recognize. A
    human committing that scaffold by hand from the IDE would then be
    blocked by the very hook meant to catch hand-written specs, even
    though the files were genuinely produced by the skill.
    """

    SKILL = CORE_SKILLS_DIR / "aide-create" / "SKILL.md"

    def _step_5_text(self) -> str:
        text = self.SKILL.read_text(encoding="utf-8")
        start = text.index("### Step 5:")
        end = text.index("### Step 6:", start)
        return text[start:end]

    def test_step_5_no_longer_unconditionally_skips_git_add(self):
        step5 = self._step_5_text()
        assert "SKIP" not in step5, (
            "Step 5 still skips `git add` for an external specs root — "
            "a spec created there never gets staged, so there is "
            "nothing for Step 5's commit offer to commit"
        )
        assert "git add" in step5

    def test_step_5_offers_the_create_commit_with_the_convention_message(self):
        step5 = self._step_5_text()
        assert "Run /aide-create for" in step5, (
            "Step 5 does not offer the `Run /aide-create for <spec-folder>` "
            "commit — the one convention-carrying commit aide-create was "
            "missing"
        )

    def test_it_says_the_headless_run_gets_its_commit_for_free(self):
        """Matches the other three step skills' identical wording, so a
        headless `aide-run-spec` run and an interactive one leave the
        spec in the same state."""
        step5 = self._step_5_text()
        assert "headless" in step5.lower()

    def test_validation_is_local_only_without_package_download_fallback(self):
        skill = self.SKILL.read_text(encoding="utf-8")
        assert "markdownlint-cli2" in skill
        assert "installed locally" in skill
        assert "must not invoke `npx`" in skill


@pytest.mark.validation
class TestMarkdownHookDefaultsAreLocalOnly:
    def test_claude_hook_does_not_use_npx_for_markdownlint(self):
        settings_path = CORE_SKILLS_DIR.parents[1] / "implementations" / "claude-code" / "settings.json"
        settings = settings_path.read_text(encoding="utf-8")
        assert "npx markdownlint-cli2" not in settings
