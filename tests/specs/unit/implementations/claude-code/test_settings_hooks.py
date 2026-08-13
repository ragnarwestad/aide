"""Parity checks on the hooks in implementations/claude-code/settings.json.

The same guards exist twice — as Claude Code hooks in settings.json and
as Codex hook scripts. Both carry an E grade in the support matrix, so
their pattern sets must not drift apart silently (spec 75). The Codex
scripts are exercised directly by test_hooks.py; this file pins the
settings.json side to the same coverage.
"""
import json
from pathlib import Path

import pytest

SETTINGS = Path(__file__).parents[5] / "implementations" / "claude-code" / "settings.json"

# The toolchain coverage both hook implementations must share.
WATCHER_MARKERS = ["vitest", "--watch", "--continuous", "cargo watch", "ptw"]
SOURCE_EXTENSIONS = [".py", ".go", ".rs", ".rb", ".swift", ".mjs"]
TEST_COMMAND_MARKERS = ["pytest", "go test", "cargo test", "gradle"]


def _hooks(event):
    config = json.loads(SETTINGS.read_text())
    return [
        hook
        for group in config["hooks"].get(event, [])
        for hook in group["hooks"]
    ]


@pytest.mark.claude_code
class TestWatchModeHookCoverage:
    def test_watch_block_covers_the_supported_toolchains(self):
        commands = " ".join(
            h["command"] for h in _hooks("PreToolUse") if h["type"] == "command"
        )
        missing = [m for m in WATCHER_MARKERS if m not in commands]
        assert not missing, (
            f"settings.json watch-mode hook lacks watcher patterns {missing} "
            "that the Codex hook blocks — the two implementations must match"
        )


@pytest.mark.claude_code
class TestStopHookCoverage:
    def test_stop_prompt_covers_the_supported_toolchains(self):
        prompts = " ".join(
            h["prompt"] for h in _hooks("Stop") if h["type"] == "prompt"
        )
        missing = [m for m in SOURCE_EXTENSIONS + TEST_COMMAND_MARKERS
                   if m not in prompts]
        assert not missing, (
            f"settings.json Stop prompt lacks {missing} — the Codex Stop "
            "guard covers them, so the Claude Code side must too"
        )
