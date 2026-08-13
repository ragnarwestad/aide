"""Tests for the Codex port of the four Claude Code hooks.

Claude Code enforces four behaviors via hooks in
implementations/claude-code/settings.json: markdownlint on edited markdown,
blocking `git add .`/`git add -A`, blocking watch-mode test runs, and a Stop
guard that refuses to end a turn where source code changed without tests.
Codex only has command hooks (no prompt hooks), so the Stop guard is two
scripts: one marks "code changed"/"tests run" per turn, one blocks Stop.
"""
import json
import subprocess

import pytest

HOOKS_DIR_NAME = "hooks"


@pytest.fixture
def hooks_dir(workspace_root):
    return workspace_root / "implementations" / "codex" / HOOKS_DIR_NAME


def run_hook(hooks_dir, script, payload, env=None):
    """Run a hook script with the payload on stdin, like Codex does."""
    import os

    full_env = dict(os.environ)
    if env:
        full_env.update(env)
    return subprocess.run(
        [str(hooks_dir / script)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=full_env,
        timeout=30,
    )


def payload(tool_name, tool_input, event="PostToolUse", **extra):
    base = {
        "session_id": "test-session",
        "turn_id": "test-turn",
        "cwd": "/tmp",
        "hook_event_name": event,
        "tool_name": tool_name,
        "tool_input": tool_input,
    }
    base.update(extra)
    return base


@pytest.mark.codex
class TestHooksJson:
    """hooks.json must wire all four behaviors to scripts that exist."""

    @pytest.fixture
    def config(self, hooks_dir):
        return json.loads((hooks_dir / "hooks.json").read_text())

    def _commands(self, config, event):
        return [
            hook["command"]
            for group in config["hooks"].get(event, [])
            for hook in group["hooks"]
        ]

    def test_pre_tool_use_blocks_are_wired_to_bash(self, config):
        groups = config["hooks"]["PreToolUse"]
        assert all(g["matcher"] == "Bash" for g in groups)
        commands = " ".join(self._commands(config, "PreToolUse"))
        assert "aide-block-git-add-all.sh" in commands
        assert "aide-block-watch-mode.sh" in commands

    def test_post_tool_use_covers_edits_and_bash(self, config):
        matchers = [g["matcher"] for g in config["hooks"]["PostToolUse"]]
        assert any("apply_patch" in m for m in matchers)
        assert any("Bash" in m for m in matchers)
        commands = " ".join(self._commands(config, "PostToolUse"))
        assert "aide-markdownlint.sh" in commands
        assert "aide-track-turn.sh" in commands

    def test_stop_guard_is_wired(self, config):
        commands = " ".join(self._commands(config, "Stop"))
        assert "aide-stop-guard.sh" in commands

    def test_referenced_scripts_exist_and_are_executable(self, config, hooks_dir):
        import os
        import re

        for event in config["hooks"]:
            for command in self._commands(config, event):
                match = re.search(r"(aide-[a-z-]+\.sh)", command)
                assert match, f"unrecognized hook command: {command}"
                script = hooks_dir / match.group(1)
                assert script.exists(), f"missing script: {script.name}"
                assert os.access(script, os.X_OK), f"not executable: {script.name}"

    def test_commands_point_at_the_installed_location(self, config):
        for event in config["hooks"]:
            for command in self._commands(config, event):
                assert command.startswith("$HOME/.codex/hooks/"), (
                    "hooks.json is installed to ~/.codex/hooks.json, so commands "
                    f"must reference ~/.codex/hooks/ — got: {command}"
                )


@pytest.mark.codex
class TestBlockGitAddAll:
    """Same rule as the Claude Code PreToolUse hook: explicit file names only."""

    def test_blocks_git_add_dot(self, hooks_dir):
        result = run_hook(
            hooks_dir,
            "aide-block-git-add-all.sh",
            payload("Bash", {"command": "git add ."}, event="PreToolUse"),
        )
        assert result.returncode == 2
        assert "git add" in result.stderr

    def test_blocks_git_add_dash_capital_a(self, hooks_dir):
        result = run_hook(
            hooks_dir,
            "aide-block-git-add-all.sh",
            payload("Bash", {"command": "cd repo && git add -A"}, event="PreToolUse"),
        )
        assert result.returncode == 2

    def test_allows_git_add_with_explicit_files(self, hooks_dir):
        result = run_hook(
            hooks_dir,
            "aide-block-git-add-all.sh",
            payload("Bash", {"command": "git add docs/README.md"}, event="PreToolUse"),
        )
        assert result.returncode == 0

    def test_allows_unrelated_commands(self, hooks_dir):
        result = run_hook(
            hooks_dir,
            "aide-block-git-add-all.sh",
            payload("Bash", {"command": "ls -la"}, event="PreToolUse"),
        )
        assert result.returncode == 0


@pytest.mark.codex
class TestBlockWatchMode:
    """Same rule as the Claude Code PreToolUse hook: single-run mode only."""

    def test_blocks_pnpm_test_without_run(self, hooks_dir):
        result = run_hook(
            hooks_dir,
            "aide-block-watch-mode.sh",
            payload("Bash", {"command": "pnpm test"}, event="PreToolUse"),
        )
        assert result.returncode == 2
        assert "--run" in result.stderr

    def test_allows_pnpm_test_with_run(self, hooks_dir):
        result = run_hook(
            hooks_dir,
            "aide-block-watch-mode.sh",
            payload("Bash", {"command": "pnpm test -- --run foo.test.ts"}, event="PreToolUse"),
        )
        assert result.returncode == 0

    def test_allows_unrelated_commands(self, hooks_dir):
        result = run_hook(
            hooks_dir,
            "aide-block-watch-mode.sh",
            payload("Bash", {"command": "pnpm run build"}, event="PreToolUse"),
        )
        assert result.returncode == 0

    @pytest.mark.parametrize("cmd", [
        "vitest",
        "npx vitest",
        "jest --watch",
        "vitest --watch src/",
        "./gradlew test --continuous",
        "cargo watch -x test",
        "ptw",
        "pytest-watch",
    ])
    def test_blocks_watchers_across_toolchains(self, hooks_dir, cmd):
        result = run_hook(
            hooks_dir,
            "aide-block-watch-mode.sh",
            payload("Bash", {"command": cmd}, event="PreToolUse"),
        )
        assert result.returncode == 2, f"watcher not blocked: {cmd}"

    @pytest.mark.parametrize("cmd", [
        "vitest run",
        "npx vitest run country.test.ts",
        "pytest",
        "python -m pytest -q",
        "go test ./...",
        "cargo test",
        "./gradlew test",
        "npm test",
    ])
    def test_allows_single_run_commands(self, hooks_dir, cmd):
        result = run_hook(
            hooks_dir,
            "aide-block-watch-mode.sh",
            payload("Bash", {"command": cmd}, event="PreToolUse"),
        )
        assert result.returncode == 0, f"valid command blocked: {cmd}"


@pytest.mark.codex
class TestMarkdownlint:
    """Lint markdown files after they are edited, exactly like the Claude hook.

    The lint command is overridable via AIDE_MARKDOWNLINT_CMD so the tests
    do not depend on npx.
    """

    LINT_ENV = {"AIDE_MARKDOWNLINT_CMD": "echo LINTED"}

    def test_lints_markdown_from_file_path(self, hooks_dir):
        result = run_hook(
            hooks_dir,
            "aide-markdownlint.sh",
            payload("Write", {"file_path": "docs/foo.md"}),
            env=self.LINT_ENV,
        )
        assert result.returncode == 0
        assert "LINTED docs/foo.md" in result.stdout

    def test_lints_markdown_from_apply_patch(self, hooks_dir):
        patch = (
            "*** Begin Patch\n"
            "*** Update File: docs/bar.md\n"
            "@@\n-old\n+new\n"
            "*** End Patch\n"
        )
        result = run_hook(
            hooks_dir,
            "aide-markdownlint.sh",
            payload("apply_patch", {"command": patch}),
            env=self.LINT_ENV,
        )
        assert result.returncode == 0
        assert "LINTED docs/bar.md" in result.stdout

    def test_ignores_non_markdown_files(self, hooks_dir):
        result = run_hook(
            hooks_dir,
            "aide-markdownlint.sh",
            payload("Write", {"file_path": "src/foo.ts"}),
            env=self.LINT_ENV,
        )
        assert result.returncode == 0
        assert "LINTED" not in result.stdout


@pytest.mark.codex
class TestStopGuard:
    """The Stop guard blocks a turn that changed source code without tests.

    aide-track-turn.sh marks the turn from PostToolUse payloads; the state
    lives under $TMPDIR, which the tests point at tmp_path.
    """

    def track(self, hooks_dir, tmp_path, tool_name, tool_input):
        result = run_hook(
            hooks_dir,
            "aide-track-turn.sh",
            payload(tool_name, tool_input),
            env={"TMPDIR": str(tmp_path)},
        )
        assert result.returncode == 0
        return result

    def stop(self, hooks_dir, tmp_path, stop_hook_active=False):
        return run_hook(
            hooks_dir,
            "aide-stop-guard.sh",
            payload(None, None, event="Stop", stop_hook_active=stop_hook_active),
            env={"TMPDIR": str(tmp_path)},
        )

    def decision(self, result):
        assert result.returncode == 0
        if not result.stdout.strip():
            return None
        return json.loads(result.stdout).get("decision")

    def test_blocks_when_code_changed_without_tests(self, hooks_dir, tmp_path):
        self.track(hooks_dir, tmp_path, "Write", {"file_path": "src/foo.ts"})
        result = self.stop(hooks_dir, tmp_path)
        assert self.decision(result) == "block"
        assert "reason" in json.loads(result.stdout)

    def test_allows_when_tests_were_run(self, hooks_dir, tmp_path):
        self.track(hooks_dir, tmp_path, "Write", {"file_path": "src/foo.ts"})
        self.track(hooks_dir, tmp_path, "Bash", {"command": "pnpm test -- --run"})
        assert self.decision(self.stop(hooks_dir, tmp_path)) is None

    def test_allows_when_only_markdown_changed(self, hooks_dir, tmp_path):
        self.track(hooks_dir, tmp_path, "Write", {"file_path": "docs/foo.md"})
        assert self.decision(self.stop(hooks_dir, tmp_path)) is None

    def test_allows_when_stop_hook_already_fired(self, hooks_dir, tmp_path):
        self.track(hooks_dir, tmp_path, "Write", {"file_path": "src/foo.ts"})
        result = self.stop(hooks_dir, tmp_path, stop_hook_active=True)
        assert self.decision(result) is None

    def test_tracks_code_change_inside_apply_patch(self, hooks_dir, tmp_path):
        patch = (
            "*** Begin Patch\n"
            "*** Update File: src/Component.tsx\n"
            "@@\n-old\n+new\n"
            "*** End Patch\n"
        )
        self.track(hooks_dir, tmp_path, "apply_patch", {"command": patch})
        assert self.decision(self.stop(hooks_dir, tmp_path)) == "block"

    def test_type_check_counts_as_verification(self, hooks_dir, tmp_path):
        self.track(hooks_dir, tmp_path, "Write", {"file_path": "src/foo.ts"})
        self.track(hooks_dir, tmp_path, "Bash", {"command": "npx tsc --noEmit"})
        assert self.decision(self.stop(hooks_dir, tmp_path)) is None

    @pytest.mark.parametrize("filename", [
        "app/main.py", "cmd/server.go", "src/lib.rs", "app/Model.rb",
        "Sources/App.swift", "src/index.mjs",
    ])
    def test_non_js_source_files_trigger_the_guard(self, hooks_dir, tmp_path, filename):
        self.track(hooks_dir, tmp_path, "Write", {"file_path": filename})
        result = self.stop(hooks_dir, tmp_path)
        assert self.decision(result) == "block", (
            f"editing {filename} without tests must block the stop"
        )

    def test_bun_test_counts_as_verification(self, hooks_dir, tmp_path):
        self.track(hooks_dir, tmp_path, "Write", {"file_path": "src/foo.ts"})
        self.track(hooks_dir, tmp_path, "Bash", {"command": "bun test"})
        assert self.decision(self.stop(hooks_dir, tmp_path)) is None
