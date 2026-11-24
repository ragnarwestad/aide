"""Tests for report_opencode_login in core/implementations/opencode/_login-check.sh —
the installer's last step, which says whether OpenCode has a provider logged
in and, when it has none, how to log one in.

opencode is a function handed down to the script, printing what the CLI's
`auth list` prints.
"""

import subprocess

import pytest


@pytest.fixture
def helper(workspace_root):
    return workspace_root / "core" / "implementations" / "opencode" / "_login-check.sh"


def _run(helper, auth_list_output=None, home="/nonexistent"):
    env = {"PATH": "/usr/bin:/bin:/opt/homebrew/bin", "HOME": str(home)}
    if auth_list_output is not None:
        env["BASH_FUNC_opencode%%"] = (
            f'() {{ [ "$1 $2" = "auth list" ] && printf %b {auth_list_output!r}; }}'
        )
    return subprocess.run(
        ["bash", "-c", f'source "{helper}"; report_opencode_login'],
        capture_output=True, text=True, env=env, timeout=30,
    )


class TestReportOpencodeLogin:
    @pytest.mark.parametrize("output", [
        "Credentials\n0 credentials\n",
        "No authenticated integrations\n",
    ])
    def test_no_provider_is_reported_with_the_login_command(self, helper, output):
        result = _run(helper, output)

        assert "No provider is logged in" in result.stdout
        assert "opencode auth login" in result.stdout
        assert "Claude Agent" in result.stdout

    def test_a_stored_credential_is_reported_as_configured(self, helper):
        result = _run(helper, "OpenCode Console  API key  stored\n")

        assert "At least one provider is configured" in result.stdout
        assert "No provider" not in result.stdout

    def test_a_provider_set_up_only_in_the_config_needs_no_login(self, helper, tmp_path):
        """A provider in opencode.json, such as a local Ollama, offers its
        models without a login (OpenCode 2.4.1)."""
        config = tmp_path / ".config" / "opencode" / "opencode.json"
        config.parent.mkdir(parents=True)
        config.write_text('{"provider": {"ollama": {"options": {"baseURL": "http://localhost:11434/v1"}}}}')

        result = _run(helper, "No authenticated integrations\n", home=tmp_path)

        assert "At least one provider is configured" in result.stdout
        assert "No provider" not in result.stdout

    def test_without_opencode_nothing_is_claimed_about_providers(self, helper):
        result = _run(helper)

        assert "configured" not in result.stdout
        assert "No provider" not in result.stdout
