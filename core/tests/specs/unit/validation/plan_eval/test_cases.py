"""scripts/plan_eval/cases.py: reading an expected assessment, and checking it against the archive and the history."""
import re

import pytest

import cases

from .conftest import PLAN_EVAL_DIR, case_text, write

SHIPPED = sorted((PLAN_EVAL_DIR / "cases").glob("*.md"))


def test_three_cases_are_shipped_beside_the_script(tmp_path):
    assert [p.stem for p in SHIPPED] == ["640", "647", "653"]


@pytest.mark.parametrize("path", SHIPPED, ids=lambda p: p.stem)
def test_a_shipped_case_reads_whole_with_its_pinned_commits_and_evidence_for_every_item_and_a_serious_omission_ac_1(path):
    case = cases.load(path)

    assert case.number == path.stem and case.folder.startswith(f"{path.stem}-")
    assert re.fullmatch(r"[0-9a-f]{40}", case.before) and re.fullmatch(r"[0-9a-f]{40}", case.landed)
    assert re.fullmatch(r"[0-9a-f]{64}", case.description_sha256)
    for section in cases.SECTIONS:
        assert case.items[section], section
        assert all(item.evidence for item in case.items[section])
    assert all(item.documents for item in case.items["S"])


@pytest.mark.parametrize("path", SHIPPED, ids=lambda p: p.stem)
def test_a_shipped_case_waits_for_a_persons_approval_ac_8(path):
    assert cases.load(path).approved is None


def test_an_approved_line_with_a_date_reads_as_approved_and_no_as_not_ac_8(tmp_path):
    write(tmp_path / "4.md", case_text(approved="2026-11-16"))
    write(tmp_path / "other" / "4.md", case_text(approved="no"))

    assert cases.load(tmp_path / "4.md").approved == "2026-11-16"
    assert cases.load(tmp_path / "other" / "4.md").approved is None


def test_an_item_keeps_its_text_its_evidence_and_the_documents_an_omission_applies_to(tmp_path):
    write(tmp_path / "4.md", case_text())

    case = cases.load(tmp_path / "4.md")

    (c1,) = case.items["C"]
    assert c1.id == "C1" and c1.text == "`lib_replayed.py` holds the thing."
    assert c1.evidence == "`lib_replayed.py:1` at the commit before." and c1.documents == ()
    assert [(s.id, s.documents) for s in case.items["S"]] == [("S1", ("analysis", "plan")), ("S2", ("plan",))]
    assert re.fullmatch(r"[0-9a-f]{64}", case.sha256)


def broken(text, old, new):
    assert old in text, old
    return text.replace(old, new)


MALFORMED = {
    "an item without evidence": (lambda t: broken(t, "The thing 1 works. Evidence: AC-1.", "The thing 1 works."), "R1"),
    "an item with empty evidence": (lambda t: broken(t, "The thing 1 works. Evidence: AC-1.", "The thing 1 works. Evidence:"), "R1"),
    "a missing section": (lambda t: broken(t, "## Tests\n\n- **T1:** A test that the thing works. Evidence: AC-1.\n", ""), "Tests"),
    "a section with no item": (lambda t: broken(t, "- **T1:** A test that the thing works. Evidence: AC-1.\n", ""), "Tests"),
    "a duplicate id": (lambda t: broken(t, "**S2 (plan)", "**S1 (plan)"), "S1"),
    "an id lettered for another section": (lambda t: broken(t, "**T1:**", "**R2:**"), "R2"),
    "an omission naming no document": (lambda t: broken(t, "**S2 (plan):**", "**S2:**"), "S2"),
    "an omission naming another word": (lambda t: broken(t, "**S2 (plan):**", "**S2 (tests):**"), "S2"),
    "another item naming a document": (lambda t: broken(t, "**R1:**", "**R1 (plan):**"), "R1"),
    "an Approved value that is neither no nor a date": (lambda t: broken(t, "- **Approved:** no", "- **Approved:** yes"), "Approved"),
    "a missing header line": (lambda t: broken(t, "- **Code landed:** `" + "b" * 40 + "`\n", ""), "Code landed"),
    "a short commit": (lambda t: broken(t, "a" * 40, "a" * 8), "Code before"),
    "a description hash that is not sha256": (lambda t: broken(t, "c" * 64, "c" * 40), "Description sha256"),
}


@pytest.mark.parametrize("name", MALFORMED)
def test_a_malformed_case_is_refused_naming_its_file_and_the_item_ac_1(tmp_path, name):
    change, item = MALFORMED[name]
    path = tmp_path / "4.md"
    write(path, change(case_text(approved="no")))

    with pytest.raises(cases.CaseError) as error:
        cases.load(path)

    assert str(path) in str(error.value) and item in str(error.value)


def test_a_case_whose_file_name_is_not_its_specs_number_is_refused_ac_1(tmp_path):
    write(tmp_path / "5.md", case_text())

    with pytest.raises(cases.CaseError, match="5.md"):
        cases.load(tmp_path / "5.md")


def test_a_case_pinned_to_its_landing_with_the_archived_descriptions_hash_is_consistent_ac_1(pilot):
    case = cases.load(pilot.cases / "4.md")

    assert cases.consistent(case, str(pilot.code), str(pilot.specs_root), "main", "merge") == []


def test_a_case_whose_pinned_commits_or_description_differ_says_what_differs_ac_1(pilot):
    pilot.write_case(before=pilot.before["6-second"], description_sha="0" * 64)
    case = cases.load(pilot.cases / "4.md")

    problems = cases.consistent(case, str(pilot.code), str(pilot.specs_root), "main", "merge")

    assert any("Code before" in p and pilot.before["4-replayed"] in p for p in problems)
    assert any("Description sha256" in p for p in problems)


def test_a_case_whose_before_commit_the_checkout_does_not_have_is_named_ac_8(pilot):
    pilot.write_case(before="1" * 40)

    problems = cases.consistent(cases.load(pilot.cases / "4.md"), str(pilot.code), str(pilot.specs_root), "main", "merge")

    assert any("1" * 40 in p for p in problems)
