"""Tests for core/scripts/aide-wiki — the mechanics of a project's wiki:
the generated mark, refusing a hand-written page, the index, pruning,
which pages are current, and what a run may have touched.

No AI is involved: the model decides what the parts are and what a page
says; this script decides everything that can be checked.
"""
import json
import re
import subprocess
import textwrap

import pytest

from ..conftest import git
# The fixtures are imported for pytest to find; the tests take them by name.
from .aide_wiki_support import (
    script,
    project,
    specs_repo,
    specs_root,
    call,
    write_page,
    build_index,
    status,
    head,
    commit_all,
    hand_written,
    verify,
)


def test_the_script_answers_help(script):
    proc = subprocess.run([str(script), "--help"], capture_output=True, text=True)
    assert proc.returncode == 0
    for name in ("write", "schema", "index", "prune", "status", "verify"):
        assert name in proc.stdout


# --- AC-3: the mark, the commit and the files --------------------------------


def test_a_written_page_carries_the_mark_the_commit_and_its_files_AC_3(script, specs_root, project):
    rc, out = write_page(script, specs_root, project, "queue.md", ["x.txt", "dir/z.txt"], "# The queue\n\nRuns things.\n")
    assert rc == 0, out
    assert out["ok"] is True and out["terminalReason"] == "written"
    text = (specs_root / "wiki" / "queue.md").read_text()
    assert text.startswith("---\nwiki: generated\n")
    assert f"commit: {head(project)}\n" in text
    assert "files:\n  - x.txt\n  - dir/z.txt\n---\n" in text
    assert text.endswith("# The queue\n\nRuns things.\n")


def test_a_file_that_is_not_in_the_project_is_refused_and_nothing_is_written_AC_3(script, specs_root, project):
    rc, out = write_page(script, specs_root, project, "queue.md", ["x.txt", "nowhere.txt"])
    assert rc == 2
    assert out["reason"] == "unknown-file"
    assert not (specs_root / "wiki" / "queue.md").exists()


def test_a_folder_is_refused_as_a_page_s_source(script, specs_root, project):
    """A page written from a folder reads as stale whenever anything in it
    changes: the first build named whole folders, and every page did."""
    rc, out = write_page(script, specs_root, project, "a.md", ["dir"])
    assert out["reason"] == "folder-not-file", out
    assert not (specs_root / "wiki" / "a.md").exists()
    assert write_page(script, specs_root, project, "a.md", ["dir/z.txt"])[1]["ok"] is True


def test_a_file_the_page_names_in_its_text_is_one_of_its_sources(script, specs_root, project):
    """The design-system page named eighteen stylesheets in its text and
    listed five as sources, so thirteen could change with the page still
    reading as current."""
    body = "# The page\n\nDraws with `y.txt` and `dir/z.txt`; `not/there.txt` and `dir` are ignored.\n"
    rc, out = write_page(script, specs_root, project, "page.md", ["x.txt"], body)
    assert rc == 0, out
    text = (specs_root / "wiki" / "page.md").read_text()
    assert "files:\n  - x.txt\n  - y.txt\n  - dir/z.txt\n---\n" in text


def test_a_page_needs_files_a_body_and_a_plain_name_AC_3(script, specs_root, project):
    assert write_page(script, specs_root, project, "a.md", [])[1]["reason"] == "no-file"
    assert write_page(script, specs_root, project, "a.md", ["x.txt"], "")[1]["reason"] == "empty-body"
    assert write_page(script, specs_root, project, "A b.md", ["x.txt"])[1]["reason"] == "bad-page-name"
    for reserved in ("index.md", "schema.md"):
        assert write_page(script, specs_root, project, reserved, ["x.txt"])[1]["reason"] == "reserved-page-name"


def test_the_schema_and_the_index_carry_the_mark_and_the_commit_and_no_files_AC_3(script, specs_root, project):
    rc, out = call(script, "schema", "--specs-root", specs_root, "--project-dir", project)
    assert rc == 0, out
    build_index(script, specs_root, project)
    for name in ("schema.md", "index.md"):
        text = (specs_root / "wiki" / name).read_text()
        assert text.startswith("---\nwiki: generated\n")
        assert f"commit: {head(project)}\n" in text
        assert "files: []\n" in text
    schema = (specs_root / "wiki" / "schema.md").read_text()
    for key in ("wiki", "commit", "files"):
        assert f"`{key}`" in schema


# --- AC-2: the index and the schema ------------------------------------------


def test_the_index_has_one_line_per_page_but_itself_AC_2(script, specs_root, project):
    write_page(script, specs_root, project, "b.md", ["x.txt"], "# Bee\n\nThe b part.\nMore.\n")
    write_page(script, specs_root, project, "a.md", ["y.txt"], "# Ay\n\n\nThe a part.\n")
    call(script, "schema", "--specs-root", specs_root, "--project-dir", project)
    rc, out = build_index(script, specs_root, project)
    assert rc == 0, out
    assert sorted(p.name for p in (specs_root / "wiki").iterdir()) == ["a.md", "b.md", "index.md", "schema.md"]
    lines = [l for l in (specs_root / "wiki" / "index.md").read_text().splitlines() if l.startswith("- ")]
    assert len(lines) == 3
    assert lines[0] == "- [Ay](a.md) — The a part."
    assert lines[1] == "- [Bee](b.md) — The b part."
    assert lines[2].startswith("- [") and "](schema.md) — " in lines[2]
    assert "](index.md)" not in (specs_root / "wiki" / "index.md").read_text()


def test_a_folder_named_wiki_is_not_taken_for_a_spec_when_numbering_AC_2(workspace_root, specs_root):
    (specs_root / "wiki").mkdir()
    (specs_root / "wiki" / "index.md").write_text("x\n")
    (specs_root / "07-seventh").mkdir()
    lib = workspace_root / "core" / "scripts" / "_aide-spec-lib.sh"
    proc = subprocess.run(
        ["bash", "-c", f'source "{lib}"; aide_next_spec_number "{specs_root}"'],
        capture_output=True, text=True,
    )
    assert proc.stdout.strip() == "08"


# --- AC-2 / AC-4: prune ------------------------------------------------------


def test_prune_deletes_a_generated_page_that_is_not_kept_and_the_index_forgets_it_AC_2(script, specs_root, project):
    write_page(script, specs_root, project, "old.md", ["x.txt"])
    write_page(script, specs_root, project, "keep.md", ["y.txt"])
    rc, out = call(script, "prune", "--specs-root", specs_root, "--keep", "keep.md")
    assert rc == 0, out
    assert not (specs_root / "wiki" / "old.md").exists()
    assert (specs_root / "wiki" / "keep.md").exists()
    build_index(script, specs_root, project)
    assert "old.md" not in (specs_root / "wiki" / "index.md").read_text()




def test_a_hand_written_page_is_never_overwritten_pruned_or_left_out_of_the_index_AC_4(script, specs_root, project):
    text = hand_written(specs_root)
    rc, out = write_page(script, specs_root, project, "notes.md", ["x.txt"])
    assert rc == 2 and out["reason"] == "hand-written-page"
    assert (specs_root / "wiki" / "notes.md").read_text() == text
    call(script, "prune", "--specs-root", specs_root, "--keep", "other.md")
    assert (specs_root / "wiki" / "notes.md").read_text() == text
    build_index(script, specs_root, project)
    assert "- [Notes](notes.md) — Written by a person." in (specs_root / "wiki" / "index.md").read_text()


def test_a_hand_written_index_or_schema_is_left_as_it_is_and_the_subcommand_refuses_AC_4(script, specs_root, project):
    for name, args in (("index.md", ["index"]), ("schema.md", ["schema"])):
        text = hand_written(specs_root, name, "# Mine\n\nHand made.\n")
        rc, out = call(script, *args, "--specs-root", specs_root, "--project-dir", project)
        assert rc == 2 and out["reason"] == "hand-written-page"
        assert (specs_root / "wiki" / name).read_text() == text


def test_an_index_and_schema_whose_text_is_unchanged_are_left_as_they_are(script, specs_root, project):
    """Two runs that each restamp the index with their own commit collide
    on that one line when both land, though neither changed a page."""
    write_page(script, specs_root, project, "a.md", ["x.txt"])
    call(script, "schema", "--specs-root", specs_root, "--project-dir", project)
    build_index(script, specs_root, project)
    before = {n: (specs_root / "wiki" / n).read_text() for n in ("index.md", "schema.md")}
    (project / "x.txt").write_text("moved\n")
    commit_all(project, "the code moved")
    call(script, "schema", "--specs-root", specs_root, "--project-dir", project)
    build_index(script, specs_root, project)
    for name, text in before.items():
        assert (specs_root / "wiki" / name).read_text() == text, name


def test_an_index_whose_pages_changed_is_written_from_the_new_commit(script, specs_root, project):
    write_page(script, specs_root, project, "a.md", ["x.txt"])
    build_index(script, specs_root, project)
    (project / "x.txt").write_text("moved\n")
    commit_all(project, "the code moved")
    write_page(script, specs_root, project, "b.md", ["y.txt"], "# Bee\n\nThe b part.\n")
    build_index(script, specs_root, project)
    text = (specs_root / "wiki" / "index.md").read_text()
    assert f"commit: {head(project)}\n" in text
    assert "](b.md)" in text


def test_building_again_rewrites_generated_pages_from_the_new_commit_and_keeps_hand_written_ones_AC_4(
    script, specs_root, project
):
    hand = hand_written(specs_root)
    write_page(script, specs_root, project, "a.md", ["x.txt"])
    write_page(script, specs_root, project, "gone.md", ["y.txt"])
    first = head(project)
    (project / "x.txt").write_text("moved\n")
    commit_all(project, "the code moved")
    write_page(script, specs_root, project, "a.md", ["x.txt"], "# A again\n\nNow.\n")
    call(script, "prune", "--specs-root", specs_root, "--keep", "a.md")
    build_index(script, specs_root, project)
    page = (specs_root / "wiki" / "a.md").read_text()
    assert f"commit: {head(project)}\n" in page and first not in page
    assert not (specs_root / "wiki" / "gone.md").exists()
    assert (specs_root / "wiki" / "notes.md").read_text() == hand


# --- AC-4: verify ------------------------------------------------------------


def test_verify_names_each_change_to_a_hand_written_page_and_each_unmarked_page_AC_4(script, specs_root, project, specs_repo):
    hand_written(specs_root, "edited.md")
    hand_written(specs_root, "deleted.md")
    write_page(script, specs_root, project, "gen.md", ["x.txt"])
    git(specs_repo, "add", "-A")
    git(specs_repo, "commit", "-qm", "a wiki")
    (specs_root / "wiki" / "edited.md").write_text("# Edited\n\nChanged.\n")
    (specs_root / "wiki" / "deleted.md").unlink()
    (specs_root / "wiki" / "unmarked.md").write_text("# Loose\n\nNo mark.\n")
    write_page(script, specs_root, project, "gen.md", ["y.txt"], "# Gen\n\nRewritten.\n")
    assert verify(script, specs_root) == [
        ("hand-written-changed", "edited.md"),
        ("hand-written-deleted", "deleted.md"),
        ("unmarked-page", "unmarked.md"),
    ]


def test_verify_finds_nothing_when_only_generated_pages_changed_AC_4(script, specs_root, project, specs_repo):
    hand_written(specs_root)
    write_page(script, specs_root, project, "gen.md", ["x.txt"])
    git(specs_repo, "add", "-A")
    git(specs_repo, "commit", "-qm", "a wiki")
    write_page(script, specs_root, project, "gen.md", ["y.txt"], "# Gen\n\nRewritten.\n")
    write_page(script, specs_root, project, "new.md", ["y.txt"])
    assert verify(script, specs_root) == []


# --- AC-5: status ------------------------------------------------------------


def test_status_tells_current_changed_unknown_and_hand_written_apart_AC_5(script, specs_root, project):
    hand_written(specs_root)
    write_page(script, specs_root, project, "steady.md", ["x.txt"])
    write_page(script, specs_root, project, "moving.md", ["y.txt", "dir/z.txt"])
    old = (specs_root / "wiki" / "steady.md").read_text().replace(head(project), "0" * 40)
    (specs_root / "wiki" / "lost.md").write_text(old)
    (project / "dir" / "z.txt").write_text("z moved\n")
    commit_all(project, "dir moved")
    pages = {p["page"]: p for p in status(script, specs_root, project)["pages"]}
    assert pages["steady.md"]["state"] == "current"
    assert pages["moving.md"]["state"] == "changed"
    assert pages["moving.md"]["changedFiles"] == ["dir/z.txt"]
    assert pages["lost.md"]["state"] == "unknown"
    assert pages["notes.md"]["state"] == "hand-written"
    assert pages["notes.md"]["generated"] is False
    assert status(script, specs_root, project)["commit"] == head(project)


def prompt_filters(workspace_root):
    """The two fenced jq blocks of the weekly check's prompt: the pages to
    check, then the pages to skip."""
    text = (workspace_root / "docs" / "prompts" / "wiki-check.md").read_text()
    blocks = re.findall(r"^[ ]*```jq\n(.*?)^[ ]*```", text, re.S | re.M)
    assert len(blocks) == 2, "the prompt must give exactly two fenced jq blocks: the pages to check, then the pages to skip"
    return [textwrap.dedent(b) for b in blocks]


def run_filter(flt, answer):
    proc = subprocess.run(["jq", "-r", flt], input=json.dumps(answer), capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
    return proc.stdout.split()


def test_the_weekly_check_picks_its_pages_with_the_filters_its_prompt_gives_AC_1_AC_2_AC_3(
    script, specs_root, project, workspace_root
):
    write_page(script, specs_root, project, "a.md", ["x.txt"])
    write_page(script, specs_root, project, "b.md", ["y.txt"])
    hand_written(specs_root)
    assert call(script, "schema", "--specs-root", specs_root, "--project-dir", project)[0] == 0
    assert build_index(script, specs_root, project)[0] == 0
    answer = status(script, specs_root, project)
    check_filter, skip_filter = prompt_filters(workspace_root)
    checked, skipped = run_filter(check_filter, answer), run_filter(skip_filter, answer)
    assert sorted(checked) == ["a.md", "b.md", "index.md", "schema.md"]
    assert skipped == ["notes.md"]
    for page in (p["page"] for p in answer["pages"] if p["generated"]):
        assert (page in checked) != (page in skipped), page


def test_status_of_a_project_with_no_wiki_says_so_AC_6(script, specs_root, project):
    rc, out = call(script, "status", "--specs-root", specs_root, "--project-dir", project)
    assert rc == 0
    assert out == {"ok": True, "wiki": False, "pages": []}


def test_removed_commands_refuse_without_writing_AC_4(script, specs_root):
    for command in ("decision", "decisions", "decision-scope"):
        rc, out = call(script, command, "--specs-root", specs_root)
        assert rc == 2 and out["reason"] == "unknown-subcommand", out
    assert not (specs_root / "wiki").exists()


def test_write_keeps_current_reason_and_tracks_its_source_without_backlinks_AC_1_AC_2(
    script, specs_root, project
):
    reason = "- Change `y.txt`, and x must follow, because they share a format.\n"
    body = "# P\n\nCurrent rule.\n\n## Ripples\n\n" + reason
    for _ in range(2):
        assert write_page(script, specs_root, project, "p.md", ["x.txt"], body)[0] == 0
        text = (specs_root / "wiki/p.md").read_text()
        assert text.count(reason) == 1
        assert "## Decisions" not in text
        assert "  - y.txt\n" in text
    (project / "y.txt").write_text("changed\n")
    commit_all(project, "change source")
    page = next(p for p in status(script, specs_root, project)["pages"] if p["page"] == "p.md")
    assert page["changedFiles"] == ["y.txt"]


# --- the project's overview and its reusable parts ---------------------------

FIXED_PAGES = {
    "overview.md": ["## Stack", "## Services", "## Build and deploy", "## Docs"],
    "reusable-parts.md": ["## Parts", "## Rules"],
}


def fixed_body(page, leaving_out=None):
    headings = [h for h in FIXED_PAGES[page] if h != leaving_out]
    return "# The page\n\nWhat it holds.\n\n" + "".join(f"{h}\n\nSomething under it.\n\n" for h in headings)


@pytest.mark.parametrize(
    "page,lacking",
    [(page, h) for page, headings in sorted(FIXED_PAGES.items()) for h in headings],
)
def test_the_overview_and_the_reusable_parts_are_refused_without_a_section_AC_1_AC_3(
    script, specs_root, project, page, lacking
):
    rc, out = write_page(script, specs_root, project, page, ["x.txt"], fixed_body(page, lacking))
    assert rc == 2 and out["reason"] == "missing-section", out
    assert lacking in out["error"], out
    assert not (specs_root / "wiki" / page).exists()


@pytest.mark.parametrize("page", sorted(FIXED_PAGES))
def test_the_overview_and_the_reusable_parts_are_written_with_every_section_AC_1_AC_3(
    script, specs_root, project, page
):
    rc, out = write_page(script, specs_root, project, page, ["x.txt"], fixed_body(page))
    assert rc == 0 and out["terminalReason"] == "written", out
    assert (specs_root / "wiki" / page).read_text().startswith("---\nwiki: generated\n")


def test_status_names_the_fixed_pages_a_wiki_lacks_and_counts_a_hand_written_one_AC_1_AC_3(
    script, specs_root, project
):
    write_page(script, specs_root, project, "a.md", ["x.txt"])
    assert status(script, specs_root, project)["missing"] == ["overview.md", "reusable-parts.md"]
    hand_written(specs_root, "overview.md", "# Overview\n\nWritten by a person.\n")
    assert status(script, specs_root, project)["missing"] == ["reusable-parts.md"]
    write_page(script, specs_root, project, "reusable-parts.md", ["x.txt"], fixed_body("reusable-parts.md"))
    assert status(script, specs_root, project)["missing"] == []
