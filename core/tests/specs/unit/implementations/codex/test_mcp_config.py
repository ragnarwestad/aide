"""The MCP servers the Codex installer offers land in a table Codex reads.

Codex reads MCP servers from `[mcp_servers.<name>]` tables in
~/.codex/config.toml. The installer offers each addition through one routine,
lib/optional-mcp.sh, which appends the snippet file in
core/implementations/codex/mcp/ to that file, and asks again whenever it cannot
find every one of the addition's server tables there.

The setup pages and the README copy the snippets as TOML examples. Each copy is
marked with `<!-- fragment: <snippet> -->` on the line before its fence, and
must say what the snippet says; the prose around it is free to change.
"""
import os
import re
import shlex
import subprocess

import pytest

# tomllib is in the standard library from Python 3.11; older interpreters skip this file.
tomllib = pytest.importorskip("tomllib")

SNIPPETS = {
    "browser-testing.toml": ["playwright", "chrome-devtools"],
    "context7.toml": ["context7"],
}

# Each page that copies a snippet, and the snippet it copies.
DOC_EXAMPLES = [
    ("README.md", "context7.toml"),
    ("mcp/BROWSER_TESTING_MCP_SETUP.md", "browser-testing.toml"),
    ("mcp/CONTEXT7_MCP_SETUP.md", "context7.toml"),
]

# A config a user already has: top-level keys, then a table of its own.
EXISTING = """model = "gpt-5"

[mcp_servers.node_repl]
command = "node"
"""

DOCS = "/docs/BROWSER_TESTING_MCP_SETUP.md"

EXAMPLE = re.compile(r"^<!-- fragment: (?P<name>\S+) -->\n```toml\n(?P<toml>.*?)^```", re.S | re.M)


def _codex(workspace_root):
    return workspace_root / "core" / "implementations" / "codex"


def _examples(markdown, snippet):
    return [m["toml"] for m in EXAMPLE.finditer(markdown) if m["name"] == snippet]


def _example_matches(markdown, snippet, snippet_text):
    examples = _examples(markdown, snippet)
    assert len(examples) == 1, f"expected one TOML example marked as {snippet}, found {len(examples)}"
    return tomllib.loads(examples[0]) == tomllib.loads(snippet_text)


def _offer(workspace_root, tmp_path, *, config=None, answer=None, tty=False,
           snippet="browser-testing.toml"):
    """Run the shared routine for one offering under `set -e`, as install.sh does."""
    cfg = tmp_path / "codex" / "config.toml"
    if config is not None:
        cfg.parent.mkdir(parents=True, exist_ok=True)
        cfg.write_text(config)
    # A terminal is stood in for, since a sandbox may have no pty to give: with
    # tty=True the routine is told someone is at the keyboard, and reads the
    # answer from the pipe.
    can_ask = "optional_mcp_can_ask() { true; }; " if tty else ""
    script = f'set -e; source "$1"; shift; {can_ask}offer_optional_mcp "$@"; echo "configured=$MCP_CONFIGURED"'
    args = [
        "bash", "-c", script, "bash", str(_codex(workspace_root) / "lib" / "optional-mcp.sh"),
        str(cfg), "Browser Testing MCP", "Playwright and Chrome DevTools",
        " ".join(SNIPPETS[snippet]), str(_codex(workspace_root) / "mcp" / snippet), DOCS,
        "Playwright & Chrome DevTools provide:", "- Browser automation",
    ]
    env = {**os.environ, "HOME": str(tmp_path)}
    stdin = f"{answer}\n" if answer is not None else None
    result = subprocess.run(args, input=stdin, capture_output=True, text=True, env=env, timeout=10)
    assert result.returncode == 0, result.stderr
    configured = result.stdout.strip().splitlines()[-1]
    return configured == "configured=true", cfg, result.stdout


def _offer_calls(workspace_root):
    """The arguments of every offer_optional_mcp call in install.sh, in order."""
    install = (_codex(workspace_root) / "install.sh").read_text().replace("\\\n", " ")
    return [shlex.split(line)[1:] for line in install.splitlines()
            if line.strip().startswith("offer_optional_mcp ")]


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

@pytest.mark.codex
class TestInstallerOfferings:
    def test_both_offerings_go_through_the_one_routine_AC_1(self, workspace_root):
        install = (_codex(workspace_root) / "install.sh").read_text()
        assert 'source "$SCRIPT_DIR/lib/optional-mcp.sh"' in install
        assert len(_offer_calls(workspace_root)) == 2
        # Detection, prompting and appending live in the routine, not beside the calls.
        assert "read -r" not in install
        assert "-t 0" not in install
        assert ">>" not in install

    def test_each_offering_supplies_its_own_servers_snippet_and_page_in_order_AC_2_AC_5_AC_8(
            self, workspace_root):
        calls = _offer_calls(workspace_root)
        assert [os.path.basename(call[4]) for call in calls] == list(SNIPPETS)
        for call, (snippet, servers) in zip(calls, SNIPPETS.items()):
            config, name, label, server_names, fragment, docs, *intro = call
            assert config == "$CODEX_CONFIG_FILE"
            assert name and label and intro
            assert server_names.split() == servers
            assert fragment == f"$SCRIPT_DIR/mcp/{snippet}"
            page = docs.replace("$WORKSPACE_ROOT", str(workspace_root))
            assert page.startswith(str(_codex(workspace_root) / "mcp")) and os.path.isfile(page)


@pytest.mark.codex
class TestOptionalMcpRoutine:
    @pytest.mark.parametrize("tables,configured", [
        (["playwright"], False),
        (["chrome-devtools"], False),
        (["playwright", "chrome-devtools"], True),
    ])
    def test_browser_testing_is_configured_only_with_both_servers_AC_3(
            self, workspace_root, tmp_path, tables, configured):
        config = EXISTING + "".join(f'\n[mcp_servers.{t}]\ncommand = "npx"\n' for t in tables)
        result, cfg, _ = _offer(workspace_root, tmp_path, config=config)
        assert result is configured
        assert cfg.read_text() == config

    def test_without_a_terminal_nothing_is_read_or_appended_AC_4(self, workspace_root, tmp_path):
        configured, cfg, _ = _offer(workspace_root, tmp_path, config=EXISTING, answer="y\n")
        assert configured is False
        assert cfg.read_text() == EXISTING

    @pytest.mark.parametrize("snippet", SNIPPETS)
    def test_accepting_appends_the_snippet_unchanged_and_names_its_page_AC_1_AC_5(
            self, workspace_root, tmp_path, snippet):
        configured, cfg, out = _offer(workspace_root, tmp_path, config=EXISTING, answer="y",
                                      tty=True, snippet=snippet)
        assert configured is True
        assert cfg.read_text() == EXISTING + (_codex(workspace_root) / "mcp" / snippet).read_text()
        assert DOCS in out

    def test_accepting_creates_a_missing_config_AC_5(self, workspace_root, tmp_path):
        configured, cfg, _ = _offer(workspace_root, tmp_path, answer="Y", tty=True)
        assert configured is True
        assert cfg.read_text() == (_codex(workspace_root) / "mcp" / "browser-testing.toml").read_text()

    @pytest.mark.parametrize("answer", ["n", ""])
    def test_declining_or_the_default_leaves_the_config_and_names_the_page_AC_5(
            self, workspace_root, tmp_path, answer):
        configured, cfg, out = _offer(workspace_root, tmp_path, config=EXISTING, answer=answer, tty=True)
        assert configured is False
        assert cfg.read_text() == EXISTING
        assert DOCS in out


@pytest.mark.codex
class TestDocumentedExamples:
    @pytest.mark.parametrize("page,snippet", DOC_EXAMPLES)
    def test_the_page_copies_its_snippet_AC_6(self, workspace_root, page, snippet):
        markdown = (_codex(workspace_root) / page).read_text()
        snippet_text = (_codex(workspace_root) / "mcp" / snippet).read_text()
        assert _example_matches(markdown, snippet, snippet_text), f"{page} no longer matches mcp/{snippet}"

    @pytest.mark.parametrize("page,snippet", DOC_EXAMPLES)
    def test_a_changed_value_in_the_copy_is_caught_AC_6(self, workspace_root, page, snippet):
        markdown = (_codex(workspace_root) / page).read_text()
        snippet_text = (_codex(workspace_root) / "mcp" / snippet).read_text()
        example = _examples(markdown, snippet)[0]
        drifted = markdown.replace(example, example.replace('command = "npx"', 'command = "bunx"', 1))
        assert drifted != markdown
        assert not _example_matches(drifted, snippet, snippet_text)

    def test_prose_and_other_examples_around_the_copy_are_free_to_change_AC_7(self, workspace_root):
        page = _codex(workspace_root) / "mcp" / "BROWSER_TESTING_MCP_SETUP.md"
        markdown = page.read_text()
        snippet_text = (_codex(workspace_root) / "mcp" / "browser-testing.toml").read_text()
        edited = (
            "A new opening paragraph.\n\n"
            + markdown.replace("Add to `~/.codex/config.toml`:", "Put this in your Codex config:")
            .replace('command = "playwright-mcp"', 'command = "something-else"')
        )
        assert edited.count("something-else") == 1
        assert _example_matches(edited, "browser-testing.toml", snippet_text)
