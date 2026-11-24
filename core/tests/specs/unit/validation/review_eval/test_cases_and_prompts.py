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


def test_the_planted_set_has_planted_and_clean_cases_each_described_or_promised_clean_ac_1():
    data = json.loads((SCRIPT_DIR / "planted.json").read_text())
    cases = data["cases"]
    ids = [c["id"] for c in cases]

    assert len(ids) == len(set(ids))
    assert {c["kind"] for c in cases} == {"planted", "clean"}
    for case in cases:
        assert case["spec"] and case["commit"], case["id"]
        if case["kind"] == "planted":
            assert case["defect"].strip(), case["id"]
            assert (SCRIPT_DIR / case["patch"]).is_file(), case["id"]
        else:
            assert "defect" not in case and "patch" not in case, case["id"]


CHECKS = SCRIPT_DIR.parents[1] / "core" / "scripts" / "lib" / "run-spec" / "turn" / "review-checks"


def _check_body(name):
    """A check's text after its frontmatter, as the prompts carry it."""
    text = (CHECKS / name).read_text()
    return text.split("\n---\n", 1)[1].strip()


def _repo_with_change(tmp_path, changed, untracked=False):
    repo = tmp_path / "repo"
    repo.mkdir()
    run = lambda *a: subprocess.run(["git", "-C", str(repo), *a], capture_output=True, text=True, check=True).stdout.strip()
    run("init", "-q", "-b", "main")
    run("config", "user.email", "t@example.com")
    run("config", "user.name", "t")
    (repo / "README.md").write_text("x\n")
    run("add", "-A")
    run("commit", "-q", "-m", "fork")
    fork = run("rev-parse", "HEAD")
    target = repo / changed
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("changed\n")
    if not untracked:
        run("add", "-A")
        run("commit", "-q", "-m", "change")
    return repo, fork


def _both_prompts(review_eval, tmp_path, fork, *project):
    description = tmp_path / "d.md"
    description.write_text("# x\n")
    return (
        review_eval.prompt("review_prompt", str(description), fork, "main", "", "(headless)", *project),
        review_eval.prompt("verify_prompt", str(description), fork, "main", "1. one", "(headless)", *project),
    )


@pytest.mark.parametrize("untracked", [False, True])
def test_a_diff_under_a_checks_paths_gives_both_prompts_that_check_ac_4(review_eval, tmp_path, untracked):
    repo, fork = _repo_with_change(tmp_path, "core/scripts/lib/run-spec/checkout/checkouts.sh", untracked)

    for text in _both_prompts(review_eval, tmp_path, fork, str(repo)):
        assert _check_body("runner-git.md") in text


def test_a_diff_under_no_checks_paths_gives_neither_prompt_a_check_ac_5(review_eval, tmp_path):
    repo, fork = _repo_with_change(tmp_path, "dashboard/src/other.ts")

    with_dir = _both_prompts(review_eval, tmp_path, fork, str(repo))
    without = _both_prompts(review_eval, tmp_path, fork)

    assert with_dir == without
    for text in with_dir:
        assert _check_body("runner-git.md") not in text


@pytest.mark.parametrize("project", [None, "not-a-repo"])
def test_no_project_directory_or_no_repository_gives_no_check_and_no_failure_ac_5(review_eval, tmp_path, project):
    description = tmp_path / "d.md"
    description.write_text("# x\n")
    sixth = ""
    if project:
        (tmp_path / project).mkdir()
        sixth = f' "{tmp_path / project}"'
    script = ('set -u; source "$1/_aide-spec-lib.sh"; source "$1/lib/run-spec/turn/review-prompts.sh"; '
              f'review_prompt "$2" fork main "" headless{sixth}; verify_prompt "$2" fork main "1. one" headless{sixth}')

    result = subprocess.run(["bash", "-c", script, "bash", str(review_eval.SCRIPTS), str(description)],
                            capture_output=True, text=True)

    assert result.returncode == 0, result.stderr
    assert _check_body("runner-git.md") not in result.stdout


THREATS = (
    "# x - Analysis\n\n## Findings\n\n### Affected files\n\n- `a.sh:1`\n\n"
    "### Threats\n\n- **Exposed:** the token in `a.sh:3`\n- **To whom:** a page on the network\n"
    "- **What the change does to it:** narrows it\n- **Fixes:** no\n"
    "- **Left out:** the logs\n- **Deferred:** nothing\n\n"
    "### Overlapping specs\n\nNone.\n"
)
THREAT_MARKER = "The spec's analysis has a ### Threats section"


def _spec_folder(tmp_path, analysis=None):
    description = tmp_path / "1-description.md"
    description.write_text("# x\n\nA change.\n")
    if analysis is not None:
        (tmp_path / "2-analysis.md").write_text(analysis)
    return description


def test_a_threat_section_asks_the_review_for_each_security_finding_and_the_verification_to_keep_it_ac_3(review_eval, tmp_path):
    description = _spec_folder(tmp_path, THREATS)

    review = review_eval.prompt("review_prompt", str(description), "abc123", "main", "", "(headless)")
    verify = review_eval.prompt("verify_prompt", str(description), "abc123", "main", "1. one", "(headless)")

    analysis = str(tmp_path / "2-analysis.md")
    assert THREAT_MARKER in review and analysis in review
    for term in ("file and line", "risk", "what would fix it"):
        assert term in review, term
    assert THREAT_MARKER in verify and analysis in verify
    assert review.rstrip().endswith("(headless)") and verify.rstrip().endswith("(headless)")


@pytest.mark.parametrize("analysis", [None, THREATS])
def test_every_review_prompt_tries_a_security_fix_against_a_variant_and_the_default_branch_ac_4(review_eval, tmp_path, analysis):
    description = _spec_folder(tmp_path, analysis)

    text = review_eval.prompt("review_prompt", str(description), "abc123", "main", "", "(headless)")

    assert "fixes a security flaw" in text
    assert "at least one variant" in text
    assert "git diff abc123 main" in text and "git show main:" in text
    assert "still being there on main is expected" in text


@pytest.mark.parametrize("analysis", [
    None,
    "# x - Analysis\n\n## Findings\n\n### Affected files\n\n- `a.sh:1`\n",
    "# x - Analysis\n\n## Findings\n\n### Threats and risks\n\n- **Exposed:** nothing\n",
])
def test_no_threat_section_means_no_threat_instruction_ac_5(review_eval, tmp_path, analysis):
    description = _spec_folder(tmp_path, analysis)

    assert review_eval.prompt("review_threat_section", str(description)) == ""
    for function, defects in (("review_prompt", ""), ("verify_prompt", "1. one")):
        text = review_eval.prompt(function, str(description), "abc123", "main", defects, "(headless)")
        assert THREAT_MARKER not in text, function


@pytest.mark.parametrize("end", ["### Overlapping specs\n", "## Round 2\n", "---\n"])
def test_the_threat_reader_returns_the_whole_section_and_stops_at_the_next_heading_ac_1_ac_2(review_eval, tmp_path, end):
    analysis = (
        "## Findings\n\n### Threats\n\n- **Exposed:** the token\n- **To whom:** a page\n"
        "- **What the change does to it:** narrows it\n- **Left out:** the logs\n"
        f"- **Deferred:** nothing\n\n{end}\nafter\n"
    )
    description = _spec_folder(tmp_path, analysis)

    lines = review_eval.prompt("review_threat_section", str(description)).splitlines()

    assert lines[0] == "### Threats"
    assert "- **Left out:** the logs" in lines and "- **Deferred:** nothing" in lines
    assert "after" not in lines and end.strip() not in lines


def test_the_threat_reader_returns_the_newest_rounds_section_ac_3(review_eval, tmp_path):
    analysis = (
        "## Findings\n\n### Threats\n\n- **Exposed:** round one\n\n"
        "## Round 2\n\n### Threats\n\n- **Exposed:** round two\n\n### Files to change\n\n- `a.sh`\n"
    )
    description = _spec_folder(tmp_path, analysis)

    text = review_eval.prompt("review_threat_section", str(description))

    assert "round two" in text and "round one" not in text
    assert text.count("### Threats") == 1
