"""aide-wiki decisions: the pages a spec records, the section on each page
it concerns that links back, what an archive may add under wiki/, and a
decision page written by a person."""
import pytest
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
    decide,
    HAND_DECISION,
)



# --- decisions: pages a spec records, and the section that links back --------


def read(specs_root, name):
    return (specs_root / "wiki" / name).read_text()


def front_of(text):
    return text.split("---\n")[1]


def listing(specs_root):
    return {p.name: p.read_text() for p in (specs_root / "wiki").iterdir()}


def decision_section(text):
    return text.split("\n## Decisions\n", 1)[1] if "\n## Decisions\n" in text else None


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
