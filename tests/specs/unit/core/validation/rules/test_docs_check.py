"""The command a documentation change runs, and the hook that runs it.

Fourteen tests read a page rather than the code, and they sit in both
suites — `scripts/check-docs` is the one command that runs exactly those.
The hook is what makes it happen without being remembered: a push
straight to `main` has no landing in front of it and no CI, which runs on
a pull request only.

What these hold onto is the pairing. A hook that stopped calling the
script, or a script that stopped running one of the two halves, would
leave a push to main with nothing reading the pages it changes.
"""
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[6]
SCRIPT = ROOT / "scripts" / "check-docs"
HOOK = ROOT / ".githooks" / "pre-push"


@pytest.fixture
def script_text():
    assert SCRIPT.exists(), "scripts/check-docs is gone — a doc change has no command of its own"
    return SCRIPT.read_text(encoding="utf-8")


@pytest.fixture
def hook_text():
    assert HOOK.exists(), ".githooks/pre-push is gone — a push to main is gated by memory again"
    return HOOK.read_text(encoding="utf-8")


class TestTheCommand:
    def test_it_is_executable(self):
        assert SCRIPT.stat().st_mode & 0o111, "scripts/check-docs is not executable"

    def test_it_runs_the_validation_tests(self, script_text):
        assert "tests/specs/unit/core/validation" in script_text, \
            "the aide suite's own doc guards are not in the command"

    def test_it_runs_the_dashboard_guards(self, script_text):
        assert "test/guards" in script_text and "test/design" in script_text, \
            "the dashboard's doc guards are not in the command"


class TestTheHook:
    def test_it_calls_the_command(self, hook_text):
        assert "scripts/check-docs" in hook_text, "the hook runs something else than the command"

    def test_it_only_guards_the_default_branch(self, hook_text):
        assert "refs/heads/main" in hook_text, \
            "the hook must read the ref being pushed, not run on every push"

    def test_it_can_be_skipped_out_loud(self, hook_text):
        assert "AIDE_SKIP_PRE_PUSH" in hook_text and "skipped" in hook_text, \
            "the way past it has to say that it was taken"
