"""Tests for core/scripts/aide-archive-spec — the mechanical steps of
/aide-archive (spec 251): folder resolution, the conflict check, the
status-table read, and the stamp-and-move.

No AI is involved anywhere in this file: the whole point of the script
is to answer "is this spec's work done, and is anything conflicted"
without spawning one.
"""
import json
import subprocess

import pytest


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-archive-spec"


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


def status_md(claims="", body=""):
    text = "# X - Status\n\n## Tracking info\n\n"
    if claims:
        text += f"- **Workflow steps completed:** {claims}\n"
    text += "\n---\n\n" + body
    return text


def run(script, project, spec, specs_dir=None, result_file=None):
    args = [str(script), "--project-dir", str(project), "--spec", spec]
    if specs_dir:
        args += ["--specs-dir", str(specs_dir)]
    if result_file:
        args += ["--result-file", str(result_file)]
    proc = subprocess.run(args, capture_output=True, text=True)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line), proc.stdout


# --- refusal ------------------------------------------------------------


def test_refuses_without_project_dir(script):
    proc = subprocess.run([str(script), "--spec", "1"], capture_output=True, text=True)
    out = json.loads(proc.stdout.strip())
    assert proc.returncode == 2
    assert out["terminalReason"] == "refused"


def test_refuses_without_spec(script, project):
    proc = subprocess.run(
        [str(script), "--project-dir", str(project)], capture_output=True, text=True
    )
    out = json.loads(proc.stdout.strip())
    assert proc.returncode == 2
    assert out["terminalReason"] == "refused"


def test_unknown_spec_lists_the_active_folders(script, project, specs):
    configure(project, specs)
    add_spec(specs, "80-other")
    rc, out, _ = run(script, project, "999")
    assert rc == 2, out
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"
    assert "80-other" in out["error"], out


def test_refuses_when_there_is_no_specs_root_at_all(script, project):
    rc, out, _ = run(script, project, "1")
    assert rc == 2, out
    assert out["terminalReason"] == "refused"


# --- already-archived (criterion 6, criterion 7) -------------------------


def test_already_archived_by_full_folder_name(script, project, specs):
    configure(project, specs)
    add_spec(specs, "77-recovered", archived=True)
    rc, out, _ = run(script, project, "77-recovered")
    assert rc == 0, out
    assert out["ok"] is True
    assert out["terminalReason"] == "already-archived"
    assert out["specFolder"] == "archive/77-recovered"
    assert "77-recovered" in out["note"], out


def test_already_archived_resolves_by_number_too(script, project, specs):
    configure(project, specs)
    add_spec(specs, "77-recovered", archived=True)
    rc, out, _ = run(script, project, "77")
    assert out["terminalReason"] == "already-archived"
    assert out["specFolder"] == "archive/77-recovered"


# --- conflict-open (criterion 5) -----------------------------------------


def test_conflict_open_in_the_project_dir(script, project, specs):
    configure(project, specs)
    add_spec(specs, "81-x", status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ✅ | |"])))
    make_conflict(project)
    rc, out, _ = run(script, project, "81-x")
    assert rc == 0, out
    assert out["terminalReason"] == "conflict-open"
    # No write happened: a conflict must be resolved before anything else.
    assert (specs / "81-x").exists()


def test_conflict_open_in_the_specs_dir_alone(script, project, specs):
    configure(project, specs)
    add_spec(specs, "81-x", status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ✅ | |"])))
    make_conflict(specs)
    rc, out, _ = run(script, project, "81-x", specs_dir=specs)
    assert out["terminalReason"] == "conflict-open", out


def test_a_specs_conflict_is_not_seen_without_specs_dir(script, project, specs):
    """--specs-dir is opt-in: the caller names which extra directory to
    check, and a conflict there is invisible without it."""
    configure(project, specs)
    add_spec(specs, "81-x", status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ✅ | |"])))
    make_conflict(specs)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] != "conflict-open", out


# --- the status-table read: not-implemented-yet vs held-back vs archived --


def test_no_status_file_at_all_is_not_implemented_yet(script, project, specs):
    configure(project, specs)
    add_spec(specs, "81-x")
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "not-implemented-yet", out
    assert (specs / "81-x").exists(), "nothing may be moved on this path"


def test_every_row_unstarted_with_no_implement_is_ordinary_progression(script, project, specs):
    configure(project, specs)
    body = status_md("create, analyze", phase("Phase 1: RED", ["| a | ⬜ | |", "| b | Not started | |"]))
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "not-implemented-yet", out


def test_ordinary_progression_removes_a_stale_held_back_section(script, project, specs):
    body = status_md("create, analyze", phase("Phase 1: RED", ["| a | ⬜ | |"])) + \
        "\n## Archive held back\n\n- an old reason — tick it on the spec's page\n\n---\n"
    configure(project, specs)
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "not-implemented-yet", out
    text = (specs / "81-x" / "4-status.md").read_text()
    assert "Archive held back" not in text, text


def test_an_in_progress_row_is_genuinely_held_back(script, project, specs):
    configure(project, specs)
    body = status_md("create, analyze", phase("Phase 1: RED", ["| a | 🔄 | |"]))
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "held-back", out
    text = (specs / "81-x" / "4-status.md").read_text()
    assert text.count("## Archive held back") == 1, text
    assert "- a (Phase 1: RED) — tick it on the spec's page" in text, text
    assert (specs / "81-x").exists(), "a held-back decline must not move the folder"


@pytest.mark.parametrize("mark", ["❌", "⚠️", "Waiting"])
def test_every_other_open_notation_symbol_is_also_held_back(script, project, specs, mark):
    configure(project, specs)
    body = status_md("create, analyze", phase("Phase 1: RED", [f"| a | {mark} | |"]))
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "held-back", out


def test_implement_present_with_an_unstarted_row_is_still_held_back(script, project, specs):
    """SKILL.md's own rule: 'implement present while a row is still open'
    is genuinely blocked, even when every open row is otherwise
    unstarted — implement should not have begun against unfinished
    earlier work."""
    configure(project, specs)
    body = status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ⬜ | |"]))
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "held-back", out


def test_held_back_replaces_a_stale_section_rather_than_duplicating(script, project, specs):
    configure(project, specs)
    body = status_md("create, analyze", phase("Phase 1: RED", ["| a | ❌ | |"])) + \
        "\n## Archive held back\n\n- a stale reason\n\n---\n"
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "held-back", out
    text = (specs / "81-x" / "4-status.md").read_text()
    assert text.count("## Archive held back") == 1, text
    assert "a stale reason" not in text, text


def test_running_held_back_twice_does_not_duplicate_the_section(script, project, specs):
    configure(project, specs)
    body = status_md("create, analyze", phase("Phase 1: RED", ["| a | 🔄 | |"]))
    add_spec(specs, "81-x", body)
    run(script, project, "81-x")
    rc, out, _ = run(script, project, "81-x")
    assert out["terminalReason"] == "held-back", out
    text = (specs / "81-x" / "4-status.md").read_text()
    assert text.count("## Archive held back") == 1, text


# --- archived (criterion 4) -----------------------------------------------


def test_every_row_done_archives_the_spec(script, project, specs):
    configure(project, specs)
    body = status_md(
        "create, analyze, implement",
        phase("Phase 1: RED", ["| a | ✅ | |"]) + phase("Phase 2: GREEN", ["| b | Completed | |"]),
    )
    add_spec(specs, "81-x", body)
    rc, out, _ = run(script, project, "81-x")
    assert rc == 0, out
    assert out["terminalReason"] == "archived", out
    assert out["needsDocFeedback"] is True
    assert out["specFolder"] == "archive/81-x"
    assert not (specs / "81-x").exists()
    assert (specs / "archive" / "81-x").exists()
    text = (specs / "archive" / "81-x" / "4-status.md").read_text()
    assert "**Archived:**" in text, text


def test_the_move_uses_git_mv_when_the_specs_root_is_tracked(script, project, specs):
    configure(project, specs)
    body = status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ✅ | |"]))
    add_spec(specs, "81-x", body)
    run(script, project, "81-x")
    # git mv STAGES the rename ("R"), rather than leaving it as an
    # untracked/deleted pair the way a plain `mv` in a tracked repo would.
    status = git(specs, "status", "--porcelain")
    assert status.startswith("R"), status
    assert "D " not in status and "??" not in status, status


def test_running_twice_after_archiving_is_idempotent(script, project, specs):
    configure(project, specs)
    body = status_md("create, analyze, implement", phase("Phase 1: RED", ["| a | ✅ | |"]))
    add_spec(specs, "81-x", body)
    rc1, out1, _ = run(script, project, "81-x")
    assert out1["terminalReason"] == "archived", out1

    rc2, out2, _ = run(script, project, "81-x")
    assert rc2 == 0, out2
    assert out2["terminalReason"] == "already-archived", out2
    assert out2["specFolder"] == "archive/81-x"

    text = (specs / "archive" / "81-x" / "4-status.md").read_text()
    assert text.count("**Archived:**") == 1, text


def test_the_result_file_carries_the_same_json_as_stdout(script, project, specs, tmp_path):
    configure(project, specs)
    add_spec(specs, "81-x")
    result_file = tmp_path / "result.json"
    rc, out, _ = run(script, project, "81-x", result_file=result_file)
    assert json.loads(result_file.read_text()) == out
