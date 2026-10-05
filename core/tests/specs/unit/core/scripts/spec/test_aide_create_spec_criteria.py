"""aide-create-spec's --given-description: the description as /aide-create
received it. Every criterion it gives stays in --description word for
word, and every criterion added takes the next id after the highest one
given. Without the flag the script checks nothing of the kind.
"""
import re

from .test_aide_create_spec import run, script, specs_root  # noqa: F401

PROBLEM = "Problem: X.\n\n## Acceptance criteria\n\n"


def criteria(*lines):
    return PROBLEM + "".join(f"{line}\n" for line in lines)


def create(script, specs_root, given, written):
    return run(script, specs_root, "42", "do-a-thing", "Do a thing", written,
               extra_args=["--given-description", given])


def ac_lines(specs_root):
    text = (specs_root / "42-do-a-thing" / "1-description.md").read_text()
    return [line for line in text.splitlines() if re.match(r"^- \*\*AC-\d+:\*\*", line)]


def assert_refused(out, specs_root, ac_id):
    assert out["ok"] is False, out
    assert out["terminalReason"] == "refused", out
    assert re.search(rf"\b{ac_id}\b", out["error"]), out
    assert not (specs_root / "42-do-a-thing").exists()


def test_without_the_given_description_nothing_is_compared_AC_1(script, specs_root):
    written = criteria("- **AC-2:** The board SHALL a.", "- **AC-5:** The board SHALL b.")
    rc, out, _ = run(script, specs_root, "42", "do-a-thing", "Do a thing", written)
    assert rc == 0, out
    assert ac_lines(specs_root) == ["- **AC-2:** The board SHALL a.", "- **AC-5:** The board SHALL b."]


def test_refuses_a_given_criterion_written_with_other_words_AC_2(script, specs_root):
    given = criteria("- **AC-1:** WHEN x, the board SHALL y.")
    written = criteria("- **AC-1:** WHEN x, the board SHALL z.")
    rc, out, _ = create(script, specs_root, given, written)
    assert rc != 0
    assert_refused(out, specs_root, "AC-1")


def test_refuses_a_given_criterion_left_out_AC_2(script, specs_root):
    given = criteria("- **AC-1:** The board SHALL a.", "- **AC-2:** The board SHALL b.")
    written = criteria("- **AC-1:** The board SHALL a.")
    rc, out, _ = create(script, specs_root, given, written)
    assert rc != 0
    assert_refused(out, specs_root, "AC-2")


def test_a_given_criterion_without_bold_counts_as_kept_once_bolded_AC_2(script, specs_root):
    given = criteria("- AC-1: x")
    written = criteria("- **AC-1:** x")
    rc, out, _ = create(script, specs_root, given, written)
    assert rc == 0, out
    assert ac_lines(specs_root) == ["- **AC-1:** x"]


def test_keeps_the_given_criterion_and_writes_the_added_one_AC_2_AC_3(script, specs_root):
    given = criteria("- **AC-1:** The board SHALL a.")
    written = criteria("- **AC-1:** The board SHALL a.", "- **AC-2:** WHEN b, the board SHALL c.")
    rc, out, _ = create(script, specs_root, given, written)
    assert rc == 0, out
    assert ac_lines(specs_root) == [
        "- **AC-1:** The board SHALL a.",
        "- **AC-2:** WHEN b, the board SHALL c.",
    ]


def test_an_added_criterion_takes_the_id_after_the_highest_given_AC_4(script, specs_root):
    kept = ("- **AC-1:** The board SHALL a.", "- **AC-3:** The board SHALL c.")
    rc, out, _ = create(script, specs_root, criteria(*kept),
                        criteria(*kept, "- **AC-2:** The board SHALL b."))
    assert rc != 0
    assert_refused(out, specs_root, "AC-4")

    rc, out, _ = create(script, specs_root, criteria(*kept),
                        criteria(*kept, "- **AC-4:** The board SHALL d."))
    assert rc == 0, out


def test_added_criteria_run_on_without_a_gap_AC_4(script, specs_root):
    kept = "- **AC-1:** The board SHALL a."
    rc, out, _ = create(script, specs_root, criteria(kept),
                        criteria(kept, "- **AC-2:** The board SHALL b.", "- **AC-4:** The board SHALL d."))
    assert rc != 0
    assert_refused(out, specs_root, "AC-3")

    rc, out, _ = create(script, specs_root, criteria(kept),
                        criteria(kept, "- **AC-2:** The board SHALL b.", "- **AC-3:** The board SHALL c."))
    assert rc == 0, out


def test_the_first_criterion_added_to_none_takes_AC_1_AC_4(script, specs_root):
    given = "Problem: X.\n"
    rc, out, _ = create(script, specs_root, given, criteria("- **AC-2:** The board SHALL b."))
    assert rc != 0
    assert_refused(out, specs_root, "AC-1")

    rc, out, _ = create(script, specs_root, given,
                        criteria("- **AC-1:** The board SHALL a.", "- **AC-2:** The board SHALL b."))
    assert rc == 0, out


def test_a_given_line_the_bold_rewrite_cannot_reach_counts_as_given_AC_4(script, specs_root):
    given = criteria("- AC-1 : a", "- **AC-2:** b")
    written = criteria("- **AC-1:** a", "- **AC-2:** b", "- **AC-3:** c")
    rc, out, _ = create(script, specs_root, given, written)
    assert rc == 0, out
    assert ac_lines(specs_root) == ["- **AC-1:** a", "- **AC-2:** b", "- **AC-3:** c"]


def test_refuses_an_id_written_twice_AC_4(script, specs_root):
    given = criteria("- **AC-1:** The board SHALL a.")
    written = criteria("- **AC-1:** The board SHALL a.", "- **AC-1:** The board SHALL b.")
    rc, out, _ = create(script, specs_root, given, written)
    assert rc != 0
    assert_refused(out, specs_root, "AC-1")


def test_adding_nothing_keeps_the_criteria_exactly_as_given_AC_5(script, specs_root):
    given = criteria("- **AC-1:** The board SHALL a.", "- **AC-2:** The board SHALL b.")
    rc, out, _ = create(script, specs_root, given, given)
    assert rc == 0, out
    assert ac_lines(specs_root) == ["- **AC-1:** The board SHALL a.", "- **AC-2:** The board SHALL b."]


def test_an_id_the_description_itself_repeats_is_kept_as_given_AC_2(script, specs_root):
    kept = ("- **AC-1:** The board SHALL a.", "- **AC-1:** The board SHALL b.")
    rc, out, _ = create(script, specs_root, criteria(*kept),
                        criteria(*kept, "- **AC-2:** The board SHALL c."))
    assert rc == 0, out
    assert ac_lines(specs_root) == [*kept, "- **AC-2:** The board SHALL c."]
