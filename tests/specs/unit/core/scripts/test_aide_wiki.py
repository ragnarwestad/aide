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

from .conftest import git, init_repo


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-wiki"


@pytest.fixture
def project(tmp_path):
    repo = init_repo(tmp_path / "proj")
    (repo / "x.txt").write_text("x\n")
    (repo / "y.txt").write_text("y\n")
    (repo / "dir").mkdir()
    (repo / "dir" / "z.txt").write_text("z\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "files")
    return repo


@pytest.fixture
def specs_repo(tmp_path):
    return init_repo(tmp_path / "specs")


@pytest.fixture
def specs_root(specs_repo):
    root = specs_repo / "aide"
    root.mkdir()
    (root / "01-first").mkdir()
    (root / "01-first" / "1-description.md").write_text("# First\n")
    git(specs_repo, "add", "-A")
    git(specs_repo, "commit", "-qm", "specs")
    return root


def call(script, *args, stdin=""):
    proc = subprocess.run([str(script), *map(str, args)], input=stdin, capture_output=True, text=True)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line)


def write_page(script, specs_root, project, page, files, body="# Title\n\nWhat it does.\n"):
    args = ["write", "--specs-root", specs_root, "--project-dir", project, "--page", page]
    for f in files:
        args += ["--file", f]
    return call(script, *args, stdin=body)


def build_index(script, specs_root, project):
    return call(script, "index", "--specs-root", specs_root, "--project-dir", project)


def status(script, specs_root, project):
    return call(script, "status", "--specs-root", specs_root, "--project-dir", project)[1]


def head(repo):
    return git(repo, "rev-parse", "HEAD")


def commit_all(repo, message):
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", message)


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


# --- AC-4: hand-written pages are left alone ---------------------------------


def hand_written(specs_root, name="notes.md", text="# Notes\n\nWritten by a person.\n"):
    (specs_root / "wiki").mkdir(exist_ok=True)
    (specs_root / "wiki" / name).write_text(text)
    return text


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


def verify(script, specs_root, ref="HEAD"):
    rc, out = call(script, "verify", "--specs-root", specs_root, "--base-ref", ref)
    assert rc == 0, out
    return sorted((v["kind"], v["page"]) for v in out["violations"])


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


QUOTES_THE_MARK = "# Decisions\n\nA decision page has `wiki: decision` in its front matter.\n\nwiki: decision\n"


def test_status_says_a_generated_page_that_quotes_the_decision_mark_is_no_decision_AC_1(script, specs_root, project):
    write_page(script, specs_root, project, "a.md", ["x.txt"], QUOTES_THE_MARK)
    page = {p["page"]: p for p in status(script, specs_root, project)["pages"]}["a.md"]
    assert page["generated"] is True
    assert page["decision"] is False
    assert page["state"] == "current"


def test_status_names_a_decision_page_from_its_front_matter_alone_AC_2(script, specs_root, project):
    write_page(script, specs_root, project, "b.md", ["x.txt"])
    assert decide(script, specs_root, concerns=("b.md",))[0] == 0
    hand_written(specs_root, "decision-hand.md", HAND_DECISION.replace("p.md", "b.md"))
    hand_written(specs_root, "notes.md", "# Notes\n\nA decision has `wiki: decision` in its front matter.\n\nwiki: decision\n")
    pages = {p["page"]: p for p in status(script, specs_root, project)["pages"]}
    for name in ("decision-x.md", "decision-hand.md"):
        assert pages[name]["generated"] is False, name
        assert pages[name]["decision"] is True, name
        assert pages[name]["state"] == "hand-written", name
    assert pages["notes.md"]["decision"] is False


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
    write_page(script, specs_root, project, "a.md", ["x.txt"], QUOTES_THE_MARK)
    write_page(script, specs_root, project, "b.md", ["y.txt"])
    assert decide(script, specs_root, concerns=("b.md",))[0] == 0
    hand_written(specs_root)
    assert call(script, "schema", "--specs-root", specs_root, "--project-dir", project)[0] == 0
    assert build_index(script, specs_root, project)[0] == 0
    answer = status(script, specs_root, project)
    check_filter, skip_filter = prompt_filters(workspace_root)
    checked, skipped = run_filter(check_filter, answer), run_filter(skip_filter, answer)
    assert sorted(checked) == ["a.md", "b.md", "index.md", "schema.md"]
    assert skipped == ["decision-x.md"]
    for page in (p["page"] for p in answer["pages"] if p["generated"]):
        assert (page in checked) != (page in skipped), page


def test_status_of_a_project_with_no_wiki_says_so_AC_6(script, specs_root, project):
    rc, out = call(script, "status", "--specs-root", specs_root, "--project-dir", project)
    assert rc == 0
    assert out == {"ok": True, "wiki": False, "pages": []}


# --- `affected`: which pages a file set (a spec's own diff) touches ---------


def affected(script, specs_root, project):
    rc, out = call(script, "affected", "--specs-root", specs_root, "--project-dir", project)
    assert rc == 0, out
    return out


def test_affected_returns_a_page_whose_files_overlap_the_diff_since_merge_base_AC_1(
    script, specs_root, project
):
    write_page(script, specs_root, project, "p.md", ["x.txt"])
    git(project, "checkout", "-q", "-b", "feature")
    (project / "x.txt").write_text("changed\n")
    commit_all(project, "touch x")
    out = affected(script, specs_root, project)
    assert out["pages"] == [{"page": "p.md", "files": ["x.txt"]}]


def test_affected_omits_a_page_whose_files_do_not_overlap_AC_2(script, specs_root, project):
    write_page(script, specs_root, project, "p.md", ["y.txt"])
    git(project, "checkout", "-q", "-b", "feature")
    (project / "x.txt").write_text("changed\n")
    commit_all(project, "touch x")
    assert affected(script, specs_root, project)["pages"] == []


def test_affected_omits_a_hand_written_page_even_when_its_files_overlap_AC_3(
    script, specs_root, project
):
    hand_written(
        specs_root, "notes.md",
        "---\nfiles:\n  - x.txt\n---\n\n# Notes\n\nWritten by a person.\n",
    )
    git(project, "checkout", "-q", "-b", "feature")
    (project / "x.txt").write_text("changed\n")
    commit_all(project, "touch x")
    assert affected(script, specs_root, project)["pages"] == []


def test_affected_is_empty_when_the_branch_has_not_diverged_AC_4(script, specs_root, project):
    write_page(script, specs_root, project, "p.md", ["x.txt"])
    assert affected(script, specs_root, project)["pages"] == []


def test_affected_is_empty_for_a_project_with_no_wiki_AC_5(script, project, tmp_path):
    empty_specs = init_repo(tmp_path / "no-wiki-specs")
    assert affected(script, empty_specs, project)["pages"] == []


def test_affected_resolves_a_non_main_default_branch_via_origin_head(script, tmp_path, specs_root):
    """A repo whose default branch is not literally `main` still resolves
    the right merge-base — `default_branch_of`'s own fallback, mirroring
    run-spec-gates.sh's `default_branch()`."""
    bare = tmp_path / "origin.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "trunk", str(bare)], check=True)
    seed = init_repo(tmp_path / "seed")
    git(seed, "branch", "-m", "trunk")
    (seed / "x.txt").write_text("x\n")
    git(seed, "add", "-A")
    git(seed, "commit", "-qm", "seed x")
    git(seed, "push", "-q", str(bare), "trunk")
    project = tmp_path / "clone"
    subprocess.run(["git", "clone", "-q", str(bare), str(project)], check=True)
    subprocess.run(["git", "-C", str(project), "config", "user.name", "Test"], check=True)
    subprocess.run(["git", "-C", str(project), "config", "user.email", "test@example.com"], check=True)
    write_page(script, specs_root, project, "p.md", ["x.txt"])
    git(project, "checkout", "-q", "-b", "feature")
    (project / "x.txt").write_text("changed\n")
    commit_all(project, "touch x")
    assert affected(script, specs_root, project)["pages"] == [{"page": "p.md", "files": ["x.txt"]}]


def test_affected_drops_a_file_the_diff_deleted_but_keeps_the_pages_others_AC_1(
    script, specs_root, project
):
    """A page naming two files where the spec deletes one is still
    affected, but the deleted file is dropped from what `affected`
    hands back — `aide-wiki write` refuses any file no longer at HEAD,
    so passing it straight through would break the rewrite."""
    write_page(script, specs_root, project, "p.md", ["x.txt", "y.txt"])
    git(project, "checkout", "-q", "-b", "feature")
    (project / "x.txt").unlink()
    commit_all(project, "delete x")
    assert affected(script, specs_root, project)["pages"] == [{"page": "p.md", "files": ["y.txt"]}]


def test_affected_omits_a_page_whose_only_named_file_the_diff_deleted_AC_1(
    script, specs_root, project
):
    """A page with nothing left to rewrite it from is left out entirely,
    rather than handed to `aide-wiki write` with an empty --file list."""
    write_page(script, specs_root, project, "p.md", ["x.txt"])
    git(project, "checkout", "-q", "-b", "feature")
    (project / "x.txt").unlink()
    commit_all(project, "delete x")
    assert affected(script, specs_root, project)["pages"] == []


def test_write_accepts_the_file_list_affected_returns_after_a_deletion_AC_1(
    script, specs_root, project
):
    """End to end: the archive step passes `affected`'s own file list
    straight to `write`, which must not refuse it as unknown-file."""
    write_page(script, specs_root, project, "p.md", ["x.txt", "y.txt"])
    git(project, "checkout", "-q", "-b", "feature")
    (project / "x.txt").unlink()
    commit_all(project, "delete x")
    surviving = affected(script, specs_root, project)["pages"][0]["files"]
    rc, out = write_page(script, specs_root, project, "p.md", surviving, "# Title\n\nRewritten.\n")
    assert rc == 0, out


# --- decisions: pages a spec records, and the section that links back --------


def decide(script, specs_root, page="decision-x.md", concerns=("p.md",), spec="01-first",
           title="A decision", line="Keep it.", reason="Because a build never sees it.\n"):
    args = ["decision", "--specs-root", specs_root, "--page", page, "--spec", spec,
            "--title", title, "--decision", line, "--concerns", *concerns]
    return call(script, *args, stdin=reason)


def read(specs_root, name):
    return (specs_root / "wiki" / name).read_text()


def front_of(text):
    return text.split("---\n")[1]


def listing(specs_root):
    return {p.name: p.read_text() for p in (specs_root / "wiki").iterdir()}


def decision_section(text):
    return text.split("\n## Decisions\n", 1)[1] if "\n## Decisions\n" in text else None


HAND_DECISION = "---\nwiki: decision\nspec: 01-first\n---\n\n# By hand\n\nKeep pages.\n\n## Concerns\n\n- [P](p.md)\n"


def test_a_decision_writes_its_page_and_the_page_it_concerns_links_back_AC_1(script, specs_root, project):
    write_page(script, specs_root, project, "p.md", ["x.txt"])
    before = read(specs_root, "p.md")
    rc, out = decide(script, specs_root, reason="A build rewrites every page from the code.\n")
    assert rc == 0, out
    assert out["ok"] is True and out["terminalReason"] == "written"
    assert out["page"] == "decision-x.md" and out["concerns"] == ["p.md"]
    decision = read(specs_root, "decision-x.md")
    assert decision.startswith("---\nwiki: decision\nspec: 01-first\n---\n")
    assert "Keep it." in decision and "A build rewrites every page from the code." in decision
    assert "](p.md)" in decision and "01-first" in decision
    after = read(specs_root, "p.md")
    assert after.startswith(before)
    assert after.count("## Decisions") == 1 and "](decision-x.md)" in decision_section(after)
    assert front_of(after) == front_of(before)
    pages = {p["page"]: p["state"] for p in status(script, specs_root, project)["pages"]}
    assert pages["p.md"] == "current"


def test_a_decision_may_name_a_spec_that_is_already_archived_AC_1(script, specs_root, project):
    (specs_root / "archive" / "02-old").mkdir(parents=True)
    write_page(script, specs_root, project, "p.md", ["x.txt"])
    rc, out = decide(script, specs_root, spec="02-old")
    assert rc == 0, out
    assert "spec: 02-old\n" in read(specs_root, "decision-x.md")


@pytest.mark.parametrize(
    "reason,change",
    [
        ("bad-page-name", {"page": "x.md"}),
        ("bad-page-name", {"page": "decision-X.md"}),
        ("bad-spec", {"spec": "99-nowhere"}),
        ("bad-spec", {"spec": "../01-first"}),
        ("bad-spec", {"spec": ".."}),
        ("bad-title", {"title": ""}),
        ("bad-title", {"title": "one\ntwo"}),
        ("bad-decision", {"line": ""}),
        ("bad-decision", {"line": "one\ntwo"}),
        ("no-reason", {"reason": ""}),
        ("no-reason", {"reason": "\n  \n"}),
        ("no-concern", {"concerns": ()}),
        ("unknown-concern", {"concerns": ("nowhere.md",)}),
        ("unknown-concern", {"concerns": ("p.md", "nowhere.md")}),
        ("concern-not-generated", {"concerns": ("notes.md",)}),
        ("concern-not-generated", {"concerns": ("decision-old.md",)}),
        ("concern-not-generated", {"concerns": ("index.md",)}),
        ("concern-not-generated", {"concerns": ("schema.md",)}),
        ("page-exists", {"page": "decision-old.md"}),
    ],
)
def test_a_decision_that_cannot_be_recorded_is_refused_and_writes_no_file_AC_1(script, specs_root, project, reason, change):
    write_page(script, specs_root, project, "p.md", ["x.txt"])
    hand_written(specs_root)
    assert decide(script, specs_root, page="decision-old.md")[0] == 0
    call(script, "schema", "--specs-root", specs_root, "--project-dir", project)
    build_index(script, specs_root, project)
    before = listing(specs_root)
    rc, out = decide(script, specs_root, **change)
    assert rc == 2 and out["ok"] is False and out["reason"] == reason, out
    assert listing(specs_root) == before


def test_write_keeps_recomputes_and_cuts_the_decisions_section_AC_1(script, specs_root, project):
    write_page(script, specs_root, project, "p.md", ["x.txt"])
    decide(script, specs_root)
    body = "# Title\n\nRewritten.\n"
    assert write_page(script, specs_root, project, "p.md", ["x.txt"], body)[0] == 0
    once = read(specs_root, "p.md")
    assert once.endswith(body + "\n## Decisions\n\n- [A decision](decision-x.md) — Keep it.\n")
    assert once.count("## Decisions") == 1
    # The same body again gives the same bytes; so does a body that carries a stale
    # section, and one that carries the section as the page itself now has it.
    write_page(script, specs_root, project, "p.md", ["x.txt"], body)
    assert read(specs_root, "p.md") == once
    stale = body + "\n## Decisions\n\n- [Gone](decision-gone.md) — Gone.\n"
    write_page(script, specs_root, project, "p.md", ["x.txt"], stale)
    assert read(specs_root, "p.md") == once
    whole = once.split("---\n", 2)[2].lstrip("\n")
    write_page(script, specs_root, project, "p.md", ["x.txt"], whole)
    assert read(specs_root, "p.md") == once


def test_a_section_in_the_middle_of_a_body_is_cut_out_and_the_rest_stays_AC_1(script, specs_root, project):
    write_page(script, specs_root, project, "p.md", ["x.txt"])
    decide(script, specs_root)
    body = "# Title\n\nWhat it does.\n\n## Decisions\n\n- [Gone](decision-gone.md) — Gone.\n\n## Words\n\n- a word\n"
    write_page(script, specs_root, project, "p.md", ["x.txt"], body)
    text = read(specs_root, "p.md")
    assert "decision-gone.md" not in text
    assert "## Words\n\n- a word\n" in text and text.count("## Decisions") == 1
    assert text.index("## Words") < text.index("## Decisions")


def test_a_decisions_heading_inside_a_code_block_is_not_a_section_AC_1(script, specs_root, project):
    body = "# Title\n\nWhat it does.\n\n```\n## Decisions\n\n- kept\n```\n"
    write_page(script, specs_root, project, "p.md", ["x.txt"], body)
    assert read(specs_root, "p.md").endswith(body)


def test_a_decision_line_that_names_a_file_adds_no_source_to_the_page_AC_1(script, specs_root, project):
    write_page(script, specs_root, project, "p.md", ["x.txt"])
    decide(script, specs_root, line="Never touch `y.txt` here.")
    write_page(script, specs_root, project, "p.md", ["x.txt"], "# Title\n\nWhat it does.\n")
    text = read(specs_root, "p.md")
    assert "`y.txt`" in text
    assert "files:\n  - x.txt\n---\n" in text
    assert {p["page"]: p["state"] for p in status(script, specs_root, project)["pages"]}["p.md"] == "current"


def test_a_page_no_decision_links_to_is_written_as_it_always_was_AC_1(script, specs_root, project):
    write_page(script, specs_root, project, "p.md", ["x.txt"])
    decide(script, specs_root)
    body = "# Other\n\nNo decision here.\n"
    write_page(script, specs_root, project, "q.md", ["y.txt"], body)
    assert read(specs_root, "q.md") == f"---\nwiki: generated\ncommit: {head(project)}\nfiles:\n  - y.txt\n---\n\n{body}"
    stale = body + "\n## Decisions\n\n- [Gone](decision-gone.md) — Gone.\n"
    write_page(script, specs_root, project, "q.md", ["y.txt"], stale)
    assert read(specs_root, "q.md").endswith(body)


# --- what an archive may add under wiki/ --------------------------------------


def scope(script, specs_root, spec="01-first", ref="HEAD"):
    rc, out = call(script, "decision-scope", "--specs-root", specs_root, "--base-ref", ref, "--spec", spec)
    assert rc == 0, out
    return out


def landed_wiki(script, specs_root, project, specs_repo):
    """Two generated pages, a hand-written one and an index, committed."""
    write_page(script, specs_root, project, "p.md", ["x.txt"])
    write_page(script, specs_root, project, "q.md", ["y.txt"])
    hand_written(specs_root)
    build_index(script, specs_root, project)
    commit_all(specs_repo, "a wiki")


def test_a_recorded_decision_is_allowed_with_the_index_and_the_page_it_links_AC_1(script, specs_root, project, specs_repo):
    landed_wiki(script, specs_root, project, specs_repo)
    decide(script, specs_root, concerns=("q.md",))
    build_index(script, specs_root, project)
    out = scope(script, specs_root)
    assert sorted(out["allowed"]) == ["decision-x.md", "index.md", "q.md"]
    assert out["rejected"] == []


def test_a_new_decision_that_names_another_spec_or_has_no_link_back_is_rejected_AC_1(script, specs_root, project, specs_repo):
    (specs_root / "02-other").mkdir()
    landed_wiki(script, specs_root, project, specs_repo)
    decide(script, specs_root, page="decision-other.md", spec="02-other", concerns=("q.md",))
    (specs_root / "wiki" / "decision-loose.md").write_text(HAND_DECISION)
    build_index(script, specs_root, project)
    out = scope(script, specs_root)
    assert sorted((r["page"], r["reason"]) for r in out["rejected"]) == [
        ("decision-loose.md", "no-backlink"),
        ("decision-other.md", "wrong-spec"),
    ]
    assert out["allowed"] == []


def test_a_changed_decision_and_a_page_changed_beyond_its_section_are_not_allowed_AC_1(script, specs_root, project, specs_repo):
    landed_wiki(script, specs_root, project, specs_repo)
    decide(script, specs_root, page="decision-old.md", concerns=("q.md",))
    commit_all(specs_repo, "a decision")
    (specs_root / "wiki" / "decision-old.md").write_text(read(specs_root, "decision-old.md") + "\nEdited.\n")
    decide(script, specs_root, page="decision-new.md", concerns=("p.md",))
    write_page(script, specs_root, project, "p.md", ["x.txt"], "# Title\n\nRewritten beyond the section.\n")
    out = scope(script, specs_root)
    assert sorted(out["allowed"]) == ["decision-new.md", "index.md"]
    assert out["rejected"] == []


def test_nothing_is_allowed_when_no_decision_was_recorded_AC_2(script, specs_root, project, specs_repo):
    landed_wiki(script, specs_root, project, specs_repo)
    write_page(script, specs_root, project, "q.md", ["y.txt"], "# Q\n\nRewritten.\n")
    build_index(script, specs_root, project)
    out = scope(script, specs_root)
    assert out["allowed"] == [] and out["rejected"] == []


# --- the index, and finding decisions ----------------------------------------


def test_the_index_lists_decision_pages_under_a_heading_of_their_own_AC_4(script, specs_root, project):
    write_page(script, specs_root, project, "a.md", ["x.txt"], "# Ay\n\nThe a part.\n")
    write_page(script, specs_root, project, "b.md", ["y.txt"], "# Bee\n\nThe b part.\n")
    decide(script, specs_root, page="decision-a.md", title="Decide a", line="A stays.", concerns=("a.md",))
    (specs_root / "wiki" / "decision-b.md").write_text(HAND_DECISION.replace("p.md", "b.md"))
    build_index(script, specs_root, project)
    lines = read(specs_root, "index.md").splitlines()
    assert lines.count("## Decisions") == 1
    heading = lines.index("## Decisions")
    above = [l for l in lines[:heading] if l.startswith("- ")]
    below = [l for l in lines[heading:] if l.startswith("- ")]
    assert [l.split("](")[1].split(")")[0] for l in above] == ["a.md", "b.md"]
    assert below == ["- [Decide a](decision-a.md) — A stays.", "- [By hand](decision-b.md) — Keep pages."]
    assert "decision-" not in "".join(lines[:heading])


def test_an_index_of_a_wiki_with_no_decision_has_no_such_heading_AC_4(script, specs_root, project):
    write_page(script, specs_root, project, "a.md", ["x.txt"])
    build_index(script, specs_root, project)
    assert "## Decisions" not in read(specs_root, "index.md")


def found(script, specs_root, *args):
    rc, out = call(script, "decisions", "--specs-root", specs_root, *args)
    return rc, out


def test_decisions_are_found_from_the_pages_that_link_to_them_or_from_their_spec_AC_5(script, specs_root, project):
    write_page(script, specs_root, project, "p.md", ["x.txt"])
    write_page(script, specs_root, project, "q.md", ["y.txt"])
    decide(script, specs_root, title="Scripted", line="Kept by the script.")
    (specs_root / "wiki" / "decision-hand.md").write_text(HAND_DECISION.replace("- [P](p.md)", "- [Elsewhere](notes.md)"))
    hand_written(specs_root, "notes.md", "# Notes\n\nSee [the decision](decision-hand.md).\n")
    rc, out = found(script, specs_root, "--from", "p.md")
    assert rc == 0 and out["terminalReason"] == "listed", out
    assert out["decisions"] == [{"page": "decision-x.md", "title": "Scripted", "spec": "01-first", "summary": "Kept by the script."}]
    assert [d["page"] for d in found(script, specs_root, "--from", "notes.md")[1]["decisions"]] == ["decision-hand.md"]
    assert found(script, specs_root, "--from", "q.md")[1]["decisions"] == []
    assert [d["page"] for d in found(script, specs_root, "--from", "q.md", "p.md")[1]["decisions"]] == ["decision-x.md"]
    assert [d["page"] for d in found(script, specs_root, "--spec", "01-first")[1]["decisions"]] == ["decision-hand.md", "decision-x.md"]
    assert found(script, specs_root, "--spec", "02-other")[1]["decisions"] == []
    rc, out = found(script, specs_root)
    assert rc == 2 and out["reason"] == "missing-argument"


# --- a decision written by a person -------------------------------------------


def test_a_hand_written_decision_page_survives_every_subcommand_a_build_runs_AC_3(script, specs_root, project, specs_repo):
    write_page(script, specs_root, project, "p.md", ["x.txt"])
    (specs_root / "wiki" / "decision-hand.md").write_text(HAND_DECISION)
    commit_all(specs_repo, "a wiki and a decision by hand")
    assert write_page(script, specs_root, project, "p.md", ["x.txt"], "# P again\n\nRebuilt.\n")[0] == 0
    assert call(script, "schema", "--specs-root", specs_root, "--project-dir", project)[0] == 0
    assert call(script, "prune", "--specs-root", specs_root, "--keep", "p.md")[0] == 0
    assert build_index(script, specs_root, project)[0] == 0
    assert read(specs_root, "decision-hand.md") == HAND_DECISION
    assert verify(script, specs_root) == []
    rc, out = write_page(script, specs_root, project, "decision-hand.md", ["x.txt"])
    assert rc == 2 and out["reason"] == "hand-written-page"
    assert "](decision-hand.md)" in decision_section(read(specs_root, "p.md"))
    index = read(specs_root, "index.md").splitlines()
    assert index.index("## Decisions") < index.index("- [By hand](decision-hand.md) — Keep pages.")
