"""Validation tests for the shared shell scripts in core/scripts."""
import os
import re
import shutil
import subprocess

import pytest

from tests.specs.unit.core.validation.test_templates import structure_block

# Template placeholders such as {{DOMAIN}} — none may survive into core/scripts.
PLACEHOLDER_PATTERN = re.compile(r"\{\{[A-Za-z_]+\}\}")


def _scripts(workspace_root):
    scripts_dir = workspace_root / "core" / "scripts"
    if not scripts_dir.exists():
        pytest.skip("core/scripts not found")
    return sorted(p for p in scripts_dir.iterdir() if p.is_file())


@pytest.mark.validation
class TestCoreScriptsAreWellFormed:
    """The scripts must parse and must not carry migration leftovers."""

    def test_scripts_parse_as_bash(self, workspace_root):
        for script in _scripts(workspace_root):
            result = subprocess.run(
                ["bash", "-n", str(script)], capture_output=True, text=True
            )
            assert result.returncode == 0, \
                f"{script.name} is not valid bash:\n{result.stderr}"

    def test_the_installers_parse_as_bash(self, workspace_root):
        # The installers live outside core/scripts and so fell outside the
        # check above — a syntax error in one of them used to reach a user
        # before anything noticed (spec 175).
        scripts = [workspace_root / "install-all.sh", workspace_root / "uninstall-all.sh"]
        for tool in ("claude-code", "codex", "copilot"):
            scripts.append(workspace_root / "implementations" / tool / "install.sh")
            scripts.append(workspace_root / "implementations" / tool / "uninstall.sh")
        for script in scripts:
            assert script.is_file(), f"{script} is missing"
            result = subprocess.run(
                ["bash", "-n", str(script)], capture_output=True, text=True
            )
            assert result.returncode == 0, \
                f"{script.name} is not valid bash:\n{result.stderr}"

    def test_scripts_have_no_unrendered_placeholders(self, workspace_root):
        for script in _scripts(workspace_root):
            found = PLACEHOLDER_PATTERN.findall(script.read_text())
            assert not found, \
                f"{script.name} still contains template placeholders: {found}"


@pytest.mark.validation
class TestValidateEnv:
    """validate-env must check the variable names the rest of the repo reads."""

    @staticmethod
    def _run(workspace_root, extra_env):
        env = {"PATH": os.environ["PATH"], "HOME": os.environ["HOME"]}
        env.update(extra_env)
        return subprocess.run(
            [str(workspace_root / "core" / "scripts" / "validate-env"), "--quiet"],
            capture_output=True,
            text=True,
            env=env,
        )

    def test_fails_when_installation_path_is_missing(self, workspace_root):
        result = self._run(workspace_root, {})
        assert result.returncode == 1, \
            "Missing AIDE_INSTALLATION_PATH should be reported as an error"

    def test_passes_when_installation_path_is_set(self, workspace_root, tmp_path):
        result = self._run(
            workspace_root, {"AIDE_INSTALLATION_PATH": str(tmp_path)}
        )
        assert result.returncode == 0, \
            f"Set AIDE_INSTALLATION_PATH should pass, got:\n{result.stdout}{result.stderr}"

    def test_checks_all_documented_variables(self, workspace_root):
        """Two AIDE_* environment variables remain; the specs path is
        per-project .aide/config (spec 73) and must NOT be checked as env."""
        env = {"PATH": os.environ["PATH"], "HOME": os.environ["HOME"]}
        result = subprocess.run(
            [str(workspace_root / "core" / "scripts" / "validate-env")],
            capture_output=True,
            text=True,
            env=env,
        )
        for var in ("AIDE_INSTALLATION_PATH", "AIDE_PROJECTS_PATH"):
            assert var in result.stdout, \
                f"validate-env does not mention {var}:\n{result.stdout}"
        assert "AIDE_SPECS_PATH is not set" not in result.stdout, \
            "the retired env var must not be checked"


@pytest.mark.validation
class TestInstallCommonBin:
    """The shared bin installer must ship every user-facing CLI script."""

    def test_validate_env_is_installed(self, workspace_root, tmp_path):
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_common_bin'],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode == 0, result.stderr
        assert (tmp_path / ".local" / "bin" / "validate-env").is_file(), \
            "validate-env is not in COMMON_BIN_SCRIPTS, so it never reaches ~/.local/bin"

    def test_aide_record_test_run_is_installed(self, workspace_root, tmp_path):
        """The archive gate calls it by name. It shipped without being in
        COMMON_BIN_SCRIPTS, so the serving host never had it: the gate
        could not make the record it refuses for the lack of, and every
        archive was refused with nothing to show for it."""
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_common_bin'],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode == 0, result.stderr
        assert (tmp_path / ".local" / "bin" / "aide-record-test-run").is_file(), \
            "aide-record-test-run is not in COMMON_BIN_SCRIPTS, so the archive gate cannot run it"

    def test_aide_create_spec_is_installed(self, workspace_root, tmp_path):
        """Spec 248, AC9. aide-create-spec is /aide-create's own Step 4
        script — if it drops out of COMMON_BIN_SCRIPTS, install-all.sh
        stops shipping it and every Step 4 invocation breaks."""
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_common_bin'],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode == 0, result.stderr
        assert (tmp_path / ".local" / "bin" / "aide-create-spec").is_file(), \
            "aide-create-spec is not in COMMON_BIN_SCRIPTS, so it never reaches ~/.local/bin"

    def test_aide_write_spec_is_installed(self, workspace_root, tmp_path):
        """Spec 282. aide-write-spec is the one legitimate way
        /aide-analyze, /aide-implement and /aide-archive land a spec
        file's content on disk — if it drops out of COMMON_BIN_SCRIPTS,
        every one of those Bash calls breaks."""
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_common_bin'],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode == 0, result.stderr
        assert (tmp_path / ".local" / "bin" / "aide-write-spec").is_file(), \
            "aide-write-spec is not in COMMON_BIN_SCRIPTS, so it never reaches ~/.local/bin"

    def test_aide_print_specs_guard_is_installed(self, workspace_root, tmp_path):
        """Spec 282, REQ-4. aide-print-specs-guard is how a developer
        gets a ready-to-paste deny-rule snippet for their own project —
        if it drops out of COMMON_BIN_SCRIPTS, it never reaches
        ~/.local/bin at all."""
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_common_bin'],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode == 0, result.stderr
        assert (tmp_path / ".local" / "bin" / "aide-print-specs-guard").is_file(), \
            "aide-print-specs-guard is not in COMMON_BIN_SCRIPTS, so it never reaches ~/.local/bin"


def _fake_mise(tmp_path, body):
    """A stand-in `mise`, in its own directory so it can be prepended
    ahead of the ambient PATH — this machine (and likely others aide is
    installed on) has a REAL mise on PATH, which must never be the one
    that runs (plan review, Feasibility should-fix 3: an unprepended fake
    would let the real `mise use -g npm:markdownlint-cli2@latest` attempt
    a genuine network install as a side effect of running the tests)."""
    bin_dir = tmp_path / "fake-bin"
    bin_dir.mkdir(exist_ok=True)
    path = bin_dir / "mise"
    path.write_text(f"#!/usr/bin/env bash\n{body}\n")
    path.chmod(0o755)
    return bin_dir


@pytest.mark.validation
class TestInstallMiseDeclaredTools:
    """install_mise_declared_tools must declare markdownlint-cli2 to mise
    without ever failing the installer when mise or node is missing."""

    def test_warns_and_succeeds_without_mise(self, workspace_root, tmp_path):
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_mise_declared_tools'],
            capture_output=True,
            text=True,
            env={"PATH": "/usr/bin:/bin", "HOME": str(tmp_path)},
        )
        assert result.returncode == 0, result.stderr
        assert "mise" in (result.stdout + result.stderr).lower()

    def test_warns_and_succeeds_without_node(self, workspace_root, tmp_path):
        # Fails only on `mise which ...` (how a missing node is detected),
        # succeeds on anything else.
        fake_bin = _fake_mise(
            tmp_path,
            '[ "$1" = "which" ] && exit 1\nexit 0',
        )
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_mise_declared_tools'],
            capture_output=True,
            text=True,
            env={"PATH": f"{fake_bin}:{os.environ['PATH']}", "HOME": str(tmp_path)},
        )
        assert result.returncode == 0, result.stderr
        assert "node" in (result.stdout + result.stderr).lower()

    def test_declares_markdownlint_via_mise(self, workspace_root, tmp_path):
        calls = tmp_path / "mise-calls.txt"
        fake_bin = _fake_mise(tmp_path, f'printf "%s\\n" "$*" >> {calls}\nexit 0')
        installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
        result = subprocess.run(
            ["bash", "-c", f'source "{installer}"; install_mise_declared_tools'],
            capture_output=True,
            text=True,
            env={"PATH": f"{fake_bin}:{os.environ['PATH']}", "HOME": str(tmp_path)},
        )
        assert result.returncode == 0, result.stderr
        logged = calls.read_text() if calls.exists() else ""
        assert "use -g npm:markdownlint-cli2@latest" in logged, logged


@pytest.mark.validation
class TestInstallersDeclareMarkdownlint:
    """Every installer must call install_mise_declared_tools, or a machine
    that only ran one implementations/<ai>/install.sh never gets it."""

    def test_every_installer_calls_install_mise_declared_tools(self, workspace_root):
        for tool in ("claude-code", "copilot", "codex"):
            installer = workspace_root / "implementations" / tool / "install.sh"
            text = installer.read_text()
            assert "install_mise_declared_tools" in text, \
                f"implementations/{tool}/install.sh never calls install_mise_declared_tools"


@pytest.mark.validation
class TestUpgradeAiToolsKeepsMarkdownlintCurrent:
    """upgrade-ai-tools must keep markdownlint-cli2 current alongside the
    tools it already names, and report it in its own version listing."""

    @staticmethod
    def _text(workspace_root):
        return (workspace_root / "core" / "scripts" / "upgrade-ai-tools").read_text()

    def test_upgrade_line_includes_markdownlint(self, workspace_root):
        text = self._text(workspace_root)
        upgrade_line = next(
            line for line in text.splitlines() if line.strip().startswith("mise upgrade")
        )
        assert "npm:markdownlint-cli2" in upgrade_line, upgrade_line

    def test_installed_versions_report_includes_markdownlint(self, workspace_root):
        text = self._text(workspace_root)
        report_line = next(
            line for line in text.splitlines() if "mise ls" in line
        )
        assert "markdownlint" in report_line, report_line


@pytest.mark.validation
class TestMiseDeclaredToolsStayInStepWithUpgrade:
    """A tool declared by the installer that upgrade-ai-tools never
    upgrades would go stale forever after its first install (REQ-5)."""

    def test_every_mise_declared_tool_is_kept_current(self, workspace_root):
        install_bin_text = (
            workspace_root / "core" / "scripts" / "_install-bin.sh"
        ).read_text()
        match = re.search(r'^MISE_DECLARED_TOOLS="([^"]*)"', install_bin_text, re.MULTILINE)
        assert match, "MISE_DECLARED_TOOLS is missing from _install-bin.sh"
        declared_tools = match.group(1).split()
        assert declared_tools, "MISE_DECLARED_TOOLS is empty"

        upgrade_text = (
            workspace_root / "core" / "scripts" / "upgrade-ai-tools"
        ).read_text()
        upgrade_line = next(
            line for line in upgrade_text.splitlines()
            if line.strip().startswith("mise upgrade")
        )

        missing = [tool for tool in declared_tools if tool not in upgrade_line]
        assert not missing, (
            f"{missing} are declared in MISE_DECLARED_TOOLS but never upgraded by "
            f"upgrade-ai-tools: {upgrade_line}"
        )


# Codex reads at most project_doc_max_bytes of AGENTS.md and appends
# nothing past it. 32768 is the documented default (see the
# ai-tools-reference skill) and the budget core/AGENTS.md must fit inside.
CODEX_PROJECT_DOC_MAX_BYTES = 32768

# A string that appears in core/rules/spec-structure.md and in no other
# rule — the marker for "this rule's body was concatenated in".
SPEC_STRUCTURE_MARKER = "Workflow steps completed"


class TestBuildAgentsMd:
    """AGENTS.md must carry rule BODIES only, never their YAML frontmatter.

    The rules are concatenated for Copilot/Codex, which have no concept of
    Claude Code's paths frontmatter — before the fix, the raw `paths:` block
    from spec-structure.md leaked into AGENTS.md as body text.
    """

    def test_output_contains_no_rule_frontmatter(self, workspace_root, tmp_path):
        core = tmp_path / "core"
        (core / "scripts").mkdir(parents=True)
        shutil.copy(
            workspace_root / "core" / "scripts" / "build-agents-md.sh",
            core / "scripts" / "build-agents-md.sh",
        )
        shutil.copy(workspace_root / "core" / "agents-intro.md", core / "agents-intro.md")
        shutil.copytree(workspace_root / "core" / "rules", core / "rules")

        result = subprocess.run(
            ["bash", str(core / "scripts" / "build-agents-md.sh")],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr

        lines = (core / "AGENTS.md").read_text().splitlines()
        assert "paths:" not in [line.strip() for line in lines], (
            "rule frontmatter leaked into AGENTS.md — build-agents-md.sh "
            "must strip the leading YAML block from each rule"
        )

    def test_output_carries_the_corrected_spec_layout(self, workspace_root, tmp_path):
        """The generated spec-structure skill is Copilot's and Codex's copy
        of the spec layout.

        It is generated, never hand-edited, so a rule change that is not
        regenerated leaves those two tools serving the old layout. The
        layout left AGENTS.md itself in spec 147 — at 11 KB it was the
        single biggest reason the file overshot Codex's read window — but
        the same build script still produces it, from the same source, in
        the same run.
        """
        agents_md = self._build_spec_structure_skill(workspace_root, tmp_path)

        description = structure_block(agents_md, "1-description")
        assert "## Scope" not in description, \
            "the generated skill still puts Scope in 1-description — regenerate it"

        analysis = structure_block(agents_md, "2-analysis")
        for heading in ("## Scope", "## Complexity", "## Risk analysis"):
            assert heading not in analysis, \
                f"the generated skill still puts '{heading}' in 2-analysis — regenerate it"

    def test_output_frames_manual_testing_as_a_note(self, workspace_root, tmp_path):
        """Codex and Copilot read the generated spec-structure skill, so
        the note framing must reach it.

        Checked twice: the freshly built output (the rule source is right)
        and the committed core/skills/spec-structure/SKILL.md (it was
        actually regenerated).
        """
        rebuilt = structure_block(
            self._build_spec_structure_skill(workspace_root, tmp_path), "3-solution")
        committed = structure_block(
            (workspace_root / "core" / "skills" / "spec-structure" / "SKILL.md")
            .read_text(), "3-solution")

        for name, block in (("the rebuilt output", rebuilt),
                            ("core/skills/spec-structure/SKILL.md", committed)):
            assert "### Manual testing" in block, \
                f"{name} dropped the Manual testing section — it is reframed, not removed"
            section = block.split("### Manual testing", 1)[1]
            assert "must be tested manually" not in section.lower(), \
                f"{name} still asks for a manual test plan — regenerate it"
            assert "not covered" in section.lower(), \
                f"{name} lacks the 'not covered by a test' framing — regenerate it"

    def test_output_fits_codex_read_window(self, workspace_root, tmp_path):
        """AGENTS.md must fit inside Codex's project_doc_max_bytes default.

        Codex appends at most 32768 bytes of AGENTS.md and stops there,
        silently — no warning, no marker, just the rest of the file gone.
        At 64399 bytes the cut landed mid-testing.md, and every Codex run
        for a month worked without the spec layout or the communication
        rule (spec 147). Nothing caught it because nothing measured it.

        Checked on both sides: the freshly built output (the rule set is
        small enough) and the committed core/AGENTS.md (it was actually
        regenerated after the rules changed).
        """
        rebuilt = self._build(workspace_root, tmp_path).encode("utf-8")
        committed = (workspace_root / "core" / "AGENTS.md").read_bytes()

        for name, data in (("the rebuilt output", rebuilt),
                           ("core/AGENTS.md", committed)):
            assert len(data) <= CODEX_PROJECT_DOC_MAX_BYTES, (
                f"{name} is {len(data)} bytes — over Codex's "
                f"{CODEX_PROJECT_DOC_MAX_BYTES}-byte read window by "
                f"{len(data) - CODEX_PROJECT_DOC_MAX_BYTES}. Codex will read "
                "the file up to the limit and drop the rest without saying "
                "so. Move a rule out to core/skills/ rather than raising "
                "this number."
            )

    def test_output_leaves_the_path_scoped_rule_out(self, workspace_root, tmp_path):
        """The shrink must come from real extraction, not incidental trimming.

        spec-structure.md is the largest rule and is path-scoped for Claude
        Code already; the generator used to inline it unconditionally.
        Codex gets it as a skill instead (core/skills/spec-structure/).
        """
        rebuilt = self._build(workspace_root, tmp_path)
        assert SPEC_STRUCTURE_MARKER not in rebuilt, (
            f"AGENTS.md still carries spec-structure.md's body ({SPEC_STRUCTURE_MARKER!r}) "
            "— drop it from build-agents-md.sh's RULE_FILES; Codex reads it "
            "from ~/.agents/skills/spec-structure/ instead"
        )

    @classmethod
    def _build_spec_structure_skill(cls, workspace_root, tmp_path):
        """Same build, different output file: the script writes both."""
        cls._build(workspace_root, tmp_path)
        return (tmp_path / "core" / "skills" / "spec-structure" / "SKILL.md").read_text()

    @staticmethod
    def _build(workspace_root, tmp_path):
        core = tmp_path / "core"
        (core / "scripts").mkdir(parents=True)
        shutil.copy(
            workspace_root / "core" / "scripts" / "build-agents-md.sh",
            core / "scripts" / "build-agents-md.sh",
        )
        shutil.copy(workspace_root / "core" / "agents-intro.md", core / "agents-intro.md")
        shutil.copytree(workspace_root / "core" / "rules", core / "rules")

        result = subprocess.run(
            ["bash", str(core / "scripts" / "build-agents-md.sh")],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        return (core / "AGENTS.md").read_text()


@pytest.mark.validation
class TestSpecStructureSkillIsGenerated:
    """core/skills/spec-structure/SKILL.md is generated, never hand-written.

    Claude Code reads the spec layout from core/rules/spec-structure.md,
    path-scoped by its `paths` frontmatter. Codex and Copilot have no
    path-scoping at all, and the rule is too big to inline into AGENTS.md
    (spec 147) — so they read the same content as a skill. Two copies of
    the layout that drift apart is exactly the failure spec 82 spent a
    whole spec cleaning up, so the skill is derived from the rule by
    build-agents-md.sh and compared here byte for byte.
    """

    def _rule_body(self, workspace_root):
        text = (workspace_root / "core" / "rules" / "spec-structure.md").read_text(
            encoding="utf-8")
        return re.sub(r"^---\n.*?\n---\n", "", text, count=1, flags=re.DOTALL)

    def _skill_body(self, workspace_root):
        text = (workspace_root / "core" / "skills" / "spec-structure" / "SKILL.md").read_text(
            encoding="utf-8")
        return re.sub(r"^---\n.*?\n---\n", "", text, count=1, flags=re.DOTALL)

    def test_the_skill_exists(self, workspace_root):
        skill = workspace_root / "core" / "skills" / "spec-structure" / "SKILL.md"
        assert skill.exists(), (
            "core/skills/spec-structure/SKILL.md is missing — run "
            "core/scripts/build-agents-md.sh, which generates it from "
            "core/rules/spec-structure.md"
        )

    def test_the_skill_body_matches_the_rule_body(self, workspace_root):
        rule = self._rule_body(workspace_root).strip()
        skill = self._skill_body(workspace_root).strip()
        assert skill == rule, (
            "core/skills/spec-structure/SKILL.md has drifted from "
            "core/rules/spec-structure.md — the skill is generated from the "
            "rule; edit the rule and re-run core/scripts/build-agents-md.sh"
        )

    def test_the_generator_writes_it(self, workspace_root, tmp_path):
        """Built from a temp copy: the generation step is in the script,
        not something a person ran once by hand."""
        core = tmp_path / "core"
        (core / "scripts").mkdir(parents=True)
        shutil.copy(
            workspace_root / "core" / "scripts" / "build-agents-md.sh",
            core / "scripts" / "build-agents-md.sh",
        )
        shutil.copy(workspace_root / "core" / "agents-intro.md", core / "agents-intro.md")
        shutil.copytree(workspace_root / "core" / "rules", core / "rules")

        result = subprocess.run(
            ["bash", str(core / "scripts" / "build-agents-md.sh")],
            capture_output=True, text=True,
        )
        assert result.returncode == 0, result.stderr

        generated = core / "skills" / "spec-structure" / "SKILL.md"
        assert generated.exists(), (
            "build-agents-md.sh did not generate core/skills/spec-structure/SKILL.md"
        )
        content = generated.read_text(encoding="utf-8")
        assert content.startswith("---\n"), "the generated skill needs frontmatter"
        assert "\nname: spec-structure\n" in content, \
            "the generated skill's frontmatter name must match its directory"
        assert "paths:" not in content, (
            "the `paths` frontmatter is Claude Code-only and is not in the "
            "skill frontmatter allowlist — strip it"
        )


class TestGenerateHtmlForArchivedSpec:
    """aide-generate-html must handle specs that live under archive/.

    Resolution returns "archive/NN-slug" for archived specs. The script
    used that full id (with its slash) in temp and output FILE NAMES,
    so generation for an archived spec died in mktemp (spec 72 smoke test).
    """

    def test_generates_html_inside_the_archive_folder(self, workspace_root, tmp_path):
        if shutil.which("pandoc") is None:
            pytest.skip("pandoc not installed")
        specs_root = tmp_path / "central-specs"
        spec = specs_root / "archive" / "12-old-spec"
        spec.mkdir(parents=True)
        for name in ("1-description.md", "2-analysis.md", "3-solution.md", "4-status.md"):
            (spec / name).write_text(f"# {name}\n\nContent.\n")

        # The project points at the external specs root via .aide/config —
        # the AIDE_SPECS_PATH environment variable is retired (spec 73).
        project = tmp_path / "project"
        (project / ".aide").mkdir(parents=True)
        (project / ".aide" / "config").write_text(f"AIDE_SPECS_PATH={specs_root}\n")

        result = subprocess.run(
            [str(workspace_root / "core" / "scripts" / "aide-generate-html"), "12"],
            capture_output=True,
            text=True,
            env={"PATH": os.environ["PATH"], "HOME": os.environ["HOME"]},
            cwd=project,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        assert (spec / "12-old-spec.html").exists(), (
            "the HTML must land inside the archived spec's own folder"
        )


class TestInstallAgentsSkills:
    """The shared skills installer must refuse to run without its source dir.

    On 2026-08-13 the lib was sourced from a shell where BASH_SOURCE was
    empty, _CORE_SKILLS_DIR resolved to "", and the "$_CORE_SKILLS_DIR"/*/
    glob expanded to the ROOT directories — the installer started copying
    /Applications into ~/.agents/skills/. The functions must fail fast when
    the resolved source directory does not exist.
    """

    def test_install_fails_fast_when_source_dir_is_invalid(self, workspace_root, tmp_path):
        installer = workspace_root / "core" / "scripts" / "_install-skills.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        result = subprocess.run(
            ["bash", "-c",
             f'source "{installer}"; _CORE_SKILLS_DIR=/nonexistent; install_agents_skills'],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode != 0, (
            "install_agents_skills must refuse to run when the skills source "
            "dir is missing, instead of globbing whatever the path expands to"
        )
        assert not (tmp_path / ".agents" / "skills").exists(), \
            "nothing may be created when the source dir is invalid"

    def test_uninstall_fails_fast_when_source_dir_is_invalid(self, workspace_root, tmp_path):
        installer = workspace_root / "core" / "scripts" / "_install-skills.sh"
        env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
        result = subprocess.run(
            ["bash", "-c",
             f'source "{installer}"; _CORE_SKILLS_DIR=/nonexistent; uninstall_agents_skills'],
            capture_output=True,
            text=True,
            env=env,
        )
        assert result.returncode != 0


# ssh runs a NON-INTERACTIVE shell, which on macOS reads neither .zprofile,
# .zshrc nor .bash_profile — so a tool in /opt/homebrew/bin, /usr/local/bin
# or ~/.local/bin is "command not found" over ssh while a person sitting at
# the machine finds it. install_shell_path writes the one file each shell
# does read (spec 175).
PATH_DIRS = ("/opt/homebrew/bin", "/usr/local/bin", "$HOME/.local/bin")
PATH_BLOCK_MARKER = "aide PATH"


def _source_install_bin(workspace_root, home, function):
    installer = workspace_root / "core" / "scripts" / "_install-bin.sh"
    return subprocess.run(
        ["bash", "-c", f'source "{installer}"; {function}'],
        capture_output=True,
        text=True,
        env={"PATH": os.environ["PATH"], "HOME": str(home)},
    )


@pytest.mark.validation
class TestInstallShellPath:
    """The PATH block must reach both dotfiles without damaging either."""

    def test_writes_the_stable_dirs_to_both_files(self, workspace_root, tmp_path):
        result = _source_install_bin(workspace_root, tmp_path, "install_shell_path")
        assert result.returncode == 0, result.stderr
        for name in (".zshenv", ".bashrc"):
            content = (tmp_path / name).read_text()
            for directory in PATH_DIRS:
                assert directory in content, f"~/{name} does not put {directory} on PATH"

    def test_keeps_what_the_files_already_had(self, workspace_root, tmp_path):
        (tmp_path / ".zshenv").write_text("export MINE=1\n")
        (tmp_path / ".bashrc").write_text("export MINE=2\n")

        result = _source_install_bin(workspace_root, tmp_path, "install_shell_path")
        assert result.returncode == 0, result.stderr

        zshenv = (tmp_path / ".zshenv").read_text()
        bashrc = (tmp_path / ".bashrc").read_text()
        assert "export MINE=1" in zshenv
        assert "export MINE=2" in bashrc
        # A .bashrc commonly opens with a non-interactive early return, so a
        # block appended after it would never run for the ssh case this
        # exists to fix. .zshenv has no such guard.
        assert zshenv.index("export MINE=1") < zshenv.index(PATH_BLOCK_MARKER), \
            "the block must come after existing content in ~/.zshenv"
        assert bashrc.index(PATH_BLOCK_MARKER) < bashrc.index("export MINE=2"), \
            "the block must come before existing content in ~/.bashrc"

    def test_a_file_without_a_trailing_newline_is_not_corrupted(
        self, workspace_root, tmp_path
    ):
        (tmp_path / ".zshenv").write_text("export MINE=1")  # no trailing newline

        result = _source_install_bin(workspace_root, tmp_path, "install_shell_path")
        assert result.returncode == 0, result.stderr

        lines = (tmp_path / ".zshenv").read_text().splitlines()
        assert "export MINE=1" in lines, \
            "the block was glued onto the file's last line instead of starting its own"

    def test_a_second_install_does_not_duplicate_the_block(self, workspace_root, tmp_path):
        for _ in range(2):
            result = _source_install_bin(workspace_root, tmp_path, "install_shell_path")
            assert result.returncode == 0, result.stderr

        for name in (".zshenv", ".bashrc"):
            content = (tmp_path / name).read_text()
            assert content.count(PATH_BLOCK_MARKER) == 2, \
                f"~/{name} has more than one aide block: {content}"

    def test_sourcing_the_file_twice_does_not_grow_path(self, workspace_root, tmp_path):
        assert _source_install_bin(
            workspace_root, tmp_path, "install_shell_path"
        ).returncode == 0

        zshenv = tmp_path / ".zshenv"
        result = subprocess.run(
            ["bash", "-c", f'source "{zshenv}"; source "{zshenv}"; printf "%s" "$PATH"'],
            capture_output=True,
            text=True,
            env={"PATH": "/usr/bin:/bin", "HOME": str(tmp_path)},
        )
        assert result.returncode == 0, result.stderr
        entries = result.stdout.split(":")
        for directory in ("/opt/homebrew/bin", "/usr/local/bin", f"{tmp_path}/.local/bin"):
            assert entries.count(directory) == 1, \
                f"{directory} appears {entries.count(directory)} times in PATH: {result.stdout}"

    def test_uninstall_removes_the_block_and_leaves_the_rest(
        self, workspace_root, tmp_path
    ):
        (tmp_path / ".zshenv").write_text("export MINE=1\n")
        (tmp_path / ".bashrc").write_text("export MINE=2\n")
        assert _source_install_bin(
            workspace_root, tmp_path, "install_shell_path"
        ).returncode == 0

        result = _source_install_bin(workspace_root, tmp_path, "uninstall_shell_path")
        assert result.returncode == 0, result.stderr

        for name, kept in ((".zshenv", "export MINE=1"), (".bashrc", "export MINE=2")):
            content = (tmp_path / name).read_text()
            assert PATH_BLOCK_MARKER not in content, f"~/{name} still carries the block"
            assert kept in content, f"uninstall dropped unrelated content from ~/{name}"

    def test_the_block_names_stable_directories_only(self, workspace_root, tmp_path):
        assert _source_install_bin(
            workspace_root, tmp_path, "install_shell_path"
        ).returncode == 0

        block = (tmp_path / ".zshenv").read_text()
        # A versioned path (mise's bun install dir, say) rots at the next
        # upgrade; the deploy scripts name such tools by full path instead.
        assert "mise" not in block, "the block hardcodes a mise install path"
        assert not re.search(r"/\d+\.\d+", block), \
            f"the block hardcodes a version-numbered directory:\n{block}"


@pytest.mark.validation
class TestInstallersWireUpShellPath:
    """Every installer writes the block; no individual uninstaller removes it."""

    @staticmethod
    def _run(workspace_root, tool, script, home, stdin=None):
        return subprocess.run(
            [str(workspace_root / "implementations" / tool / script)],
            input=stdin,
            capture_output=True,
            text=True,
            env={"PATH": "/usr/bin:/bin", "HOME": str(home)},
            stdin=subprocess.DEVNULL if stdin is None else None,
            timeout=180,
        )

    def test_the_installer_writes_the_block(self, workspace_root, tmp_path):
        result = self._run(workspace_root, "claude-code", "install.sh", home=tmp_path)
        assert result.returncode == 0, result.stdout + result.stderr
        for name in (".zshenv", ".bashrc"):
            assert PATH_BLOCK_MARKER in (tmp_path / name).read_text(), \
                f"install.sh left ~/{name} without the PATH block"

    def test_the_path_hint_does_not_send_the_reader_to_zshrc(self, workspace_root):
        # .zshrc and .bash_profile are read by INTERACTIVE shells only —
        # telling the reader to edit them fixes everything except ssh.
        for tool in ("claude-code", "codex", "copilot"):
            installer = workspace_root / "implementations" / tool / "install.sh"
            text = installer.read_text()
            for wrong in (".zshrc", ".bash_profile"):
                assert wrong not in text, \
                    f"{tool}/install.sh still points the reader at {wrong}"

    def test_an_individual_uninstall_keeps_the_block(self, workspace_root, tmp_path):
        result = self._run(workspace_root, "claude-code", "install.sh", home=tmp_path)
        assert result.returncode == 0, result.stdout + result.stderr

        result = self._run(
            workspace_root, "claude-code", "uninstall.sh", home=tmp_path, stdin="y\n"
        )
        assert result.returncode == 0, result.stdout + result.stderr
        for name in (".zshenv", ".bashrc"):
            assert PATH_BLOCK_MARKER in (tmp_path / name).read_text(), (
                f"claude-code/uninstall.sh removed the PATH block from ~/{name} — "
                "the other tools still need it; only uninstall-all.sh may remove it"
            )

    def test_uninstall_all_removes_the_block(self, workspace_root, tmp_path):
        assert _source_install_bin(
            workspace_root, tmp_path, "install_shell_path"
        ).returncode == 0

        result = subprocess.run(
            [str(workspace_root / "uninstall-all.sh")],
            input="y\ny\ny\n",
            capture_output=True,
            text=True,
            env={"PATH": "/usr/bin:/bin", "HOME": str(tmp_path)},
            timeout=180,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        for name in (".zshenv", ".bashrc"):
            assert PATH_BLOCK_MARKER not in (tmp_path / name).read_text(), \
                f"uninstall-all.sh left the PATH block in ~/{name}"
