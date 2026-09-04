"""What the installers generate rather than copy: AGENTS.md, the
spec-structure skill, the skills each tool reads, and a spec rendered as
HTML.

Split out of test_core_scripts.py 2026-09-04 (1064 lines); the tests are
unchanged and keep their names.
"""

import os
import re
import shutil
import subprocess
from pathlib import Path
import pytest
from tests.specs.unit.core.validation.test_templates import structure_block

from .test_core_scripts import _scripts


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
