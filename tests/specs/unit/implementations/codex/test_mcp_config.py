"""The MCP servers the Codex installer offers land in a table Codex reads.

Codex reads MCP servers from `[mcp_servers.<name>]` tables in
~/.codex/config.toml. The installer appends the snippet files in
implementations/codex/mcp/ to that file, and asks again whenever it cannot
find the server's own table there.
"""
import re
import tomllib

import pytest

SNIPPETS = {
    "browser-testing.toml": ["playwright", "chrome-devtools"],
    "context7.toml": ["context7"],
}

# A config a user already has: top-level keys, then a table of its own.
EXISTING = """model = "gpt-5"

[mcp_servers.node_repl]
command = "node"
"""


def _codex(workspace_root):
    return workspace_root / "implementations" / "codex"


@pytest.mark.codex
class TestMcpConfig:
    @pytest.mark.parametrize("snippet,servers", SNIPPETS.items())
    def test_snippet_is_mcp_servers_tables(self, workspace_root, snippet, servers):
        parsed = tomllib.loads((_codex(workspace_root) / "mcp" / snippet).read_text())
        assert list(parsed) == ["mcp_servers"]
        assert sorted(parsed["mcp_servers"]) == sorted(servers)
        for name in servers:
            server = parsed["mcp_servers"][name]
            assert server["command"] == "npx"
            assert isinstance(server["args"], list) and server["args"]

    def test_appending_both_to_an_existing_config_still_parses(self, workspace_root):
        text = EXISTING + "".join((_codex(workspace_root) / "mcp" / s).read_text() for s in SNIPPETS)
        parsed = tomllib.loads(text)
        assert parsed["model"] == "gpt-5"
        assert sorted(parsed["mcp_servers"]) == ["chrome-devtools", "context7", "node_repl", "playwright"]

    def test_installer_appends_the_snippets_and_looks_for_their_tables(self, workspace_root):
        install = (_codex(workspace_root) / "install.sh").read_text()
        for snippet, servers in SNIPPETS.items():
            assert f'cat "$SCRIPT_DIR/mcp/{snippet}" >> "$CODEX_CONFIG_FILE"' in install
            for name in servers:
                assert f"grep -qF '[mcp_servers.{name}]'" in install
        assert not re.search(r"\[\[?mcp[.\]]", install), "the old [mcp] / [[mcp.servers]] form is back"
