"""aide-wiki landed: per generated page, the archived specs that landed after
the page was last written and change one of its files — the specs a wiki run
carries the reasons of into that page. A page's starting point is its last
commit in a specs repository of its own, and its own `commit:` line where the
specs live inside the project's repository."""
# The fixtures are imported for pytest to find; the tests take them by name.
# noinspection PyUnusedImports
from .aide_wiki_support import (
    script,
    project,
    specs_repo,
    specs_root,
    call,
    write_page,
    commit_all,
    head,
    hand_written,
)
from ..conftest import git

FIRST = "701-the-first-spec"
SECOND = "702-the-second-spec"


def landed(script, specs_root, project):
    rc, out = call(script, "landed", "--specs-root", specs_root, "--project-dir", project)
    assert rc == 0, out
    assert out["terminalReason"] == "listed", out
    return {entry["page"]: entry["specs"] for entry in out["pages"]}


def analysis(files=None):
    text = "# X - Analysis\n\n## Findings\n\n### Affected files\n\nProse.\n"
    if files is not None:
        text += "\n### Files to change\n\n" + "".join(f"- `{f}`\n" for f in files)
    return text


def archive_spec(specs_root, folder, files=None, status_stamp="**Archived:** 2026-10-09"):
    """A spec folder under archive/, its analysis planning `files` (no section at all for None)."""
    d = specs_root / "archive" / folder
    d.mkdir(parents=True)
    (d / "1-description.md").write_text(f"# {folder} - Description\n")
    (d / "2-analysis.md").write_text(analysis(files))
    (d / "4-status.md").write_text(
        f"# {folder} - Status\n\n## Tracking info\n\n- **Task:** `{folder}/`\n"
        f"- **Workflow steps completed:** create, analyze, implement\n- {status_stamp}\n"
    )
    return d


def write_and_commit(script, specs_repo, specs_root, project, page="a.md", files=("x.txt",), body="# Title\n\nWhat it does.\n"):
    assert write_page(script, specs_root, project, page, list(files), body)[0] == 0
    commit_all(specs_repo, f"wiki {page}")


def test_a_spec_archived_after_the_page_and_naming_its_file_is_named_AC_3(script, specs_repo, specs_root, project):
    write_and_commit(script, specs_repo, specs_root, project)
    archive_spec(specs_root, FIRST, ["x.txt"])
    commit_all(specs_repo, "archive")
    assert landed(script, specs_root, project) == {"a.md": [FIRST]}


def test_a_spec_naming_none_of_the_pages_files_is_not_named_AC_3(script, specs_repo, specs_root, project):
    write_and_commit(script, specs_repo, specs_root, project)
    archive_spec(specs_root, FIRST, ["y.txt"])
    commit_all(specs_repo, "archive")
    assert landed(script, specs_root, project) == {}


def test_a_spec_with_no_list_of_files_is_named_for_every_page_AC_3(script, specs_repo, specs_root, project):
    write_and_commit(script, specs_repo, specs_root, project)
    archive_spec(specs_root, FIRST, None)
    commit_all(specs_repo, "archive")
    assert landed(script, specs_root, project) == {"a.md": [FIRST]}


def test_a_file_named_in_any_round_of_the_analysis_counts_AC_3(script, specs_repo, specs_root, project):
    write_and_commit(script, specs_repo, specs_root, project)
    d = archive_spec(specs_root, FIRST, ["y.txt"])
    with (d / "2-analysis.md").open("a") as f:
        f.write("\n## Round 2\n\n### Files to change\n\n- `x.txt`\n")
    commit_all(specs_repo, "archive")
    assert landed(script, specs_root, project) == {"a.md": [FIRST]}


def test_a_spec_archived_before_the_page_was_written_is_not_named_AC_3(script, specs_repo, specs_root, project):
    archive_spec(specs_root, FIRST, ["x.txt"])
    commit_all(specs_repo, "archive")
    write_and_commit(script, specs_repo, specs_root, project)
    assert landed(script, specs_root, project) == {}


def test_a_closed_spec_and_a_reopened_one_are_not_named_AC_3(script, specs_repo, specs_root, project):
    write_and_commit(script, specs_repo, specs_root, project)
    archive_spec(specs_root, FIRST, ["x.txt"], status_stamp="**Closed:** 2026-10-09 — it did not hold")
    archive_spec(specs_root, SECOND, ["x.txt"])
    commit_all(specs_repo, "archive")
    git(specs_repo, "mv", str(specs_root / "archive" / SECOND), str(specs_root / SECOND))
    commit_all(specs_repo, "reopen")
    assert landed(script, specs_root, project) == {}


def test_a_spec_archived_while_a_wiki_run_ran_is_named_for_the_pages_that_run_wrote_AC_3(
    script, specs_repo, specs_root, project
):
    write_and_commit(script, specs_repo, specs_root, project)
    default = git(specs_repo, "rev-parse", "--abbrev-ref", "HEAD")
    git(specs_repo, "checkout", "-qb", "wiki-run")
    write_and_commit(script, specs_repo, specs_root, project, body="# Title\n\nWhat it does now.\n")
    git(specs_repo, "checkout", "-q", default)
    archive_spec(specs_root, FIRST, ["x.txt"])
    commit_all(specs_repo, "archive")
    git(specs_repo, "merge", "--no-edit", "-q", "wiki-run")
    assert landed(script, specs_root, project) == {"a.md": [FIRST]}


def test_two_specs_archived_one_after_the_other_are_both_named_in_that_order_AC_4(
    script, specs_repo, specs_root, project
):
    write_and_commit(script, specs_repo, specs_root, project)
    archive_spec(specs_root, SECOND, ["x.txt"])
    commit_all(specs_repo, "archive second")
    archive_spec(specs_root, FIRST, ["x.txt"])
    commit_all(specs_repo, "archive first")
    assert landed(script, specs_root, project) == {"a.md": [SECOND, FIRST]}


def test_a_page_never_committed_and_a_hand_written_page_are_left_out_AC_3(script, specs_repo, specs_root, project):
    hand_written(specs_root)
    commit_all(specs_repo, "notes")
    write_page(script, specs_root, project, "a.md", ["x.txt"])
    archive_spec(specs_root, FIRST, ["x.txt"])
    git(specs_repo, "add", "aide/archive")
    git(specs_repo, "commit", "-qm", "archive, the page left uncommitted")
    assert landed(script, specs_root, project) == {}


def test_no_wiki_names_no_pages_AC_3(script, specs_repo, specs_root, project):
    archive_spec(specs_root, FIRST, ["x.txt"])
    commit_all(specs_repo, "archive")
    assert landed(script, specs_root, project) == {}


def inside_the_project(project):
    """A specs root in the project's own repository."""
    root = project / "specs" / "aide"
    root.mkdir(parents=True)
    (root / "keep").write_text("")
    commit_all(project, "specs root")
    return root


def test_where_the_specs_live_in_the_project_the_pages_own_commit_is_the_starting_point_AC_3(script, project):
    root = inside_the_project(project)
    written_from = head(project)
    assert write_page(script, root, project, "a.md", ["x.txt"])[0] == 0
    commit_all(project, "wiki run")
    archive_spec(root, FIRST, ["x.txt"])
    commit_all(project, "archive")
    # The landing of a wiki run is a copy on top of the default branch: a later commit that changes the page.
    page = root / "wiki" / "a.md"
    page.write_text(page.read_text() + "\nA line the copy added.\n")
    commit_all(project, "copy of the wiki run")
    assert f"commit: {written_from}" in page.read_text()
    assert landed(script, root, project) == {"a.md": [FIRST]}


def test_a_page_whose_commit_git_does_not_know_is_left_out_AC_3(script, project):
    root = inside_the_project(project)
    assert write_page(script, root, project, "a.md", ["x.txt"])[0] == 0
    page = root / "wiki" / "a.md"
    page.write_text(page.read_text().replace(head(project), "0" * 40))
    archive_spec(root, FIRST, ["x.txt"])
    commit_all(project, "archive")
    assert landed(script, root, project) == {}
