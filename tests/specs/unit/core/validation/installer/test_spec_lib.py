"""Behaviour tests for core/scripts/_aide-spec-lib.sh.

The library must work with ANY JIRA project key, not just the PROJ- example
prefix it was extracted with. A JIRA key is uppercase letters/digits, a
hyphen, and a number: PROJ-7637, MEL-123, AB2-9.
"""
import subprocess

import pytest


def _call(workspace_root, snippet, env=None):
    """Source the library and run a snippet, returning stripped stdout."""
    lib = workspace_root / "core" / "scripts" / "_aide-spec-lib.sh"
    result = subprocess.run(
        ["bash", "-c", f'source "{lib}"; {snippet}'],
        capture_output=True,
        text=True,
        env=env,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


@pytest.fixture
def specs_root(tmp_path):
    """A specs root with one JIRA folder per prefix style and one TODO."""
    for folder in [
        "05-proj-7894-class-to-functional",
        "17-clean-up-console-log",
        "35-todo-ai-nyheter",
        "45-MEL-1234-fix-login",
    ]:
        (tmp_path / folder).mkdir()
    return tmp_path


@pytest.mark.validation
class TestSpecsRoot:
    """The specs root is PER-PROJECT config, never global state (spec 73).

    Contract: `aide_specs_root [project-root]` — root defaults to the git
    toplevel (cwd as fallback); `AIDE_SPECS_PATH` from the project's
    `.aide/config` wins; otherwise `<root>/specs`. The environment
    variable of the same name is retired: a set variable is IGNORED, so a
    stale export cannot leak one project's specs into another's root.
    """

    def _project(self, tmp_path, config_value=None):
        if config_value is not None:
            (tmp_path / ".aide").mkdir()
            (tmp_path / ".aide" / "config").write_text(
                f"AIDE_SPECS_PATH={config_value}\n"
            )
        return tmp_path

    def test_project_config_wins(self, workspace_root, tmp_path):
        root = self._project(tmp_path, "/somewhere/central-specs")
        out = _call(workspace_root, f'aide_specs_root "{root}"')
        assert out == "/somewhere/central-specs"

    def test_environment_variable_is_dead(self, workspace_root, tmp_path):
        root = self._project(tmp_path)
        out = _call(
            workspace_root, f'aide_specs_root "{root}"',
            env={"AIDE_SPECS_PATH": "/should/be/ignored", "PATH": "/usr/bin:/bin"},
        )
        assert out == f"{root}/specs", (
            "a set AIDE_SPECS_PATH environment variable must be ignored — "
            "the specs path is per-project config only"
        )

    def test_defaults_to_specs_under_the_project_root(self, workspace_root, tmp_path):
        root = self._project(tmp_path)
        out = _call(workspace_root, f'aide_specs_root "{root}"')
        assert out == f"{root}/specs"

    def test_without_argument_uses_the_git_toplevel(self, workspace_root, tmp_path):
        root = self._project(tmp_path, "/somewhere/central-specs")
        subprocess.run(["git", "init", "-q", str(root)], check=True)
        subdir = root / "src" / "deep"
        subdir.mkdir(parents=True)
        lib = workspace_root / "core" / "scripts" / "_aide-spec-lib.sh"
        result = subprocess.run(
            ["bash", "-c", f'cd "{subdir}" && source "{lib}"; aide_specs_root'],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "/somewhere/central-specs", (
            "run from a subdirectory, the project root must be the git "
            "toplevel so the config is still found"
        )


@pytest.mark.validation
class TestResolveSpec:
    """aide_resolve_spec must find folders for any JIRA key."""

    def test_resolves_example_prefix(self, workspace_root, specs_root):
        out = _call(
            workspace_root,
            f'aide_resolve_spec "PROJ-7894" "{specs_root}"',
        )
        assert out == "05-proj-7894-class-to-functional"

    def test_resolves_other_prefix(self, workspace_root, specs_root):
        out = _call(
            workspace_root,
            f'aide_resolve_spec "MEL-1234" "{specs_root}"',
        )
        assert out == "45-MEL-1234-fix-login"

    def test_number_shorthand_still_works(self, workspace_root, specs_root):
        out = _call(
            workspace_root,
            f'aide_resolve_spec "17" "{specs_root}"',
        )
        assert out == "17-clean-up-console-log"

    def test_todo_shorthand_still_works(self, workspace_root, specs_root):
        out = _call(
            workspace_root,
            f'aide_resolve_spec "todo-35" "{specs_root}"',
        )
        assert out == "35-todo-ai-nyheter"


@pytest.mark.validation
class TestDocType:
    """aide_doc_type must recognize a JIRA key regardless of its prefix."""

    @pytest.mark.parametrize(
        "folder",
        [
            "05-proj-7894-class-to-functional",
            "45-MEL-1234-fix-login",
            "45-mel-1234-fix-login",
            "archive/45-MEL-1234-fix-login",
        ],
    )
    def test_jira_folders(self, workspace_root, folder):
        assert _call(workspace_root, f'aide_doc_type "{folder}"') == "JIRA issue"

    @pytest.mark.parametrize(
        "folder",
        [
            "17-clean-up-console-log",
            "35-todo-ai-nyheter",
            "13-upgrade-react-17-to-react-18",
        ],
    )
    def test_todo_folders(self, workspace_root, folder):
        assert _call(workspace_root, f'aide_doc_type "{folder}"') == "TODO plan"


@pytest.mark.validation
class TestArchiveAwareness:
    """Archived specs keep their number and stay findable.

    Archiving moves NN-slug into archive/ unchanged. Numbering must scan
    archive/ too — otherwise archiving the highest-numbered spec would
    make its number get reused, and "spec 17" would become ambiguous.
    """

    def test_next_number_scans_root(self, workspace_root, specs_root):
        out = _call(workspace_root, f'aide_next_spec_number "{specs_root}"')
        assert out == "46"

    def test_next_number_scans_archive_too(self, workspace_root, specs_root):
        archive = specs_root / "archive"
        archive.mkdir()
        (archive / "88-archived-big-migration").mkdir()
        out = _call(workspace_root, f'aide_next_spec_number "{specs_root}"')
        assert out == "89"

    def test_next_number_on_empty_root(self, workspace_root, tmp_path):
        out = _call(workspace_root, f'aide_next_spec_number "{tmp_path}"')
        assert out == "01"

    def test_resolve_falls_back_to_archive(self, workspace_root, specs_root):
        archive = specs_root / "archive"
        archive.mkdir()
        (archive / "12-old-jira-PROJ-1111-cleanup").mkdir()
        out = _call(
            workspace_root,
            f'aide_resolve_spec "12" "{specs_root}"',
        )
        assert out == "archive/12-old-jira-PROJ-1111-cleanup"

    def test_resolve_prefers_root_over_archive(self, workspace_root, specs_root):
        archive = specs_root / "archive"
        archive.mkdir()
        (archive / "17-clean-up-console-log").mkdir()
        out = _call(
            workspace_root,
            f'aide_resolve_spec "17" "{specs_root}"',
        )
        assert out == "17-clean-up-console-log"


@pytest.mark.validation
class TestSlugFromTitle:
    """aide_slug_from_title (spec 433): the deterministic bash version of
    SKILL.md Step 3's slug rule, used by the no-AI create path so its
    folder name matches what an AI-run create would also choose. NOT the
    same one-liner run-spec-invocation.sh:122-124 builds for the AI
    prompt's own throwaway TODO-<slug> token — that one has no diacritic
    handling and is explicitly not the spec's folder slug.
    """

    def test_skill_mds_own_worked_example(self, workspace_root):
        out = _call(workspace_root, 'aide_slug_from_title "Clean up console.log"')
        assert out == "clean-up-console-log"

    def test_norwegian_diacritics_are_transliterated(self, workspace_root):
        out = _call(
            workspace_root,
            'aide_slug_from_title "Rydd opp i loggføring på østsiden"',
        )
        assert out == "rydd-opp-i-loggforing-pa-ostsiden"

    def test_an_all_non_ascii_title_falls_back_to_new_spec(self, workspace_root):
        out = _call(workspace_root, 'aide_slug_from_title "日本語"')
        assert out == "new-spec"


@pytest.mark.validation
class TestConfigGet:
    """aide_config_get reads a key from .aide/config in a given directory."""

    def test_reads_value(self, workspace_root, tmp_path):
        (tmp_path / ".aide").mkdir()
        (tmp_path / ".aide" / "config").write_text(
            "# project config\nAIDE_JIRA_BASE_URL=https://jira.mycompany.com\n"
        )
        out = _call(
            workspace_root,
            f'aide_config_get "AIDE_JIRA_BASE_URL" "{tmp_path}"',
        )
        assert out == "https://jira.mycompany.com"

    def test_missing_file_is_empty_not_error(self, workspace_root, tmp_path):
        out = _call(
            workspace_root,
            f'aide_config_get "AIDE_JIRA_BASE_URL" "{tmp_path}"',
        )
        assert out == ""

    def test_missing_key_is_empty(self, workspace_root, tmp_path):
        (tmp_path / ".aide").mkdir()
        (tmp_path / ".aide" / "config").write_text("AIDE_OTHER=x\n")
        out = _call(
            workspace_root,
            f'aide_config_get "AIDE_JIRA_BASE_URL" "{tmp_path}"',
        )
        assert out == ""


@pytest.mark.validation
class TestManifestGet:
    """aide_manifest_get reads a top-level scalar out of .aide/project.yaml.

    Spec 184: what travels with the repo lives in the manifest, so the
    runner has to be able to read the manifest — and the manifest is the
    COMMITTED file, unlike .aide/config, which the global ignore drops.
    Deliberately a sibling of aide_config_get rather than a YAML parser:
    a top-level scalar is one anchored sed away, and this machine's
    /bin/bash is 3.2, where collecting a nested block means a hand-written
    read loop with far more room for a silent misparse.
    """

    def _manifest(self, tmp_path, text):
        (tmp_path / ".aide").mkdir(exist_ok=True)
        (tmp_path / ".aide" / "project.yaml").write_text(text)

    def test_reads_a_scalar_value(self, workspace_root, tmp_path):
        self._manifest(tmp_path, "name: aide\nworktreeLinks: .venv dashboard/node_modules\n")
        out = _call(workspace_root, f'aide_manifest_get "worktreeLinks" "{tmp_path}"')
        assert out == ".venv dashboard/node_modules"

    def test_missing_file_is_empty_not_error(self, workspace_root, tmp_path):
        out = _call(workspace_root, f'aide_manifest_get "worktreeLinks" "{tmp_path}"')
        assert out == ""

    def test_missing_key_is_empty(self, workspace_root, tmp_path):
        self._manifest(tmp_path, "name: aide\ndescription: something\n")
        out = _call(workspace_root, f'aide_manifest_get "worktreeLinks" "{tmp_path}"')
        assert out == ""

    def test_extra_whitespace_around_the_value_is_trimmed(self, workspace_root, tmp_path):
        self._manifest(tmp_path, "worktreeLinks:    deps   \n")
        out = _call(workspace_root, f'aide_manifest_get "worktreeLinks" "{tmp_path}"')
        assert out == "deps"

    def test_a_nested_key_of_the_same_name_is_not_read(self, workspace_root, tmp_path):
        """Only TOP-LEVEL keys. An indented `worktreeLinks:` belongs to
        whatever block it sits in, and reading it would hand the runner a
        value nobody wrote for it."""
        self._manifest(tmp_path, "stack:\n  worktreeLinks: not-this\n")
        out = _call(workspace_root, f'aide_manifest_get "worktreeLinks" "{tmp_path}"')
        assert out == ""

    def test_a_key_with_no_value_is_empty(self, workspace_root, tmp_path):
        """`worktreeLinks:` with nothing after it is not a link named
        `""` — it is a key that says nothing, same as an absent one."""
        self._manifest(tmp_path, "worktreeLinks:\n")
        out = _call(workspace_root, f'aide_manifest_get "worktreeLinks" "{tmp_path}"')
        assert out == ""


@pytest.mark.validation
class TestResolveOverride:
    """aide_resolve_override CONFIG_KEY MANIFEST_KEY [project-root] (spec
    345): `.aide/config` wins when it sets the key, `.aide/project.yaml`
    is the fallback — the reverse of `aide_manifest_get`'s own
    manifest-wins precedence for `worktreeLinks`, because an install/test
    command legitimately differs per machine while a worktree link does
    not."""

    def test_config_only(self, workspace_root, tmp_path):
        (tmp_path / ".aide").mkdir()
        (tmp_path / ".aide" / "config").write_text("AIDE_TEST_CMD=echo from-config\n")
        out = _call(workspace_root, f'aide_resolve_override AIDE_TEST_CMD testCmd "{tmp_path}"')
        assert out == "echo from-config"

    def test_manifest_only(self, workspace_root, tmp_path):
        (tmp_path / ".aide").mkdir()
        (tmp_path / ".aide" / "project.yaml").write_text("testCmd: echo from-manifest\n")
        out = _call(workspace_root, f'aide_resolve_override AIDE_TEST_CMD testCmd "{tmp_path}"')
        assert out == "echo from-manifest"

    def test_both_set_config_wins(self, workspace_root, tmp_path):
        (tmp_path / ".aide").mkdir()
        (tmp_path / ".aide" / "config").write_text("AIDE_TEST_CMD=echo from-config\n")
        (tmp_path / ".aide" / "project.yaml").write_text("testCmd: echo from-manifest\n")
        out = _call(workspace_root, f'aide_resolve_override AIDE_TEST_CMD testCmd "{tmp_path}"')
        assert out == "echo from-config"

    def test_neither_is_empty(self, workspace_root, tmp_path):
        out = _call(workspace_root, f'aide_resolve_override AIDE_TEST_CMD testCmd "{tmp_path}"')
        assert out == ""


@pytest.mark.validation
class TestSpecDependencies:
    """aide_spec_dependencies reads the optional `Depends on:` line from a
    spec's OWN 1-description.md and echoes one identifier per line.

    The field is what `aide-run-spec` refuses on (spec 92): a spec queued
    while a spec it builds on is still unmerged would be analyzed against
    a main that does not contain it. An absent field is the normal case,
    so it must be silent — no output, no error, nothing for a caller to
    special-case.
    """

    def _spec(self, tmp_path, body):
        folder = tmp_path / "92-spec-depends-on-spec"
        folder.mkdir()
        (folder / "1-description.md").write_text(body)
        return folder

    def test_absent_field_yields_nothing(self, workspace_root, tmp_path):
        folder = self._spec(
            tmp_path,
            "# Title\n\n## Tracking info\n\n- **Task:** `92-x/`\n- **Created:** `2026-08-18`\n",
        )
        out = _call(
            workspace_root,
            f'aide_spec_dependencies "{tmp_path}" "{folder.name}"',
        )
        assert out == ""

    def test_absent_file_is_empty_not_error(self, workspace_root, tmp_path):
        (tmp_path / "92-no-description").mkdir()
        out = _call(
            workspace_root,
            f'aide_spec_dependencies "{tmp_path}" "92-no-description"',
        )
        assert out == ""

    def test_one_identifier(self, workspace_root, tmp_path):
        folder = self._spec(
            tmp_path, "## Tracking info\n\n- **Depends on:** 91\n"
        )
        out = _call(
            workspace_root,
            f'aide_spec_dependencies "{tmp_path}" "{folder.name}"',
        )
        assert out.splitlines() == ["91"]

    def test_comma_separated_identifiers(self, workspace_root, tmp_path):
        folder = self._spec(
            tmp_path,
            "## Tracking info\n\n- **Depends on:** 91, `88-other-thing`\n",
        )
        out = _call(
            workspace_root,
            f'aide_spec_dependencies "{tmp_path}" "{folder.name}"',
        )
        assert out.splitlines() == ["91", "88-other-thing"]

    def test_backticks_and_surrounding_whitespace_are_stripped(
        self, workspace_root, tmp_path
    ):
        folder = self._spec(
            tmp_path,
            "## Tracking info\n\n- **Depends on:**   `91-parallel-spec-runs` ,   88   \n",
        )
        out = _call(
            workspace_root,
            f'aide_spec_dependencies "{tmp_path}" "{folder.name}"',
        )
        assert out.splitlines() == ["91-parallel-spec-runs", "88"]

    def test_an_empty_field_yields_nothing(self, workspace_root, tmp_path):
        """A spec created from a template that carries the label with no
        value must not turn into a dependency on the empty string."""
        folder = self._spec(
            tmp_path, "## Tracking info\n\n- **Depends on:**\n- **Created:** `x`\n"
        )
        out = _call(
            workspace_root,
            f'aide_spec_dependencies "{tmp_path}" "{folder.name}"',
        )
        assert out == ""


@pytest.mark.validation
class TestAidesOwnWorktreeLinksTravelWithTheRepo:
    """Spec 184: aide's own migration, kept proven rather than done once.

    The links were in `.aide/config`, which a global ignore rule drops —
    so the two paths both of this repo's test commands live behind
    (`.venv` for pytest, `dashboard/node_modules` for the dashboard's
    suite) were lost every time the repo met a new machine, silently,
    because git says nothing about a file it ignores. They are in the
    committed manifest now.
    """

    def test_the_manifest_names_both_paths(self, workspace_root):
        out = _call(workspace_root, f'aide_manifest_get "worktreeLinks" "{workspace_root}"')
        assert out.split() == [".venv", "dashboard/node_modules"], (
            "aide's own .aide/project.yaml must name the two gitignored paths its "
            "test commands live behind — read by the same function aide-run-spec uses"
        )

    def test_the_manifest_is_what_a_run_would_read(self, workspace_root):
        """Not just present: WINNING. `.aide/config` may still carry the
        old spelling on a machine that has not been migrated, and the
        manifest is the file that has to decide."""
        manifest = (workspace_root / ".aide" / "project.yaml").read_text(encoding="utf-8")
        assert "worktreeLinks: .venv dashboard/node_modules" in manifest
