"""scripts/review_eval: the labelled set it measures against, and the runner's own prompts it sends."""
import json

from .conftest import SCRIPT_DIR


def test_every_finding_belongs_to_a_case_has_a_known_verdict_and_its_own_id():
    data = json.loads((SCRIPT_DIR / "cases.json").read_text())
    specs = {c["spec"] for c in data["cases"]}
    ids = [f["id"] for f in data["findings"]]

    assert len(ids) == len(set(ids))
    for finding in data["findings"]:
        assert finding["spec"] in specs, finding["id"]
        assert finding["verdict"] in ("real", "false", "unclear"), finding["id"]
        assert finding["text"] and finding["reason"], finding["id"]


def test_the_review_prompt_is_the_runners_and_reads_the_out_of_scope_section(review_eval, tmp_path):
    description = tmp_path / "1-description.md"
    description.write_text("# x\n\n## Out of scope\n\n- The settings page.\n")

    text = review_eval.prompt("review_prompt", str(description), "abc123", "main", "", "(headless)")

    assert f"The description: {description}" in text
    assert "git diff abc123" in text
    assert "## Out of scope section" in text
    assert text.rstrip().endswith("(headless)")


def test_the_verify_prompt_carries_the_numbered_defects(review_eval, tmp_path):
    text = review_eval.prompt("verify_prompt", str(tmp_path / "d.md"), "abc123", "main", "1. one\n2. two", "(headless)")

    assert "1. one\n2. two" in text
    assert "git diff abc123" in text
