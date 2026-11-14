"""scripts/review_eval: the labelled set it measures against, and the runner's own prompts it sends."""
import json
import subprocess

import pytest

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


def test_every_review_prompt_counts_a_weakened_existing_test_as_a_defect_ac_1_ac_2(review_eval, tmp_path):
    plain = tmp_path / "plain.md"
    plain.write_text("# x\n\nA change.\n")
    scoped = tmp_path / "scoped.md"
    scoped.write_text("# x\n\n## Out of scope\n\n- The settings page.\n")

    for description in (plain, scoped):
        text = review_eval.prompt("review_prompt", str(description), "abc123", "main", "", "(headless)").lower()

        for term in ("deleted", "assertion", "loosened", "skipped", "disabled", "replaces or removes"):
            assert term in text, (description.name, term)


def test_the_verify_prompt_keeps_a_weakened_test_defect_only_when_the_description_keeps_its_behaviour_ac_3(review_eval, tmp_path):
    text = review_eval.prompt(
        "verify_prompt", str(tmp_path / "d.md"), "abc123", "main", "1. one\n2. two", "(headless)"
    ).lower()

    for term in ("skipped", "assertion", "replace or remove"):
        assert term in text, term


@pytest.mark.parametrize("function", ["review_prompt", "verify_prompt"])
def test_review_and_verify_include_the_shared_design_instruction(review_eval, tmp_path, function):
    description = tmp_path / "description.md"
    description.write_text("# Change\n")
    script = '''
source "$1/_aide-spec-lib.sh"
source "$1/lib/run-spec/turn/review-prompts.sh"
review_design_instruction() { printf '%s\\n' 'design-instruction-sentinel'; }
"$2" "$3" fork main "" headless-sentinel
'''
    result = subprocess.run(
        ["bash", "-c", script, "bash", str(review_eval.SCRIPTS), function, str(description)],
        capture_output=True, text=True, check=True,
    )
    assert result.stdout.splitlines().count("design-instruction-sentinel") == 1
    assert result.stdout.rstrip().endswith("headless-sentinel")
