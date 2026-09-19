"""aide-reopen-spec: the mechanical keep-Reopen.

The folder comes back out of archive/ and nothing in it is rewritten:
0-README.md and the description, analysis, plan stay byte for byte, and
the status file changes in exactly two places (`archive` leaves the steps
line, a round boundary is appended). No model is in the loop.
"""
import json
import os
import subprocess

import pytest


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-reopen-spec"


README = "# X\n\nThe readme, kept.\n"
DESCRIPTION = "# X - Description\n\n## Acceptance criteria\n\n1. **AC-1** — It works.\n"
ANALYSIS = "# X - Analysis\n\n## Mapping\n\n- `src/a.ts:12` — the whole thing\n"
SOLUTION = "# X - Solution\n\n## Plan\n\n1. Do it.\n"
STATUS = (
    "# X - Status\n\nTotal progress: 100% (2 of 2 completed)\n\n## Tracking info\n\n"
    "- **Task:** `82-x/`\n"
    "- **Workflow steps completed:** create, analyze, implement, archive\n\n"
    "## Acceptance criteria\n\n"
    "| Criterion | Status | Note |\n|---|---|---|\n| AC-1 | ✅ | done |\n\n"
    "**Archived:** 2026-09-01\n"
)


def add_archived(specs, folder="82-x", status=STATUS):
    d = specs / "archive" / folder
    d.mkdir(parents=True)
    (d / "0-README.md").write_text(README)
    (d / "1-description.md").write_text(DESCRIPTION)
    (d / "2-analysis.md").write_text(ANALYSIS)
    (d / "3-solution.md").write_text(SOLUTION)
    (d / "4-status.md").write_text(status)
    return d


def run(script, *args):
    proc = subprocess.run(
        [str(script), *args], capture_output=True, text=True,
        env={**os.environ, "GIT_CONFIG_GLOBAL": "/dev/null"},
    )
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line)


def status_lines(text):
    return text.splitlines()


def test_moves_the_folder_and_keeps_files_zero_to_three_byte_for_byte(script, tmp_path):
    add_archived(tmp_path)
    rc, out = run(script, "--specs-root", str(tmp_path), "--spec", "82", "--boundary", "abc1234")
    assert rc == 0, out
    assert out["ok"] is True and out["terminalReason"] == "reopened", out
    assert out["specFolder"] == "82-x"
    d = tmp_path / "82-x"
    assert not (tmp_path / "archive" / "82-x").exists()
    assert (d / "0-README.md").read_text() == README
    assert (d / "1-description.md").read_text() == DESCRIPTION
    assert (d / "2-analysis.md").read_text() == ANALYSIS
    assert (d / "3-solution.md").read_text() == SOLUTION


def test_the_status_file_loses_archive_and_gains_one_boundary_and_nothing_else(script, tmp_path):
    add_archived(tmp_path)
    rc, out = run(script, "--specs-root", str(tmp_path), "--spec", "82-x", "--boundary", "abc1234")
    assert rc == 0, out
    after = (tmp_path / "82-x" / "4-status.md").read_text().splitlines()
    before = STATUS.splitlines()
    changed = [l for l in after if l not in before]
    removed = [l for l in before if l not in after]
    assert removed == ["- **Workflow steps completed:** create, analyze, implement, archive"]
    assert any(l == "- **Workflow steps completed:** create, analyze, implement" for l in changed)
    boundary = [l for l in after if "**Round boundary:**" in l]
    assert len(boundary) == 1 and "`abc1234`" in boundary[0], after
    # every row, tick and the archive trail are as before
    assert "| AC-1 | ✅ | done |" in after and "**Archived:** 2026-09-01" in after
    assert len([l for l in changed if l.strip()]) == 2, changed


def test_the_state_file_drops_archive_and_no_longer_reads_archived(script, tmp_path):
    d = add_archived(tmp_path)
    (d / "4-status.json").write_text(json.dumps({
        "completedPhases": ["create", "analyze", "implement", "archive"],
        "archived": {"date": "2026-09-01"}, "closed": None, "reopened": None,
        "acceptanceCriteria": [], "phaseCounts": {},
    }))
    rc, out = run(script, "--specs-root", str(tmp_path), "--spec", "82-x", "--boundary", "abc1234")
    assert rc == 0, out
    state = json.loads((tmp_path / "82-x" / ("4-status." + "json")).read_text())
    assert state["completedPhases"] == ["create", "analyze", "implement"]
    assert state["archived"] is None


def test_the_stamp_carries_the_given_sha_and_todays_date(script, tmp_path):
    add_archived(tmp_path)
    run(script, "--specs-root", str(tmp_path), "--spec", "82-x", "--boundary", "def5678")
    text = (tmp_path / "82-x" / "4-status.md").read_text()
    from datetime import datetime, timezone
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    assert f"- **Round boundary:** {today} (history before `def5678` does not count)" in text


def test_a_git_tracked_specs_root_gets_a_git_mv(script, tmp_path):
    env = {**os.environ, "GIT_CONFIG_GLOBAL": "/dev/null"}
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True, env=env)
    add_archived(tmp_path)
    subprocess.run(["git", "-C", str(tmp_path), "add", "-A"], check=True, env=env)
    subprocess.run(["git", "-C", str(tmp_path), "-c", "user.name=t", "-c", "user.email=t@t",
                    "commit", "-qm", "init"], check=True, env=env)
    rc, out = run(script, "--specs-root", str(tmp_path), "--spec", "82-x")
    assert rc == 0, out
    status = subprocess.run(["git", "-C", str(tmp_path), "status", "--porcelain"],
                            capture_output=True, text=True).stdout
    assert "R" in status and "archive/82-x/0-README.md -> 82-x/0-README.md" in status, status
    # with no --boundary the stamp names the specs repository's HEAD
    head = subprocess.run(["git", "-C", str(tmp_path), "rev-parse", "--short", "HEAD"],
                          capture_output=True, text=True).stdout.strip()
    assert f"`{head}`" in (tmp_path / "82-x" / "4-status.md").read_text()


def test_refuses_an_active_spec_and_touches_nothing(script, tmp_path):
    d = tmp_path / "82-x"
    d.mkdir()
    (d / "4-status.md").write_text(STATUS)
    rc, out = run(script, "--specs-root", str(tmp_path), "--spec", "82-x")
    assert rc == 2 and out["ok"] is False and out["terminalReason"] == "refused", out
    assert (d / "4-status.md").read_text() == STATUS


def test_refuses_an_unknown_spec(script, tmp_path):
    rc, out = run(script, "--specs-root", str(tmp_path), "--spec", "99")
    assert rc == 2 and out["terminalReason"] == "refused", out


def test_a_closed_spec_is_reopened_with_its_closed_line_kept(script, tmp_path):
    status = (
        "# X - Status\n\n## Tracking info\n\n"
        "- **Workflow steps completed:** create\n\n"
        "**Closed:** 2026-09-02 — not going to work\n"
    )
    add_archived(tmp_path, status=status)
    rc, out = run(script, "--specs-root", str(tmp_path), "--spec", "82-x", "--boundary", "abc1234")
    assert rc == 0, out
    text = (tmp_path / "82-x" / "4-status.md").read_text()
    assert "**Closed:** 2026-09-02 — not going to work" in text
    assert "**Round boundary:**" in text
    state = json.loads((tmp_path / "82-x" / ("4-status." + "json")).read_text())
    assert state["closed"] is None
