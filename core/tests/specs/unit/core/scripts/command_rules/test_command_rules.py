"""The command rules Claude Code and Codex both run before a shell command.

Each rule is one script under core/scripts/lib/command-rules/, installed to
~/.local/bin/lib/command-rules/ by every tool's installer. Both tools' hook
configs call that installed copy with the PreToolUse payload on stdin; exit 2
with a reason on stderr refuses the command.
"""
import json
import os
import shlex
import subprocess

import pytest

RULES = ("block-git-add-all.sh", "block-watch-mode.sh")
INSTALLED = "$HOME/.local/bin/lib/command-rules/"
SYSTEM_PATH = "/usr/bin:/bin"

REFUSED = {
    "block-git-add-all.sh": ["git add .", "cd repo && git add -A"],
    "block-watch-mode.sh": [
        "pnpm test", "vitest", "jest --watch", "./gradlew test --continuous",
        "cargo watch -x test", "ptw", "pytest-watch",
    ],
}
ALLOWED = {
    "block-git-add-all.sh": ["git add docs/README.md", "ls -la"],
    "block-watch-mode.sh": [
        "pnpm test -- --run foo.test.ts", "pnpm run build", "npx vitest run country.test.ts",
        "python -m pytest -q", "./gradlew test",
    ],
}

# What the refusal names, for the commands whose reason the user acts on.
REASON = {"git add .": "git add", "cd repo && git add -A": "git add", "pnpm test": "--run"}

# Text only a command rule carries: the git add regex and two watchers.
RULE_MARKERS = ("?add (", "cargo watch", "pytest-watch")


def _payload(command):
    return json.dumps({
        "session_id": "test-session",
        "cwd": "/tmp",
        "hook_event_name": "PreToolUse",
        "tool_name": "Bash",
        "tool_input": {"command": command},
    })


def run_rule(argv, command, env=None):
    """Run a rule with a PreToolUse payload on stdin, as both tools do."""
    return subprocess.run(
        argv, input=_payload(command), capture_output=True, text=True,
        env={**os.environ, **(env or {})}, timeout=30,
    )


@pytest.fixture
def rules_dir(workspace_root):
    return workspace_root / "core" / "scripts" / "lib" / "command-rules"


def _hook_configs(workspace_root):
    impl = workspace_root / "core" / "implementations"
    return {
        "claude": impl / "claude-code" / "hooks.json",
        "codex": impl / "codex" / "hooks" / "hooks.json",
    }


def _pre_tool_use_commands(config_path):
    config = json.loads(config_path.read_text())
    return [
        hook["command"]
        for group in config["hooks"].get("PreToolUse", [])
        if group.get("matcher") == "Bash"
        for hook in group["hooks"]
        if hook.get("type") == "command"
    ]


def _rule_scripts(commands):
    """The installed script each rule command runs, quotes taken off."""
    return sorted(shlex.split(c)[0] for c in commands if "/command-rules/" in c)


@pytest.mark.parametrize("rule,command", [(r, c) for r in RULES for c in REFUSED[r]])
def test_the_rule_refuses_what_it_refused_before_AC_1(rules_dir, rule, command):
    result = run_rule([str(rules_dir / rule)], command)
    assert result.returncode == 2, f"{rule} let through: {command}"
    assert result.stderr.startswith("Blocked:")
    assert REASON.get(command, "") in result.stderr


@pytest.mark.parametrize("rule,command", [(r, c) for r in RULES for c in ALLOWED[r]])
def test_the_rule_allows_what_it_allowed_before_AC_1(rules_dir, rule, command):
    result = run_rule([str(rules_dir / rule)], command)
    assert result.returncode == 0, f"{rule} refused: {command}\n{result.stderr}"


def test_both_tools_call_the_same_installed_rule_scripts_AC_1(workspace_root):
    expected = sorted(INSTALLED + rule for rule in RULES)
    for tool, path in _hook_configs(workspace_root).items():
        assert _rule_scripts(_pre_tool_use_commands(path)) == expected, tool


def test_each_rule_is_one_executable_file_AC_2(workspace_root, rules_dir):
    for rule in RULES:
        assert os.access(rules_dir / rule, os.X_OK), f"not executable: {rule}"
    impl = workspace_root / "core" / "implementations"
    copies = [
        str(path.relative_to(workspace_root))
        for path in impl.rglob("*")
        if path.is_file() and path.suffix in (".sh", ".json")
        and any(marker in path.read_text() for marker in RULE_MARKERS)
    ]
    assert copies == [], f"a command rule is written out again in {copies}"


def _install(workspace_root, home, folder):
    result = subprocess.run(
        [str(workspace_root / "core" / "implementations" / folder / "install.sh")],
        capture_output=True, text=True, env={"PATH": SYSTEM_PATH, "HOME": str(home)},
        stdin=subprocess.DEVNULL, timeout=180,
    )
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.validation
def test_the_installed_rules_refuse_and_allow_from_both_tools_AC_3(workspace_root, tmp_path):
    retired = tmp_path / ".codex" / "hooks"
    retired.mkdir(parents=True)
    for rule in RULES:
        (retired / f"aide-{rule}").write_text("#!/bin/sh\nexit 0\n")

    _install(workspace_root, tmp_path, "claude-code")
    _install(workspace_root, tmp_path, "codex")

    installed = tmp_path / ".local" / "bin" / "lib" / "command-rules"
    for rule in RULES:
        assert os.access(installed / rule, os.X_OK), f"not installed: {rule}"
        assert not (retired / f"aide-{rule}").exists(), f"retired copy kept: aide-{rule}"
    assert (retired / "aide-markdownlint.sh").exists()

    env = {"HOME": str(tmp_path), "PATH": SYSTEM_PATH}
    configs = {"claude": tmp_path / ".claude" / "settings.json", "codex": tmp_path / ".codex" / "hooks.json"}
    for tool, config in configs.items():
        commands = [c for c in _pre_tool_use_commands(config) if "/command-rules/" in c]
        assert _rule_scripts(commands) == sorted(INSTALLED + rule for rule in RULES), tool
        refused = [run_rule(["bash", "-c", c], "git add .", env).returncode for c in commands]
        allowed = [run_rule(["bash", "-c", c], "git add README.md", env).returncode for c in commands]
        assert 2 in refused, f"{tool}: git add . went through"
        assert allowed == [0, 0], f"{tool}: git add README.md refused"
