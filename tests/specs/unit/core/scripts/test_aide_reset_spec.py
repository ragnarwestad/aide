"""aide-reset-spec: the mechanical whole of /aide-reset.

Three files back to their templates, two files untouched, one JSON line
— no model in the loop, which is what let a headless reset be refused
its commands and leave the round's files as they were (2026-09-14).
"""
import json
import os
import subprocess

import pytest


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-reset-spec"


FULL_ANALYSIS = "# X - Analysis\n\n## Mapping\n\n- `src/a.ts:12` — the whole thing\n"
FULL_SOLUTION = "# X - Solution\n\n## Plan\n\n1. Do it.\n"
FULL_STATUS = (
    "# X - Status\n\nTotal progress: 100% (2 of 2 completed)\n\n## Tracking info\n\n"
    "- **Task:** `82-x/`\n- **Workflow steps completed:** create, analyze, implement\n"
)


def add_spec(specs, folder, archived=False):
    root = specs / "archive" if archived else specs
    d = root / folder
    d.mkdir(parents=True)
    (d / "0-README.md").write_text("# X\n\nThe readme, kept.\n")
    (d / "1-description.md").write_text("# X - Description\n\n## Description\n\nThe idea.\n")
    (d / "2-analysis.md").write_text(FULL_ANALYSIS)
    (d / "3-solution.md").write_text(FULL_SOLUTION)
    (d / "4-status.md").write_text(FULL_STATUS)
    return d


def run(script, *args):
    proc = subprocess.run(
        [str(script), *args], capture_output=True, text=True,
        env={**os.environ, "GIT_CONFIG_GLOBAL": "/dev/null"},
    )
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line)


def test_puts_the_three_round_files_back_to_their_templates(script, tmp_path):
    d = add_spec(tmp_path, "82-x")
    rc, out = run(script, "--specs-root", str(tmp_path), "--spec", "82")
    assert rc == 0, out
    assert out["ok"] is True and out["terminalReason"] == "reset", out
    assert out["specFolder"] == "82-x"
    analysis = (d / "2-analysis.md").read_text()
    solution = (d / "3-solution.md").read_text()
    status = (d / "4-status.md").read_text()
    assert analysis.startswith("# X - Analysis") and "src/a.ts" not in analysis
    assert solution.startswith("# X - Solution") and "Do it." not in solution
    assert status.startswith("# X - Status") and "Total progress: 0%" in status
    assert "Workflow steps completed" not in status
    assert "`82-x/`" in status


def test_keeps_the_readme_and_the_description_byte_for_byte(script, tmp_path):
    d = add_spec(tmp_path, "82-x")
    before = [(d / f).read_bytes() for f in ("0-README.md", "1-description.md")]
    rc, _ = run(script, "--specs-root", str(tmp_path), "--spec", "82-x")
    assert rc == 0
    assert [(d / f).read_bytes() for f in ("0-README.md", "1-description.md")] == before


def test_refuses_an_archived_spec_and_names_reopen(script, tmp_path):
    add_spec(tmp_path, "82-x", archived=True)
    rc, out = run(script, "--specs-root", str(tmp_path), "--spec", "82")
    assert rc == 2 and out["terminalReason"] == "refused", out
    assert "reopen" in out["error"]
    assert (tmp_path / "archive" / "82-x" / "2-analysis.md").read_text() == FULL_ANALYSIS


def test_refuses_an_unknown_spec_and_a_missing_argument(script, tmp_path):
    rc, out = run(script, "--specs-root", str(tmp_path), "--spec", "99")
    assert rc == 2 and "unknown spec" in out["error"], out
    rc, out = run(script, "--specs-root", str(tmp_path))
    assert rc == 2 and "--spec" in out["error"], out


def test_writes_the_result_file_when_asked(script, tmp_path):
    add_spec(tmp_path, "82-x")
    result = tmp_path / "result.json"
    rc, out = run(script, "--specs-root", str(tmp_path), "--spec", "82-x", "--result-file", str(result))
    assert rc == 0
    assert json.loads(result.read_text()) == out


def test_help_flag_prints_usage_and_exits_zero(script):
    result = subprocess.run([str(script), "--help"], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert "usage" in result.stdout.lower(), result.stdout
