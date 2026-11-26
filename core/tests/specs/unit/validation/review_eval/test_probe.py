"""scripts/review_eval/probe.py: the session that tries to break each acceptance criterion by running the code."""
import os

import probe


def test_a_bare_worktree_gets_the_checkouts_dependencies_and_keeps_its_own(tmp_path):
    code, tree = tmp_path / "code", tmp_path / "tree"
    (code / "dashboard" / "node_modules").mkdir(parents=True)
    (code / ".venv").mkdir()
    (tree / "dashboard").mkdir(parents=True)
    own = tree / ".venv"
    own.mkdir()

    probe.prepare(tree, code)

    assert (tree / "dashboard" / "node_modules").resolve() == (code / "dashboard" / "node_modules").resolve()
    assert not own.is_symlink()


def test_a_session_past_its_limit_is_not_measured(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub = bin_dir / "codex"
    stub.write_text("#!/bin/sh\nsleep 5\n")
    stub.chmod(0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setattr(probe, "LIMIT_SEC", 0.2)

    assert probe.turn("codex", "m", "text", tmp_path, tmp_path / "probe") is None
    assert "stopped after" in (tmp_path / "probe.err").read_text()

