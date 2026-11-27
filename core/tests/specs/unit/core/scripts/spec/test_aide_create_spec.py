import os
"""Tests for core/scripts/aide-create-spec — creating a spec's directory
and its 5 files under the folder name the board gives, and renumbering
that folder at landing.

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
        / "scripts"
        / "lib"
        / "steps"
        / "aide-create"
        / "references"
        / "file-templates.md"
    )


@pytest.fixture
def specs_root(tmp_path):
    d = tmp_path / "specs"
    d.mkdir()
    return d


@pytest.fixture
def git_specs_root(tmp_path):
    """A specs root that is also a git checkout — `--assign-number` uses
    `git mv`, the same as `aide-archive-spec`'s own stamp-and-move, since
    in production it always runs inside a landing's merge worktree."""
    d = tmp_path / "git-specs"
    d.mkdir()
    subprocess.run(["git", "-C", str(d), "init", "-q", "-b", "main"], check=True)
    subprocess.run(["git", "-C", str(d), "config", "user.name", "Test"], check=True)
    subprocess.run(["git", "-C", str(d), "config", "user.email", "test@example.com"], check=True)
    (d / "README.md").write_text("start\n")
    subprocess.run(["git", "-C", str(d), "add", "README.md"], check=True)
    subprocess.run(["git", "-C", str(d), "commit", "-qm", "init"], check=True)
    return d


def run(script, specs_root, folder, title, description, depends_on=None,
        result_file=None, extra_args=None, acceptance_not_required=False):
    args = [
        str(script),
        "--specs-root", str(specs_root),
        "--folder-name", folder,
        "--title", title,
        "--description", description,
    ]
    if depends_on is not None:
        args += ["--depends-on", depends_on]
    if acceptance_not_required:
        args += ["--acceptance-not-required"]
    if result_file:
        args += ["--result-file", str(result_file)]
    if extra_args:
        args += extra_args
    proc = subprocess.run(args, capture_output=True, text=True)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line), proc.stdout


# --- happy path -----------------------------------------------------


def test_creates_the_folder_and_5_files(script, specs_root):
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "Do a thing", "Problem: X.\n\nSolution: Y.")
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
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "Do a thing", "Problem: X.")
    assert rc == 0, out
    desc = (specs_root / "42-do-a-thing" / "1-description.md").read_text()
    assert desc.startswith("# Do a thing - Description\n")
    assert "- **Task:** `42-do-a-thing/`" in desc
    assert re.search(r"- \*\*Created:\*\* `\d{4}-\d{2}-\d{2}`", desc)
    assert "Problem: X." in desc


def test_records_the_direct_create_settings_ac_1_ac_5(script, specs_root):
    rc, out, _ = run(
        script, specs_root, "01-a-direct-spec", "A Direct Spec", "Problem: X.",
        extra_args=["--criteria-checks", "warn", "--choose-approach", "yes"],
    )
    assert rc == 0, out
    desc = (specs_root / "01-a-direct-spec" / "1-description.md").read_text()
    assert "- **Acceptance criteria checks:** warn" in desc
    assert "- **Let me choose the approach:** yes" in desc


# --- depends-on -------------------------------------------------


def test_depends_on_formats_and_places_the_line(script, specs_root):
    (specs_root / "10-earlier-spec").mkdir()
    (specs_root / "11-a-spec-can-depend").mkdir()
    rc, out, _ = run(
        script, specs_root, "42-do-a-thing", "Do a thing", "Problem: X.",
        depends_on=" 10 , 11-a-spec-can-depend ",
    )
    assert rc == 0, out
    desc = (specs_root / "42-do-a-thing" / "1-description.md").read_text()
    lines = desc.splitlines()
    created_idx = next(i for i, l in enumerate(lines) if l.startswith("- **Created:**"))
    assert lines[created_idx + 1] == "- **Depends on:** `10-earlier-spec`, `11-a-spec-can-depend`"


def test_depends_on_resolves_unique_numbers_and_refuses_ambiguity_ac_1_ac_2_ac_3(
    script, specs_root
):
    (specs_root / "77-old").mkdir()
    rc, out, _ = run(
        script, specs_root, "78-do-a-thing", "Do a thing", "Problem: X.",
        depends_on="77",
    )
    assert rc == 0, out
    desc = (specs_root / "78-do-a-thing" / "1-description.md").read_text()
    assert "- **Depends on:** `77-old`" in desc

    (specs_root / "77-second").mkdir()
    rc, out, _ = run(
        script, specs_root, "79-another", "Another", "Problem: X.",
        depends_on="77",
    )
    assert rc == 2
    assert out["terminalReason"] == "refused"
    assert "77" in out["error"]
    assert not (specs_root / "79-another").exists()


def test_depends_on_an_active_and_an_archived_spec_with_one_number_is_ambiguous(
    script, specs_root
):
    (specs_root / "12-a").mkdir()
    (specs_root / "archive" / "12-b").mkdir(parents=True)
    rc, out, _ = run(
        script, specs_root, "78-do-a-thing", "Do a thing", "Problem: X.",
        depends_on="12",
    )
    assert rc == 2 and out["terminalReason"] == "refused", out
    assert "12" in out["error"]
    assert not (specs_root / "78-do-a-thing").exists()


def test_no_depends_on_flag_writes_no_depends_line(script, specs_root):
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "Do a thing", "Problem: X.")
    assert rc == 0, out
    desc = (specs_root / "42-do-a-thing" / "1-description.md").read_text()
    assert "Depends on" not in desc


# --- acceptance ------------------------------------------


def test_acceptance_not_required_flag_writes_the_line_after_created(script, specs_root):
    rc, out, _ = run(
        script, specs_root, "42-do-a-thing", "Do a thing", "Problem: X.",
        acceptance_not_required=True,
    )
    assert rc == 0, out
    desc = (specs_root / "42-do-a-thing" / "1-description.md").read_text()
    lines = desc.splitlines()
    created_idx = next(i for i, l in enumerate(lines) if l.startswith("- **Created:**"))
    assert lines[created_idx + 1] == "- **Acceptance:** not required"


def test_no_acceptance_flag_writes_no_acceptance_line(script, specs_root):
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "Do a thing", "Problem: X.")
    assert rc == 0, out
    desc = (specs_root / "42-do-a-thing" / "1-description.md").read_text()
    assert "Acceptance" not in desc


def test_acceptance_and_depends_on_both_land_after_created_in_order(script, specs_root):
    (specs_root / "10-earlier-spec").mkdir()
    rc, out, _ = run(
        script, specs_root, "42-do-a-thing", "Do a thing", "Problem: X.",
        depends_on="10", acceptance_not_required=True,
    )
    assert rc == 0, out
    desc = (specs_root / "42-do-a-thing" / "1-description.md").read_text()
    lines = desc.splitlines()
    created_idx = next(i for i, l in enumerate(lines) if l.startswith("- **Created:**"))
    assert lines[created_idx + 1] == "- **Depends on:** `10-earlier-spec`"
    assert lines[created_idx + 2] == "- **Acceptance:** not required"


# --- refusal ----------------------------------------------------


def test_refuses_when_the_folder_already_exists(script, specs_root):
    (specs_root / "42-do-a-thing").mkdir()
    (specs_root / "42-do-a-thing" / "marker.txt").write_text("keep me\n")
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "Do a thing", "Problem: X.")
    assert rc != 0
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"
    contents = list((specs_root / "42-do-a-thing").iterdir())
    assert [p.name for p in contents] == ["marker.txt"]


@pytest.mark.parametrize("missing", ["--specs-root", "--title", "--description"])
def test_refuses_on_missing_required_flag(script, specs_root, missing):
    args = [
        str(script),
        "--specs-root", str(specs_root),
        "--folder-name", "42-do-a-thing",
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
    assert list(specs_root.iterdir()) == []


# --- result-file ------------------------------------------------------


def test_result_file_mirrors_stdout(script, specs_root, tmp_path):
    result_file = tmp_path / "result.json"
    rc, out, _ = run(
        script, specs_root, "42-do-a-thing", "Do a thing", "Problem: X.",
        result_file=result_file,
    )
    assert rc == 0, out
    assert json.loads(result_file.read_text().strip()) == out


# --- per-file structure -----------------------------------------------


def _extract_readme_block(file_templates):
    text = file_templates.read_text()
    start = text.index("## 0-README.md")
    fence_start = text.index("```markdown", start) + len("```markdown\n")
    fence_end = text.index("```", fence_start)
    return text[fence_start:fence_end]


def test_readme_matches_file_templates_byte_for_byte(script, specs_root, file_templates):
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "Do a thing", "Problem: X.")
    assert rc == 0, out
    actual = (specs_root / "42-do-a-thing" / "0-README.md").read_text()
    expected = _extract_readme_block(file_templates)
    assert actual == expected


def test_status_opens_with_placeholder_progress_and_no_workflow_steps_line(script, specs_root):
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "Do a thing", "Problem: X.")
    assert rc == 0, out
    status = (specs_root / "42-do-a-thing" / "4-status.md").read_text()
    lines = status.splitlines()
    assert lines[2] == "Total progress: 0% (0 of X completed)"
    assert lines[3] == "Estimate: [X hours/days]"
    assert "Workflow steps completed" not in status


# --- Acceptance criteria line format ---------------------


def test_bolds_an_acceptance_criteria_line_written_without_bold(script, specs_root):
    """A refusal leaves nothing to correct: the person has no spec. The
    line has one right shape, so it is written in that shape instead."""
    description = "Problem: X.\n\n## Acceptance criteria\n\n- AC-1: The system SHALL do a thing.\n"
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "Do a thing", description)
    assert rc == 0, out
    desc = (specs_root / "42-do-a-thing" / "1-description.md").read_text()
    assert "- **AC-1:** The system SHALL do a thing." in desc
    assert "- AC-1:" not in desc


def test_moves_misplaced_bold_on_an_acceptance_criteria_line(script, specs_root):
    description = "Problem: X.\n\n## Acceptance criteria\n\n- **AC-1**: The system SHALL do **a** thing.\n"
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "Do a thing", description)
    assert rc == 0, out
    desc = (specs_root / "42-do-a-thing" / "1-description.md").read_text()
    assert "- **AC-1:** The system SHALL do **a** thing." in desc


def test_still_refuses_an_acceptance_criteria_line_it_cannot_rewrite(script, specs_root):
    description = "Problem: X.\n\n## Acceptance criteria\n\n- AC-**1**: The system SHALL do a thing.\n"
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "Do a thing", description)
    assert rc != 0
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"
    assert "AC-" in out["error"]
    assert "Acceptance criteria" in out["error"]
    assert "Requirements" not in out["error"]
    assert not (specs_root / "42-do-a-thing").exists()


def test_accepts_and_preserves_correctly_bolded_acceptance_criteria_lines(script, specs_root):
    description = (
        "Problem: X.\n\n## Acceptance criteria\n\n"
        "- **AC-1:** The system SHALL do a thing.\n"
        "- **AC-2:** The system SHALL do another thing.\n"
    )
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "Do a thing", description)
    assert rc == 0, out
    desc = (specs_root / "42-do-a-thing" / "1-description.md").read_text()
    assert "- **AC-1:** The system SHALL do a thing." in desc
    assert "- **AC-2:** The system SHALL do another thing." in desc


def test_passes_through_old_req_shaped_line_as_ordinary_text(script, specs_root):
    description = "Problem: X.\n\n## Requirements\n\n- REQ-1: The system SHALL do a thing.\n"
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "Do a thing", description)
    assert rc == 0, out
    desc = (specs_root / "42-do-a-thing" / "1-description.md").read_text()
    assert "- REQ-1: The system SHALL do a thing." in desc


# --- multi-line / special-character description (risk analysis) ------------


def test_description_with_slashes_backticks_and_multiple_lines_is_preserved(script, specs_root):
    description = (
        "Problem: reading `core/scripts/aide-run-spec` and "
        "`core/scripts/lib/steps/aide-create/SKILL.md` together.\n\n"
        "Solution: see path/with/slashes and a literal $(echo hi) that "
        "must not run."
    )
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "Do a thing", description)
    assert rc == 0, out
    desc = (specs_root / "42-do-a-thing" / "1-description.md").read_text()
    assert description in desc


# --- without --folder-name: the board's direct create --------------------
#
# The script picks the next number and makes the slug from the title.
# `mkdir` settles a race between two creates.

def run_unnamed(script, specs_root, title, description="why", extra_args=None):
    args = [
        str(script), "--specs-root", str(specs_root),
        "--title", title, "--description", description, *(extra_args or []),
    ]
    proc = subprocess.run(args, capture_output=True, text=True)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line), proc.stdout


def test_derives_the_slug_and_picks_the_next_number(script, specs_root):
    (specs_root / "07-earlier").mkdir()
    rc, out, _ = run_unnamed(script, specs_root, "A Direct Spec")
    assert rc == 0, out
    assert out["specFolder"] == "08-a-direct-spec"
    assert (specs_root / "08-a-direct-spec" / "1-description.md").is_file()


def test_an_archived_number_is_never_reused(script, specs_root):
    (specs_root / "archive").mkdir()
    (specs_root / "archive" / "12-gone").mkdir()
    rc, out, _ = run_unnamed(script, specs_root, "A new one")
    assert rc == 0, out
    assert out["specFolder"] == "13-a-new-one"


def test_an_empty_specs_root_starts_at_01(script, specs_root):
    rc, out, _ = run_unnamed(script, specs_root, "The first")
    assert rc == 0, out
    assert out["specFolder"] == "01-the-first"


def test_two_creates_at_once_get_different_numbers(script, specs_root):
    import concurrent.futures

    def one(title):
        return run_unnamed(script, specs_root, title)

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(one, ["Alpha", "Beta", "Gamma", "Delta"]))

    for rc, out, _ in results:
        assert rc == 0, out
    folders = sorted(out["specFolder"] for _, out, _ in results)
    assert sorted(f.split("-")[0] for f in folders) == ["01", "02", "03", "04"], folders
    for f in folders:
        assert (specs_root / f).is_dir()


# --- --folder-name: a headless create's literal name, no
# number or slug computed at all — the folder is renumbered later, at
# landing, under the specs repo's own lock.


def test_folder_name_refuses_an_invalid_name(script, specs_root):
    rc, out, _ = run(script, specs_root, "../escape", "A new spec", "Problem: X.")
    assert rc != 0
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"


# --- --assign-number: landing's own finalize step, renaming
# an existing (literally-named) folder to its real number and slug, and
# rewriting every file's own Task: line to match.


def run_assign_number(script, specs_root, folder):
    args = [str(script), "--specs-root", str(specs_root), "--assign-number", "--folder", folder]
    proc = subprocess.run(args, capture_output=True, text=True)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line), proc.stdout


def commit_all(repo, message="add spec"):
    """`--assign-number` uses `git mv`, which refuses on an untracked
    directory — exactly what a create step's own folder is until this
    commits it, the same as a real landing worktree, whose merge has
    already committed the branch being renamed."""
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", message], check=True)


def test_assign_number_renumbers_and_rewrites_all_four_task_lines(script, git_specs_root):
    rc, out, _ = run(script, git_specs_root, "new-abcd1234", "A brand new spec", "Problem: X.")
    assert rc == 0, out
    commit_all(git_specs_root)

    rc, out, _ = run_assign_number(script, git_specs_root, "new-abcd1234")
    assert rc == 0, out
    assert out["ok"] is True
    assert out["terminalReason"] == "assigned"
    assert out["specFolder"] == "01-a-brand-new-spec"

    folder = git_specs_root / "01-a-brand-new-spec"
    assert folder.is_dir()
    assert not (git_specs_root / "new-abcd1234").exists()
    for name in ["1-description.md", "2-analysis.md", "3-solution.md", "4-status.md"]:
        text = (folder / name).read_text()
        assert "- **Task:** `01-a-brand-new-spec/`" in text, (name, text)
        assert "new-abcd1234" not in text, (name, text)
    # The rename and the Task: line rewrites land as one commit, not left
    # as an uncommitted working-tree change a landing's own push would
    # never see.
    status = subprocess.run(
        ["git", "-C", str(git_specs_root), "status", "--porcelain"],
        capture_output=True, text=True, check=True,
    ).stdout
    assert status.strip() == "", status
    log = subprocess.run(
        ["git", "-C", str(git_specs_root), "log", "--format=%s"],
        capture_output=True, text=True, check=True,
    ).stdout
    assert "01-a-brand-new-spec" in log.splitlines()[0], log


def test_assign_number_counts_existing_folders_on_disk(script, git_specs_root):
    (git_specs_root / "07-earlier").mkdir()
    (git_specs_root / "archive").mkdir()
    (git_specs_root / "archive" / "12-gone").mkdir()
    rc, out, _ = run(script, git_specs_root, "new-abcd1234", "A brand new spec", "Problem: X.")
    assert rc == 0, out
    commit_all(git_specs_root)
    rc, out, _ = run_assign_number(script, git_specs_root, "new-abcd1234")
    assert rc == 0, out
    assert out["specFolder"] == "13-a-brand-new-spec"


def test_assign_number_refuses_on_a_missing_folder(script, git_specs_root):
    rc, out, _ = run_assign_number(script, git_specs_root, "new-does-not-exist")
    assert rc != 0
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"


def test_assign_number_refuses_when_a_task_line_is_missing(script, git_specs_root):
    """A hand-edited Tracking info section:
    refuse loudly rather than leave a stale Task: line behind."""
    rc, out, _ = run(script, git_specs_root, "new-abcd1234", "A brand new spec", "Problem: X.")
    assert rc == 0, out
    analysis = git_specs_root / "new-abcd1234" / "2-analysis.md"
    text = analysis.read_text().replace("- **Task:** `new-abcd1234/`", "- **Task:** `something-else/`")
    analysis.write_text(text)
    commit_all(git_specs_root)

    rc, out, _ = run_assign_number(script, git_specs_root, "new-abcd1234")
    assert rc != 0
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"
    # Nothing moved: the refusal happens before the git mv.
    assert (git_specs_root / "new-abcd1234").is_dir()
