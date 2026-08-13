"""Behaviour tests for core/scripts/_aide-report-lib.sh.

The library must work with ANY JIRA project key, not just the PROJ- example
prefix it was extracted with. A JIRA key is uppercase letters/digits, a
hyphen, and a number: PROJ-7637, MEL-123, AB2-9.
"""
import subprocess

import pytest


def _call(workspace_root, snippet, env=None):
    """Source the library and run a snippet, returning stripped stdout."""
    lib = workspace_root / "core" / "scripts" / "_aide-report-lib.sh"
    result = subprocess.run(
        ["bash", "-c", f'source "{lib}"; {snippet}'],
        capture_output=True,
        text=True,
        env=env,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


@pytest.fixture
def reports_root(tmp_path):
    """A reports root with one JIRA folder per prefix style and one TODO."""
    for folder in [
        "05-proj-7894-class-to-functional",
        "17-clean-up-console-log",
        "35-todo-ai-nyheter",
        "45-MEL-1234-fix-login",
    ]:
        (tmp_path / folder).mkdir()
    return tmp_path


@pytest.mark.validation
class TestResolveReport:
    """aide_resolve_report must find folders for any JIRA key."""

    def test_resolves_example_prefix(self, workspace_root, reports_root):
        out = _call(
            workspace_root,
            f'aide_resolve_report "PROJ-7894" "{reports_root}"',
        )
        assert out == "05-proj-7894-class-to-functional"

    def test_resolves_other_prefix(self, workspace_root, reports_root):
        out = _call(
            workspace_root,
            f'aide_resolve_report "MEL-1234" "{reports_root}"',
        )
        assert out == "45-MEL-1234-fix-login"

    def test_number_shorthand_still_works(self, workspace_root, reports_root):
        out = _call(
            workspace_root,
            f'aide_resolve_report "17" "{reports_root}"',
        )
        assert out == "17-clean-up-console-log"

    def test_todo_shorthand_still_works(self, workspace_root, reports_root):
        out = _call(
            workspace_root,
            f'aide_resolve_report "todo-35" "{reports_root}"',
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
