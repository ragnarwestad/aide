"""In Aide's own repository an `implement` whose branch changes a file under
`dashboard/src/render/` or a stylesheet leaves screenshots of the pages it
changed in a folder beside the step's log. The runner names the folder in
the prompt, keeps it, logs what it holds (or why it holds nothing), and
hands it to the review. A project without `dashboard/scripts/look-at-pages.ts`
and a branch that changes no page get none of this.
"""

import json
import re

from ...conftest import git, run
from ..run_spec_status_files import with_status

REVIEW_MARKER = "Read this spec's own description"
FIX_MARKER = "A review of what you changed found"
SCREENSHOTS_REVIEW_MARKER = "Screenshots of the pages this change affects"
SCREENSHOTS_FIX_MARKER = "take its screenshots again into"

IMPLEMENT_SESSION = "ee80227f-510c-45e9-bfbf-c5124f7761c0"
REVIEW_SESSION = "review-throwaway-session-id"


def _stamped(err):
    return [m.group(1) for m in re.finditer(r"^aide-run-spec \d\d:\d\d:\d\d \+\d+s (.+)$", err, re.M)]


def _result(session_id, text, cost=0.1):
    return {
        "type": "result", "subtype": "success", "is_error": False,
        "session_id": session_id, "total_cost_usd": cost, "num_turns": 1,
        "terminal_reason": "completed", "result": text,
    }


def _aide_repo(workspace):
    """The project gains the script that marks it as Aide's own repository."""
    project = workspace["project"]
    (project / "dashboard" / "scripts").mkdir(parents=True)
    (project / "dashboard" / "scripts" / "look-at-pages.ts").write_text("// the script\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "add the script")


def _stream(tmp_path):
    jobs = tmp_path / "jobs"
    jobs.mkdir()
    return jobs / "job-1.implement.stream.jsonl", jobs / "job-1.implement.screenshots"


def _implementing_claude(fake_claude, tmp_path, folder, *, changes, leaves="", review_reply="review: no defects found"):
    """The implement turn commits a change to `changes` and leaves `leaves`
    in the screenshots folder (`png`, `note`, both or nothing). The prompts
    it and the review read are kept in files."""
    leave = ""
    if "png" in leaves:
        leave += f"  mkdir -p '{folder}' && printf 'png' > '{folder}/01-x-1440.png'\n"
    if "note" in leaves:
        leave += f"  mkdir -p '{folder}' && printf 'chromium did not start\\n' > '{folder}/not-taken.txt'\n"
    parent = changes.rpartition("/")[0] or "."
    return fake_claude(
        "prompt=\"$(cat)\"\n"
        f"if printf '%s' \"$prompt\" | grep -q \"{REVIEW_MARKER}\"; then\n"
        f"  printf '%s' \"$prompt\" > {tmp_path / 'review-prompt.txt'}\n"
        f"  echo '{json.dumps(_result(REVIEW_SESSION, review_reply, 0.05))}'\n"
        f"elif printf '%s' \"$prompt\" | grep -q \"{FIX_MARKER}\"; then\n"
        f"  printf '%s' \"$prompt\" > {tmp_path / 'fix-prompt.txt'}\n"
        f"  echo '{json.dumps(_result(IMPLEMENT_SESSION, 'done', 0.2))}'\n"
        "else\n"
        f"  printf '%s' \"$prompt\" > {tmp_path / 'implement-prompt.txt'}\n"
        f"  mkdir -p '{parent}' && printf 'x\\n' > '{changes}'\n"
        f"{leave}"
        "  git add -A && git commit -q -m 'the step'\n"
        f"  echo '{json.dumps(_result(IMPLEMENT_SESSION, 'done', 0.1))}'\n"
        "fi\n"
    )


def _implement(runner, workspace, claude, stream):
    return run(
        runner, workspace, claude, command="implement",
        stream_file=str(stream), return_stderr=True,
    )


def test_the_prompt_names_the_folder_beside_the_steps_log_in_aides_own_repo(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    _aide_repo(workspace)
    stream, folder = _stream(tmp_path)
    claude = _implementing_claude(fake_claude, tmp_path, folder, changes="dashboard/src/render/x.ts")
    rc, out, _, _ = _implement(runner, workspace, claude, stream)
    assert rc == 0, out
    prompt = (tmp_path / "implement-prompt.txt").read_text()
    assert f"leave the final screenshots in {folder}." in prompt, prompt
    assert f"{folder}/not-taken.txt" in prompt, prompt


def test_a_project_without_the_script_gets_no_screenshots_line_and_no_folder(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    stream, folder = _stream(tmp_path)
    claude = _implementing_claude(fake_claude, tmp_path, folder, changes="dashboard/src/render/x.ts")
    rc, out, _, err = _implement(runner, workspace, claude, stream)
    assert rc == 0, out
    assert "screenshots" not in (tmp_path / "implement-prompt.txt").read_text()
    assert "screenshots" not in (tmp_path / "review-prompt.txt").read_text()
    assert not folder.exists()
    assert not any("screenshots" in s or "pages were not looked at" in s for s in _stamped(err))


def test_kept_screenshots_are_logged_left_in_place_and_given_to_the_review(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    _aide_repo(workspace)
    stream, folder = _stream(tmp_path)
    claude = _implementing_claude(
        fake_claude, tmp_path, folder, changes="dashboard/src/render/x.ts", leaves="png"
    )
    rc, out, _, err = _implement(runner, workspace, claude, stream)
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert (folder / "01-x-1440.png").read_text() == "png"
    stages = _stamped(err)
    kept = stages.index("screenshots: 1 of the changed pages, kept with the step's logs")
    assert stages.index("reviewing what the step changed") > kept, stages
    review = (tmp_path / "review-prompt.txt").read_text()
    assert f"{SCREENSHOTS_REVIEW_MARKER}, each at 1440 px and 390 px wide, are in {folder}." in review, review
    assert "is a defect too" in review, review


def test_a_stylesheet_alone_calls_for_screenshots(runner, workspace, fake_claude, tmp_path):
    with_status(workspace, ["create", "analyze"])
    _aide_repo(workspace)
    stream, folder = _stream(tmp_path)
    claude = _implementing_claude(
        fake_claude, tmp_path, folder, changes="dashboard/public/site.css", leaves="png"
    )
    rc, out, _, err = _implement(runner, workspace, claude, stream)
    assert rc == 0, out
    assert "screenshots: 1 of the changed pages, kept with the step's logs" in _stamped(err)


def test_the_fix_turn_is_asked_to_take_the_screenshots_again(runner, workspace, fake_claude, tmp_path):
    with_status(workspace, ["create", "analyze"])
    _aide_repo(workspace)
    stream, folder = _stream(tmp_path)
    claude = _implementing_claude(
        fake_claude, tmp_path, folder, changes="dashboard/src/render/x.ts", leaves="png",
        review_reply="review: 1 defect(s) found" + chr(10) + "1. The button sits inside the message",
    )
    rc, out, _, _ = _implement(runner, workspace, claude, stream)
    assert rc == 0, out
    fix = (tmp_path / "fix-prompt.txt").read_text()
    assert f"{SCREENSHOTS_FIX_MARKER} {folder}" in fix, fix


def test_a_review_of_a_branch_with_no_png_is_told_nothing_about_screenshots(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    _aide_repo(workspace)
    stream, folder = _stream(tmp_path)
    claude = _implementing_claude(
        fake_claude, tmp_path, folder, changes="dashboard/src/render/x.ts", leaves="note"
    )
    rc, out, _, _ = _implement(runner, workspace, claude, stream)
    assert rc == 0, out
    assert SCREENSHOTS_REVIEW_MARKER not in (tmp_path / "review-prompt.txt").read_text()


def test_pages_not_looked_at_are_logged_with_the_reason_and_the_step_goes_on(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    _aide_repo(workspace)
    stream, folder = _stream(tmp_path)
    claude = _implementing_claude(
        fake_claude, tmp_path, folder, changes="dashboard/src/render/x.ts", leaves="note"
    )
    rc, out, _, err = _implement(runner, workspace, claude, stream)
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert "testedGreen" in out, out
    stages = _stamped(err)
    assert (
        "error: the changed pages were not looked at: chromium did not start — proceeding without them"
        in stages
    ), stages
    assert "reviewing what the step changed" in stages, stages


def test_pages_with_no_png_and_no_reason_say_so_and_never_count_an_earlier_attempts_png(
    runner, workspace, fake_claude, tmp_path
):
    with_status(workspace, ["create", "analyze"])
    _aide_repo(workspace)
    stream, folder = _stream(tmp_path)
    folder.mkdir()
    (folder / "99-old-1440.png").write_text("an earlier attempt")
    claude = _implementing_claude(fake_claude, tmp_path, folder, changes="dashboard/src/render/x.ts")
    rc, out, _, err = _implement(runner, workspace, claude, stream)
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert (
        "error: the changed pages were not looked at: no screenshots and no reason were left"
        " — proceeding without them"
    ) in _stamped(err)
    assert not (folder / "99-old-1440.png").exists()


def test_a_branch_that_changes_no_page_keeps_no_screenshots(runner, workspace, fake_claude, tmp_path):
    with_status(workspace, ["create", "analyze"])
    _aide_repo(workspace)
    stream, folder = _stream(tmp_path)
    claude = _implementing_claude(
        fake_claude, tmp_path, folder, changes="dashboard/src/queue/x.ts", leaves="png"
    )
    rc, out, _, err = _implement(runner, workspace, claude, stream)
    assert rc == 0, out
    assert not folder.exists()
    assert not any("screenshots" in s or "pages were not looked at" in s for s in _stamped(err))
    assert SCREENSHOTS_REVIEW_MARKER not in (tmp_path / "review-prompt.txt").read_text()
