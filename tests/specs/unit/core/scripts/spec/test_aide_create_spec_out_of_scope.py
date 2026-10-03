"""aide-create-spec's --given-description also holds the description's own
`## Out of scope` section: kept word for word, never dropped, never added
by the model. Without the flag nothing is compared.
"""

from .test_aide_create_spec import run, script, specs_root  # noqa: F401
from .test_aide_create_spec_criteria import create

SECTION = (
    "## Out of scope\n\n"
    "- Do not touch the queue.\n"
    "- Do not add a new route.\n"
)
CRITERION = "## Acceptance criteria\n\n- **AC-1:** The board SHALL a.\n"


def description(*parts):
    return "Problem: X.\n\n" + "\n".join(parts)


def written_description(specs_root):
    return (specs_root / "42-do-a-thing" / "1-description.md").read_text()


def assert_refused(out, specs_root):
    assert out["ok"] is False, out
    assert out["terminalReason"] == "refused", out
    assert "## Out of scope" in out["error"], out
    assert not (specs_root / "42-do-a-thing").exists()


def test_a_section_kept_word_for_word_is_created_with_its_lines_AC_2(script, specs_root):
    given = description(SECTION)
    written = description(SECTION, CRITERION)
    rc, out, _ = create(script, specs_root, given, written)
    assert rc == 0, out
    text = written_description(specs_root)
    assert SECTION.strip() in text


def test_a_reworded_item_is_refused_AC_2(script, specs_root):
    given = description(SECTION)
    written = description(SECTION.replace("the queue", "the schedule"), CRITERION)
    rc, out, _ = create(script, specs_root, given, written)
    assert rc != 0, out
    assert_refused(out, specs_root)


def test_a_dropped_section_is_refused_AC_2(script, specs_root):
    given = description(SECTION)
    written = description(CRITERION)
    rc, out, _ = create(script, specs_root, given, written)
    assert rc != 0, out
    assert_refused(out, specs_root)


def test_a_section_added_to_a_description_without_one_is_refused_AC_2(script, specs_root):
    given = description()
    written = description(SECTION)
    rc, out, _ = create(script, specs_root, given, written)
    assert rc != 0, out
    assert_refused(out, specs_root)


def test_trailing_whitespace_in_the_section_is_not_compared_AC_2(script, specs_root):
    given = description(SECTION)
    written = description(SECTION.replace("queue.\n", "queue.   \n") + "\n\n")
    rc, out, _ = create(script, specs_root, given, written)
    assert rc == 0, out


def test_without_the_given_description_an_added_section_is_created_as_typed_AC_2(script, specs_root):
    written = description(SECTION)
    rc, out, _ = run(script, specs_root, "42", "do-a-thing", "Do a thing", written)
    assert rc == 0, out
    assert SECTION.strip() in written_description(specs_root)


def test_a_description_without_the_section_is_compared_as_before_AC_2(script, specs_root):
    given = description(CRITERION)
    written = description(CRITERION, "- **AC-2:** The board SHALL b.\n")
    rc, out, _ = create(script, specs_root, given, written)
    assert rc == 0, out
