"""Tests for core/scripts/aide-create-spec — the mechanical steps of
/aide-create's Step 4 (spec 248): creating a spec's directory and its 5
files given specs-root/number/slug/title/description/depends-on.

No AI is involved anywhere in this file: the point of the script is to
make file creation a Bash-only path, so a permission rule can be scoped
to deny Write/Edit under the specs root with no legitimate case left to
break.
"""
import json
import re
import subprocess
import time

import pytest


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-create-spec"


@pytest.fixture
def file_templates(workspace_root):
    return (
        workspace_root
        / "core"
        / "skills"
        / "aide-create"
        / "references"
        / "file-templates.md"
    )


@pytest.fixture
def specs_root(tmp_path):
    d = tmp_path / "specs"
    d.mkdir()
    return d


def run(script, specs_root, number, slug, title, description,
        depends_on=None, result_file=None, extra_args=None):
    args = [
        str(script),
        "--specs-root", str(specs_root),
        "--number", number,
        "--slug", slug,
        "--title", title,
        "--description", description,
    ]
    if depends_on is not None:
        args += ["--depends-on", depends_on]
    if result_file:
        args += ["--result-file", str(result_file)]
    if extra_args:
        args += extra_args
    proc = subprocess.run(args, capture_output=True, text=True)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line), proc.stdout


# --- happy path (AC1) -----------------------------------------------------


def test_creates_the_folder_and_5_files(script, specs_root):
    rc, out, _ = run(script, specs_root, "42", "do-a-thing", "Do a thing", "Problem: X.\n\nSolution: Y.")
    assert rc == 0, out
    assert out["ok"] is True
    assert out["exitCode"] == 0
    assert out["specFolder"] == "42-do-a-thing"
    folder = specs_root / "42-do-a-thing"
    assert folder.is_dir()
    expected = {"0-README.md", "1-description.md", "2-analysis.md", "3-solution.md", "4-status.md"}
    assert set(out["files"]) == expected
    assert {p.name for p in folder.iterdir()} == expected


def test_substitutes_title_folder_and_date(script, specs_root):
    rc, out, _ = run(script, specs_root, "42", "do-a-thing", "Do a thing", "Problem: X.")
    assert rc == 0, out
    desc = (specs_root / "42-do-a-thing" / "1-description.md").read_text()
    assert desc.startswith("# Do a thing - Description\n")
    assert "- **Task:** `42-do-a-thing/`" in desc
    assert re.search(r"- \*\*Created:\*\* `\d{4}-\d{2}-\d{2}`", desc)
    assert "Problem: X." in desc


# --- depends-on (AC2, AC3) -------------------------------------------------


def test_depends_on_formats_and_places_the_line(script, specs_root):
    rc, out, _ = run(
        script, specs_root, "42", "do-a-thing", "Do a thing", "Problem: X.",
        depends_on=" 105 , 92-a-spec-can-depend ",
    )
    assert rc == 0, out
    desc = (specs_root / "42-do-a-thing" / "1-description.md").read_text()
    lines = desc.splitlines()
    created_idx = next(i for i, l in enumerate(lines) if l.startswith("- **Created:**"))
    assert lines[created_idx + 1] == "- **Depends on:** `105`, `92-a-spec-can-depend`"


def test_no_depends_on_flag_writes_no_depends_line(script, specs_root):
    rc, out, _ = run(script, specs_root, "42", "do-a-thing", "Do a thing", "Problem: X.")
    assert rc == 0, out
    desc = (specs_root / "42-do-a-thing" / "1-description.md").read_text()
    assert "Depends on" not in desc


# --- refusal (AC4, AC5) ----------------------------------------------------


def test_refuses_when_the_folder_already_exists(script, specs_root):
    (specs_root / "42-do-a-thing").mkdir()
    (specs_root / "42-do-a-thing" / "marker.txt").write_text("keep me\n")
    rc, out, _ = run(script, specs_root, "42", "do-a-thing", "Do a thing", "Problem: X.")
    assert rc != 0
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"
    contents = list((specs_root / "42-do-a-thing").iterdir())
    assert [p.name for p in contents] == ["marker.txt"]


@pytest.mark.parametrize("missing", ["--specs-root", "--number", "--slug", "--title", "--description"])
def test_refuses_on_missing_required_flag(script, specs_root, missing):
    args = [
        str(script),
        "--specs-root", str(specs_root),
        "--number", "42",
        "--slug", "do-a-thing",
        "--title", "Do a thing",
        "--description", "Problem: X.",
    ]
    # Drop the flag and its value.
    idx = args.index(missing)
    del args[idx:idx + 2]
    proc = subprocess.run(args, capture_output=True, text=True)
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    assert proc.returncode != 0
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"
    assert not (specs_root / "42-do-a-thing").exists()


# --- result-file (AC6) ------------------------------------------------------


def test_result_file_mirrors_stdout(script, specs_root, tmp_path):
    result_file = tmp_path / "result.json"
    rc, out, _ = run(
        script, specs_root, "42", "do-a-thing", "Do a thing", "Problem: X.",
        result_file=result_file,
    )
    assert rc == 0, out
    assert json.loads(result_file.read_text().strip()) == out


# --- per-file structure (AC7) -----------------------------------------------


def _extract_readme_block(file_templates):
    text = file_templates.read_text()
    start = text.index("## 0-README.md")
    fence_start = text.index("```markdown", start) + len("```markdown\n")
    fence_end = text.index("```", fence_start)
    return text[fence_start:fence_end]


def test_readme_matches_file_templates_byte_for_byte(script, specs_root, file_templates):
    rc, out, _ = run(script, specs_root, "42", "do-a-thing", "Do a thing", "Problem: X.")
    assert rc == 0, out
    actual = (specs_root / "42-do-a-thing" / "0-README.md").read_text()
    expected = _extract_readme_block(file_templates)
    assert actual == expected


def test_description_has_no_scope_heading(script, specs_root):
    rc, out, _ = run(script, specs_root, "42", "do-a-thing", "Do a thing", "Problem: X.")
    assert rc == 0, out
    desc = (specs_root / "42-do-a-thing" / "1-description.md").read_text()
    assert "## Scope" not in desc


def test_analysis_has_no_solution_only_sections(script, specs_root):
    rc, out, _ = run(script, specs_root, "42", "do-a-thing", "Do a thing", "Problem: X.")
    assert rc == 0, out
    analysis = (specs_root / "42-do-a-thing" / "2-analysis.md").read_text()
    for heading in ("## Scope", "## Complexity", "## Risk analysis"):
        assert heading not in analysis
    assert "`[not analyzed yet]`" in analysis


def test_solution_has_scope_and_risk_analysis_and_placeholder_date(script, specs_root):
    rc, out, _ = run(script, specs_root, "42", "do-a-thing", "Do a thing", "Problem: X.")
    assert rc == 0, out
    solution = (specs_root / "42-do-a-thing" / "3-solution.md").read_text()
    assert "## Scope" in solution
    assert "## Risk analysis" in solution
    assert "`[not prepared yet]`" in solution
    assert not re.search(r"`\d{4}-\d{2}-\d{2}`", solution)


def test_status_opens_with_placeholder_progress_and_no_workflow_steps_line(script, specs_root):
    rc, out, _ = run(script, specs_root, "42", "do-a-thing", "Do a thing", "Problem: X.")
    assert rc == 0, out
    status = (specs_root / "42-do-a-thing" / "4-status.md").read_text()
    lines = status.splitlines()
    assert lines[2] == "Total progress: 0% (0 of X completed)"
    assert lines[3] == "Estimate: [X hours/days]"
    assert "Workflow steps completed" not in status


# --- multi-line / special-character description (risk analysis) ------------


def test_description_with_slashes_backticks_and_multiple_lines_is_preserved(script, specs_root):
    description = (
        "Problem: reading `core/scripts/aide-run-spec` and "
        "`core/skills/aide-create/SKILL.md` together.\n\n"
        "Solution: see path/with/slashes and a literal $(echo hi) that "
        "must not run."
    )
    rc, out, _ = run(script, specs_root, "42", "do-a-thing", "Do a thing", description)
    assert rc == 0, out
    desc = (specs_root / "42-do-a-thing" / "1-description.md").read_text()
    assert description in desc


# --- --stamp-outcome (spec 274, AC1-5) --------------------------------------


def run_stamp(script, specs_root, folder, start_epoch=None, model=None, result_file=None):
    args = [str(script), "--specs-root", str(specs_root), "--stamp-outcome", "--folder", folder]
    if start_epoch is not None:
        args += ["--start-epoch", str(start_epoch)]
    if model is not None:
        args += ["--model", model]
    if result_file:
        args += ["--result-file", str(result_file)]
    proc = subprocess.run(args, capture_output=True, text=True)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line), proc.stdout


def _create(script, specs_root):
    rc, out, _ = run(script, specs_root, "42", "do-a-thing", "Do a thing", "Problem: X.")
    assert rc == 0, out
    return specs_root / "42-do-a-thing"


def test_stamp_outcome_writes_time_spent_only_when_no_model_given(script, specs_root):
    folder = _create(script, specs_root)
    start_epoch = int(time.time()) - 125
    rc, out, _ = run_stamp(script, specs_root, "42-do-a-thing", start_epoch=start_epoch)
    assert rc == 0, out
    desc = (folder / "1-description.md").read_text()
    lines = desc.splitlines()
    heading_idx = lines.index("## Tracking info")
    task_idx = next(i for i, l in enumerate(lines) if l.startswith("- **Task:**"))
    assert lines[task_idx - 1] == "- **Time spent:** 2m05s"
    assert task_idx - 1 > heading_idx
    assert "- **Model:**" not in desc
    assert desc.count("- **Time spent:**") == 1


def test_stamp_outcome_writes_model_before_time_spent(script, specs_root):
    folder = _create(script, specs_root)
    start_epoch = int(time.time()) - 125
    rc, out, _ = run_stamp(
        script, specs_root, "42-do-a-thing",
        start_epoch=start_epoch, model="claude claude-opus-5",
    )
    assert rc == 0, out
    desc = (folder / "1-description.md").read_text()
    lines = desc.splitlines()
    task_idx = next(i for i, l in enumerate(lines) if l.startswith("- **Task:**"))
    assert lines[task_idx - 2] == "- **Model:** claude claude-opus-5"
    assert lines[task_idx - 1] == "- **Time spent:** 2m05s"
    assert desc.count("- **Model:**") == 1
    assert desc.count("- **Time spent:**") == 1


def test_stamp_outcome_is_idempotent_on_a_second_call(script, specs_root):
    folder = _create(script, specs_root)
    rc, out, _ = run_stamp(
        script, specs_root, "42-do-a-thing",
        start_epoch=int(time.time()) - 60, model="claude claude-opus-5",
    )
    assert rc == 0, out
    rc, out, _ = run_stamp(
        script, specs_root, "42-do-a-thing",
        start_epoch=int(time.time()) - 300, model="claude claude-sonnet-5",
    )
    assert rc == 0, out
    desc = (folder / "1-description.md").read_text()
    assert desc.count("- **Model:**") == 1
    assert desc.count("- **Time spent:**") == 1
    assert "- **Model:** claude claude-sonnet-5" in desc
    assert "- **Time spent:** 5m00s" in desc


@pytest.mark.parametrize(
    "start_epoch_arg",
    [None, "not-a-number"],
    ids=["missing", "non-numeric"],
)
def test_stamp_outcome_refuses_on_bad_start_epoch(script, specs_root, start_epoch_arg):
    folder = _create(script, specs_root)
    before = (folder / "1-description.md").read_text()
    rc, out, _ = run_stamp(script, specs_root, "42-do-a-thing", start_epoch=start_epoch_arg)
    assert rc != 0
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"
    assert (folder / "1-description.md").read_text() == before


def test_stamp_outcome_refuses_on_future_start_epoch(script, specs_root):
    folder = _create(script, specs_root)
    before = (folder / "1-description.md").read_text()
    rc, out, _ = run_stamp(script, specs_root, "42-do-a-thing", start_epoch=int(time.time()) + 3600)
    assert rc != 0
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"
    assert (folder / "1-description.md").read_text() == before


def test_stamp_outcome_refuses_when_folder_has_no_description_file(script, specs_root):
    rc, out, _ = run_stamp(script, specs_root, "no-such-folder", start_epoch=int(time.time()) - 60)
    assert rc != 0
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"


def test_stamp_outcome_refuses_when_file_has_no_tracking_info_heading(script, specs_root):
    folder = specs_root / "42-do-a-thing"
    folder.mkdir()
    before = "# Do a thing - Description\n\nNo tracking info section here.\n"
    (folder / "1-description.md").write_text(before)
    rc, out, _ = run_stamp(script, specs_root, "42-do-a-thing", start_epoch=int(time.time()) - 60)
    assert rc != 0
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"
    assert (folder / "1-description.md").read_text() == before
