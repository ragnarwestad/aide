"""After an analyze turn the runner compares the files the spec's analysis
will change with those of the other open, analysed specs (aide-spec-overlap),
and ends the step stopped on `shared-files` when a spec the record had not
warned about before the turn shares one. The comparison is a script's, so
a model that skips the analyze skill's own step is still caught.
"""

import json
import re

from ...conftest import READ_SPECS, git, run
from ..run_spec_invoking import BRANCH
from ..run_spec_results import RESULT_OK
from ..run_spec_status_files import phase_file_text, with_status

OTHER = "701-another-open-spec"
THIRD = "702-a-third-open-spec"
TEMPLATE = "# Queue - Solution\n\n(the template, nothing planned yet)\n"


def _analysis(files, warned=None):
    text = "# Queue - Analysis\n\n## Findings\n\n### Files to change\n\n" + "".join(f"- `{f}`\n" for f in files)
    if warned:
        text += "\n### Overlapping specs\n\n" + "".join(
            f"- `{spec}` — " + ", ".join(f"`{f}`" for f in spec_files) + "\n" for spec, spec_files in warned.items()
        )
    return text


def _commit(workspace, message):
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", message)


def _open_spec(workspace, folder, files, steps="create, analyze"):
    """Another spec of the project, on the specs repo's default branch."""
    d = workspace["specs"] / folder
    d.mkdir()
    (d / "1-description.md").write_text(f"# {folder} - Description\n")
    (d / "2-analysis.md").write_text(_analysis(files))
    (d / "4-status.md").write_text(
        f"# {folder} - Status\n\n## Tracking info\n\n- **Task:** `{folder}/`\n"
        f"- **Workflow steps completed:** {steps}\n"
    )
    _commit(workspace, f"add {folder}")


def _analyze(runner, workspace, fake_claude, files, written_record=None, earlier_record=None):
    """An analyze whose session writes 2-analysis.md listing `files` (and
    `written_record`, as if its own comparison step had recorded it), with
    3-solution.md left as its template. `earlier_record` is what the
    analysis already said before the turn."""
    with_status(workspace, ["create"])
    folder = workspace["folder"]
    spec_dir = workspace["specs"] / folder
    (spec_dir / "3-solution.md").write_text(TEMPLATE)
    if earlier_record:
        (spec_dir / "2-analysis.md").write_text(_analysis(files, earlier_record))
    _commit(workspace, "the analysis before the turn")
    body = (
        "cat > /dev/null\n" + READ_SPECS
        + f'cat > "$specs/{folder}/2-analysis.md" <<\'ANALYSISEOF\'\n'
        + _analysis(files, written_record or earlier_record) + "ANALYSISEOF\n"
        + f"echo '{json.dumps(RESULT_OK)}'\n"
    )
    rc, out, _, err = run(runner, workspace, fake_claude(body), command="analyze", return_stderr=True)
    assert rc == 0, out
    return out, err


def _on_branch(workspace, name):
    return phase_file_text(workspace, f"{workspace['folder']}/{name}")


def test_a_spec_sharing_a_file_ends_the_analysis_stopped_AC_2(runner, workspace, fake_claude):
    _open_spec(workspace, OTHER, ["shared.ts", "theirs.ts"])
    out, _ = _analyze(runner, workspace, fake_claude, ["shared.ts", "mine.ts"])
    assert out["ok"] is False, out
    assert out["terminalReason"] == "shared-files", out
    assert OTHER in out["error"] and "shared.ts" in out["error"], out["error"]
    subject = git(workspace["specs"], "log", "-1", "--pretty=%s", BRANCH)
    assert subject.endswith("(stopped: shared-files)"), subject


def test_the_stopped_analysis_keeps_its_work_and_records_the_spec_AC_2(runner, workspace, fake_claude):
    _open_spec(workspace, OTHER, ["shared.ts"])
    _analyze(runner, workspace, fake_claude, ["shared.ts", "mine.ts"])
    analysis = _on_branch(workspace, "2-analysis.md")
    assert "mine.ts" in analysis.split("### Overlapping specs")[0], analysis
    assert OTHER in analysis.split("### Overlapping specs")[1], analysis
    assert _on_branch(workspace, "3-solution.md") == TEMPLATE.rstrip("\n")
    tree = git(workspace["specs"], "ls-tree", "-r", "--name-only", BRANCH)
    state_path = f"{workspace['folder']}/4-status.json"
    if state_path in tree.splitlines():
        assert "analyze" not in json.loads(phase_file_text(workspace, state_path))["completedPhases"]


def test_a_record_the_session_wrote_itself_still_stops_the_step_AC_2(runner, workspace, fake_claude):
    _open_spec(workspace, OTHER, ["shared.ts"])
    out, _ = _analyze(runner, workspace, fake_claude, ["shared.ts"], written_record={OTHER: ["shared.ts"]})
    assert out["terminalReason"] == "shared-files", out
    assert out["sharedFiles"] == [{"spec": OTHER, "files": ["shared.ts"]}], out


def test_the_result_lists_each_spec_with_its_files_AC_3(runner, workspace, fake_claude):
    _open_spec(workspace, OTHER, ["x.ts", "y.ts", "other.ts"])
    _open_spec(workspace, THIRD, ["z.ts"])
    out, _ = _analyze(runner, workspace, fake_claude, ["z.ts", "y.ts", "x.ts"])
    assert out["sharedFiles"] == [
        {"spec": OTHER, "files": ["x.ts", "y.ts"]},
        {"spec": THIRD, "files": ["z.ts"]},
    ], out
    for name in (OTHER, THIRD, "x.ts", "y.ts", "z.ts"):
        assert name in out["error"], out["error"]


def test_a_spec_the_record_already_named_before_the_turn_lets_the_step_complete_AC_4(runner, workspace, fake_claude):
    _open_spec(workspace, OTHER, ["shared.ts"])
    out, _ = _analyze(runner, workspace, fake_claude, ["shared.ts"], earlier_record={OTHER: ["shared.ts"]})
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert "sharedFiles" not in out, out


def test_a_new_spec_still_stops_the_step_naming_it_alone_AC_4(runner, workspace, fake_claude):
    _open_spec(workspace, OTHER, ["shared.ts"])
    _open_spec(workspace, THIRD, ["fresh.ts"])
    out, _ = _analyze(
        runner, workspace, fake_claude, ["shared.ts", "fresh.ts"], earlier_record={OTHER: ["shared.ts"]},
    )
    assert out["terminalReason"] == "shared-files", out
    assert out["sharedFiles"] == [{"spec": THIRD, "files": ["fresh.ts"]}], out
    assert OTHER not in out["error"], out["error"]


def test_a_stopped_analysis_leaves_the_description_as_it_was_AC_6(runner, workspace, fake_claude):
    _open_spec(workspace, OTHER, ["shared.ts"])
    description = workspace["specs"] / workspace["folder"] / "1-description.md"
    description.write_text(
        "# Queue - Description\n\n## Tracking info\n\n- **Task:** `81-queue-and-runner/`\n"
        "- **Created:** `2026-10-05 11:59 UTC`\n\n## Description\n\nWhat is wanted.\n"
    )
    before = description.read_bytes()
    out, _ = _analyze(runner, workspace, fake_claude, ["shared.ts"])
    assert out["terminalReason"] == "shared-files", out
    assert _on_branch(workspace, "1-description.md").encode() == before.rstrip(b"\n")


def test_no_shared_file_completes_the_step_and_says_so_AC_7(runner, workspace, fake_claude):
    _open_spec(workspace, OTHER, ["theirs.ts"])
    out, err = _analyze(runner, workspace, fake_claude, ["mine.ts"])
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert "sharedFiles" not in out, out
    assert re.search(r"^aide-run-spec \d\d:\d\d:\d\d \+\d+s shared files: ", err, re.M), err
