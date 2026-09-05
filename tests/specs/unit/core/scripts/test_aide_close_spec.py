"""Tests for core/scripts/aide-close-spec (spec 406) — the mechanical
steps of /aide-close: folder resolution, the conflict check, and the
stamp-and-move with the reason the person closing it typed.

Unlike aide-archive-spec, this script carries no not-implemented-yet or
acceptance-criteria-unticked gate: REQ-1/REQ-13 require Close to succeed
from every pre-archive phase, including one that never implemented and
one held on unticked acceptance rows.
"""
import json
import subprocess

import pytest


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-close-spec"


def git(repo, *args):
    return subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, check=True,
    ).stdout.strip()


def init_repo(path):
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "-C", str(path), "init", "-q", "-b", "main"], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.name", "Test"], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.email", "test@example.com"], check=True)
    (path / "README.md").write_text("start\n")
    subprocess.run(["git", "-C", str(path), "add", "README.md"], check=True)
    subprocess.run(["git", "-C", str(path), "commit", "-qm", "init"], check=True)
    return path


@pytest.fixture
def project(tmp_path):
    return init_repo(tmp_path / "proj")


@pytest.fixture
def specs(tmp_path):
    return init_repo(tmp_path / "specs")


def configure(project, specs):
    (project / ".aide").mkdir(exist_ok=True)
    (project / ".aide" / "config").write_text(f"AIDE_SPECS_PATH={specs}\n")


def add_spec(specs, folder, status_body=None, archived=False):
    parent = specs / "archive" if archived else specs
    parent.mkdir(exist_ok=True)
    (parent / folder).mkdir()
    (parent / folder / "1-description.md").write_text(f"# {folder} - Description\n")
    if status_body is not None:
        (parent / folder / "4-status.md").write_text(status_body)
    subprocess.run(["git", "-C", str(specs), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(specs), "commit", "-qm", f"add {folder}"], check=True)
    return parent / folder


def make_conflict(repo):
    """A real, open merge conflict — MERGE_HEAD set, markers in the file."""
    git(repo, "switch", "-q", "-c", "feature")
    (repo / "contested.txt").write_text("feature side\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "feature side")
    git(repo, "switch", "-q", "main")
    (repo / "contested.txt").write_text("main side\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "main side")
    subprocess.run(["git", "-C", str(repo), "merge", "-q", "--no-edit", "feature"], capture_output=True)


def phase(heading, rows):
    return "\n".join([
        f"## {heading}", "", "### Tasks", "", "| Task | Status | Notes |",
        "|------|--------|-------|", *rows, "", "---", "",
    ])


def acceptance(rows):
    return "\n".join([
        "## Acceptance criteria", "", "| Task | Status | Notes |",
        "|------|--------|-------|", *rows, "", "---", "",
    ])


def status_md(claims="", body=""):
    text = "# X - Status\n\n## Tracking info\n\n"
    if claims:
        text += f"- **Workflow steps completed:** {claims}\n"
    text += "\n---\n\n" + body
    return text


def run(script, project, spec, reason="not going to work", specs_dir=None, result_file=None, omit_reason=False):
    args = [str(script), "--project-dir", str(project), "--spec", spec]
    if not omit_reason:
        args += ["--reason", reason]
    if specs_dir:
        args += ["--specs-dir", str(specs_dir)]
    if result_file:
        args += ["--result-file", str(result_file)]
    proc = subprocess.run(args, capture_output=True, text=True)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line), proc.stdout


# --- refusal --------------------------------------------------------------


def test_refuses_without_project_dir(script):
    proc = subprocess.run([str(script), "--spec", "1", "--reason", "x"], capture_output=True, text=True)
    out = json.loads(proc.stdout.strip())
    assert proc.returncode == 2
    assert out["terminalReason"] == "refused"


def test_refuses_without_spec(script, project):
    proc = subprocess.run(
        [str(script), "--project-dir", str(project), "--reason", "x"], capture_output=True, text=True
    )
    out = json.loads(proc.stdout.strip())
    assert proc.returncode == 2
    assert out["terminalReason"] == "refused"


# --- REQ-3, REQ-13: no reason, no close ------------------------------------


def test_refuses_without_a_reason(script, project, specs):
    configure(project, specs)
    add_spec(specs, "81-x")
    rc, out, _ = run(script, project, "81-x", omit_reason=True)
    assert rc == 2, out
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"
    # Nothing was touched: the folder is still where it was.
    assert (specs / "81-x").exists()


def test_unknown_spec_lists_the_active_folders(script, project, specs):
    configure(project, specs)
    add_spec(specs, "80-other")
    rc, out, _ = run(script, project, "999")
    assert rc == 2, out
    assert out["terminalReason"] == "refused"
    assert "80-other" in out["error"], out


# --- REQ-1, REQ-13: legal from every pre-archive phase, unlike archive ----


def test_closes_a_spec_that_never_implemented(script, project, specs):
    """The exact case Archive refuses (not-implemented-yet): Close must
    succeed on it instead (REQ-1, REQ-13)."""
    configure(project, specs)
    add_spec(specs, "81-x")
    rc, out, _ = run(script, project, "81-x", reason="this idea does not hold")
    assert rc == 0, out
    assert out["terminalReason"] == "closed", out
    assert out["specFolder"] == "archive/81-x"
    assert not (specs / "81-x").exists()
    assert (specs / "archive" / "81-x").exists()


def test_closes_a_spec_analyzed_but_not_implemented(script, project, specs):
    configure(project, specs)
    body = status_md("create, analyze", phase("Phase 1: RED", ["| a | ⬜ | |"]))
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "closed", out


def test_closes_a_spec_held_on_unticked_acceptance_rows(script, project, specs):
    """The exact case Archive refuses (acceptance-criteria-unticked):
    Close must succeed on it instead (REQ-1, REQ-13)."""
    configure(project, specs)
    body = status_md(
        "create, analyze, implement",
        phase("Phase 1: RED", ["| a | ✅ | |"]) + acceptance(["| REQ-1: does a thing | ⬜ | |"]),
    )
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert rc == 0, out
    assert out["terminalReason"] == "closed", out
    assert not (specs / "81-x").exists()
    assert (specs / "archive" / "81-x").exists()


# --- REQ-5: the stamp carries the exact reason ------------------------------


def test_the_stamp_carries_the_exact_reason_text(script, project, specs):
    configure(project, specs)
    add_spec(specs, "81-x", status_md())
    rc, out, _ = run(script, project, "81-x", reason="the idea does not hold up")
    assert rc == 0, out
    text = (specs / "archive" / "81-x" / "4-status.md").read_text()
    assert "**Closed:**" in text, text
    assert "the idea does not hold up" in text, text
    state = json.loads((specs / "archive" / "81-x" / "4-status.json").read_text())
    assert state["closed"]["reason"] == "the idea does not hold up"


# --- already-closed / already-archived idempotency -------------------------


def test_already_closed_is_idempotent(script, project, specs):
    configure(project, specs)
    body = "# X - Status\n\n## Tracking info\n\n**Closed:** 2026-09-01 — first reason\n"
    add_spec(specs, "81-x", body, archived=True)
    rc, out, _ = run(script, project, "81-x", reason="second attempt")
    assert rc == 0, out
    assert out["terminalReason"] == "already-closed", out
    assert out["specFolder"] == "archive/81-x"
    # The original stamp is left exactly as it was — closing twice does
    # not overwrite the recorded reason.
    text = (specs / "archive" / "81-x" / "4-status.md").read_text()
    assert "first reason" in text
    assert "second attempt" not in text


def test_close_on_a_plainly_archived_spec_names_reopen(script, project, specs):
    """A spec archived through the ordinary route (no **Closed:** stamp)
    refuses a close request, naming reopen — mirrors the transitions
    table's own `archived` + `close` refusal."""
    configure(project, specs)
    body = "# X - Status\n\n## Tracking info\n\n**Archived:** 2026-09-01\n"
    add_spec(specs, "81-x", body, archived=True)
    rc, out, _ = run(script, project, "81-x")
    assert rc == 0, out
    assert out["terminalReason"] == "already-archived", out
    assert "reopen" in out["note"], out
    text = (specs / "archive" / "81-x" / "4-status.md").read_text()
    assert "**Closed:**" not in text


# --- conflict-open ----------------------------------------------------------


def test_conflict_open_in_the_project_dir(script, project, specs):
    configure(project, specs)
    add_spec(specs, "81-x")
    make_conflict(project)
    rc, out, _ = run(script, project, "81-x")
    assert rc == 0, out
    assert out["terminalReason"] == "conflict-open"
    assert (specs / "81-x").exists()


def test_conflict_open_in_the_specs_dir_alone(script, project, specs):
    configure(project, specs)
    add_spec(specs, "81-x")
    make_conflict(specs)
    rc, out, _ = run(script, project, "81-x", specs_dir=specs)
    assert out["terminalReason"] == "conflict-open", out
