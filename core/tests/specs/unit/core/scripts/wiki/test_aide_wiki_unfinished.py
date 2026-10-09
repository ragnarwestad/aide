"""aide-wiki unfinished: what a build or a refresh left unfinished, by the
rule the runner's check applies to a board run — a build leaves no generated
page on an older commit, a refresh leaves no `changed` page, and every wiki
has its index and its two fixed pages."""
# The fixtures are imported for pytest to find; the tests take them by name.
# specs_repo is taken by specs_root, not by a test here, so it reads as unused.
# noinspection PyUnusedImports
from .aide_wiki_support import (
    script,
    project,
    specs_repo,
    specs_root,
    call,
    write_page,
    build_index,
    commit_all,
    hand_written,
    FIXED_PAGES,
    fixed_body,
)


def unfinished(script, specs_root, project, *flags):
    rc, out = call(script, "unfinished", "--specs-root", specs_root, "--project-dir", project, *flags)
    assert rc == 0, out
    return out


def write_fixed_pages(script, specs_root, project):
    for page in sorted(FIXED_PAGES):
        assert write_page(script, specs_root, project, page, ["dir/z.txt"], fixed_body(page))[0] == 0


def move_on(project, name="x.txt"):
    """A new commit in the project, so every page written before it is on an older one."""
    (project / name).write_text("changed\n")
    commit_all(project, f"change {name}")


def test_a_build_names_the_page_it_did_not_write_again_AC_4(script, specs_root, project):
    for page in ("a.md", "b.md"):
        write_page(script, specs_root, project, page, ["y.txt"])
    write_fixed_pages(script, specs_root, project)
    build_index(script, specs_root, project)
    move_on(project)
    write_page(script, specs_root, project, "a.md", ["y.txt"])
    write_fixed_pages(script, specs_root, project)
    build_index(script, specs_root, project)
    out = unfinished(script, specs_root, project)
    assert out["pages"] == ["b.md"], out
    assert out["finished"] is False, out
    assert out["index"] is True and out["missing"] == [], out


def test_a_build_does_not_count_an_unchanged_index_and_schema_AC_4(script, specs_root, project):
    write_page(script, specs_root, project, "a.md", ["y.txt"])
    write_fixed_pages(script, specs_root, project)
    call(script, "schema", "--specs-root", specs_root, "--project-dir", project)
    build_index(script, specs_root, project)
    older = (specs_root / "wiki" / "index.md").read_text()
    move_on(project)
    write_page(script, specs_root, project, "a.md", ["y.txt"])
    write_fixed_pages(script, specs_root, project)
    call(script, "schema", "--specs-root", specs_root, "--project-dir", project)
    build_index(script, specs_root, project)
    # Their text did not change, so aide-wiki left them on the commit they were written from.
    assert (specs_root / "wiki" / "index.md").read_text() == older
    out = unfinished(script, specs_root, project)
    assert out["pages"] == [] and out["finished"] is True, out


def test_a_refresh_names_a_changed_page_and_not_a_current_one_on_an_older_commit_AC_2_AC_4(
    script, specs_root, project
):
    write_page(script, specs_root, project, "a.md", ["x.txt"])
    write_page(script, specs_root, project, "b.md", ["y.txt"])
    write_fixed_pages(script, specs_root, project)
    build_index(script, specs_root, project)
    move_on(project, "x.txt")
    out = unfinished(script, specs_root, project, "--refresh")
    assert out["pages"] == ["a.md"], out
    assert out["finished"] is False, out
    # The same wiki read as a build names the page a refresh leaves alone too.
    assert unfinished(script, specs_root, project)["pages"] == ["a.md", "b.md", "overview.md", "reusable-parts.md"]


def test_a_refresh_that_rewrote_the_changed_page_is_finished_AC_2_AC_4(script, specs_root, project):
    write_page(script, specs_root, project, "a.md", ["x.txt"])
    write_page(script, specs_root, project, "b.md", ["y.txt"])
    write_fixed_pages(script, specs_root, project)
    build_index(script, specs_root, project)
    move_on(project, "x.txt")
    write_page(script, specs_root, project, "a.md", ["x.txt"])
    out = unfinished(script, specs_root, project, "--refresh")
    assert out["pages"] == [] and out["finished"] is True, out


def test_a_wiki_with_no_index_is_unfinished_AC_4(script, specs_root, project):
    write_page(script, specs_root, project, "a.md", ["x.txt"])
    write_fixed_pages(script, specs_root, project)
    out = unfinished(script, specs_root, project)
    assert out["index"] is False and out["finished"] is False, out
    assert out["missing"] == [] and out["pages"] == [], out


def test_a_wiki_lacking_a_fixed_page_names_it_AC_4(script, specs_root, project):
    write_page(script, specs_root, project, "a.md", ["x.txt"])
    write_page(script, specs_root, project, "overview.md", ["x.txt"], fixed_body("overview.md"))
    build_index(script, specs_root, project)
    for flags in ((), ("--refresh",)):
        out = unfinished(script, specs_root, project, *flags)
        assert out["missing"] == ["reusable-parts.md"], out
        assert out["finished"] is False, out


def test_a_hand_written_page_is_never_named_AC_4(script, specs_root, project):
    write_page(script, specs_root, project, "a.md", ["y.txt"])
    write_fixed_pages(script, specs_root, project)
    hand_written(specs_root, "notes.md")
    build_index(script, specs_root, project)
    move_on(project, "x.txt")
    move_on(project, "y.txt")
    for flags in ((), ("--refresh",)):
        assert "notes.md" not in unfinished(script, specs_root, project, *flags)["pages"]


def test_no_wiki_at_all_is_unfinished_AC_4(script, specs_root, project):
    out = unfinished(script, specs_root, project)
    assert out["finished"] is False and out["index"] is False, out
    assert out["missing"] == ["overview.md", "reusable-parts.md"] and out["pages"] == [], out
    assert not (specs_root / "wiki").exists()


def test_unfinished_refuses_a_call_without_its_roots_AC_4(script, specs_root, project):
    rc, out = call(script, "unfinished", "--specs-root", specs_root)
    assert rc == 2 and out["reason"] == "missing-argument", out
    rc, out = call(script, "unfinished", "--project-dir", project)
    assert rc == 2 and out["reason"] == "missing-argument", out


def test_every_other_subcommand_refuses_refresh_AC_4(script, specs_root, project):
    rc, out = call(script, "status", "--specs-root", specs_root, "--project-dir", project, "--refresh")
    assert rc == 2 and out["reason"] == "unknown-argument", out
