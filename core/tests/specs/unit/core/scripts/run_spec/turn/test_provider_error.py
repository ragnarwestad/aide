"""What the provider said when a turn ended `cli-error`, sorted for the board:
`login` when the tool is not logged in on the machine, `provider` when the
provider's own side failed, `other` for anything else, each with the
provider's own first line, cleaned and cut short.

The messages are the ones real Claude Code and Codex runs ended on.
"""

import json
import subprocess
from pathlib import Path

import pytest

LIB = Path(__file__).resolve().parents[8] / "core" / "scripts" / "lib" / "run-spec" / "turn" / "provider-error.sh"

CODEX_401 = (
    "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, "
    "url: https://api.openai.com/v1/responses, cf-ray: a37e466ae83c56bd-OSL, "
    "request id: req_d2183b7f06a740ca8ecefb3b36ed5fbf"
)
CLAUDE_NOT_LOGGED_IN = "Not logged in · Please run /login"
CLAUDE_OAUTH_EXPIRED = "Failed to authenticate: OAuth session expired and could not be refreshed"
CLAUDE_500 = (
    "API Error: 500 Internal server error. This is a server-side issue, usually temporary — "
    "try again in a moment. If it persists, check https://status.claude.com."
)


def sorted_(said: str, status: str = "", kind: str = "") -> dict | None:
    out = subprocess.run(
        ["bash", "-c", f'source "{LIB}"; provider_error_json "$1" "$2" "$3"', "_", said, status, kind],
        capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout) if out.stdout.strip() else None


@pytest.mark.parametrize("said", [CODEX_401, CLAUDE_NOT_LOGGED_IN, CLAUDE_OAUTH_EXPIRED,
                                  "Invalid API key · Fix external API key",
                                  "unexpected status 403 Forbidden: your token has been revoked"])
def test_a_tool_that_is_not_logged_in_is_a_login_error(said):
    assert sorted_(said)["kind"] == "login"


def test_claude_s_own_error_name_says_login_without_the_words():
    assert sorted_("something went wrong", kind="authentication_failed")["kind"] == "login"


def test_a_401_status_says_login_without_the_words():
    assert sorted_("something went wrong", status="401")["kind"] == "login"


@pytest.mark.parametrize("said", [CLAUDE_500, "stream disconnected before completion: error sending request",
                                  "unexpected status 502 Bad Gateway", "API Error: 503 Service Unavailable"])
def test_a_failure_on_the_provider_s_side_is_a_provider_error(said):
    assert sorted_(said)["kind"] == "provider"


def test_a_5xx_status_says_provider_without_the_words():
    assert sorted_("something went wrong", status="500")["kind"] == "provider"
    assert sorted_("something went wrong", kind="server_error")["kind"] == "provider"


def test_digits_inside_an_id_are_not_a_status():
    """A request id or a cf-ray is hex: a 401 or a 500 inside one says nothing."""
    said = "the model refused the turn, request id: req_4015003ab, cf-ray: a3500401-OSL"
    assert sorted_(said)["kind"] == "other"


def test_anything_else_is_other_with_its_own_first_line():
    got = sorted_("  the model refused the turn  \nstack trace line 1\nline 2")
    assert got == {"kind": "other", "message": "the model refused the turn"}


def test_the_first_line_is_cut_at_a_word_with_an_ellipsis():
    said = "word " * 60
    message = sorted_(said)["message"]
    assert len(message) <= 161
    assert message.endswith("word…"), message


def test_a_dash_and_a_closing_full_stop_are_taken_out_of_the_cause():
    """The board puts its own full stop and its own dash after the cause."""
    assert sorted_("it broke — badly.")["message"] == "it broke, badly"


def test_terminal_colours_are_taken_out():
    assert sorted_("\u001b[31mError:\u001b[0m it broke")["message"] == "Error: it broke"


def test_nothing_said_is_nothing_sorted():
    assert sorted_("") is None
    assert sorted_("   \n  ") is None
