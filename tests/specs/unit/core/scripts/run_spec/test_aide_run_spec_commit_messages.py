"""aide-run-spec: what a code repository's commit and pull request say.

A project may have nothing to do with Aide, so the code repository's
commit and pull request describe the change and name no tool. The
`Run /aide-<step> for <folder>` subject is the specs repository's
bookkeeping, read back from there alone, and stays there.
"""

import json

from ..conftest import READ_SPECS, STOP_DEADLINE_SEC, git
from ..conftest import run as run_step
from .run_spec_fakes import partially_committing_claude
from .run_spec_origins import run_with_gh as run_step_with_gh
from .run_spec_results import RESULT_OK

BRANCH = "aide/81-queue-and-runner"
MESSAGE = "Keep the queue in order\n\nJobs now start in the order they were added."


# The fake reads the path off its prompt, as a session does.
READ_MESSAGE_PATH = (
    'prompt="$(cat)"\n'
    'message_file="$(printf "%s" "$prompt" '
    "| sed -n 's|.*write the commit message for that change to \\([^ ]*\\) (do not commit).*|\\1|p')\"\n"
)
WRITE_CODE = 'echo "written by the step" > "$PWD/new-code.txt"\n'




def run(runner, workspace, claude, **kwargs):
    """An implement: the one step that is meant to change the code."""
    return run_step(runner, workspace, claude, command="implement", **kwargs)


def run_with_gh(runner, workspace, claude, gh, **kwargs):
    return run_step_with_gh(runner, workspace, claude, gh, command="implement", **kwargs)


def message_writing_claude(fake_claude, message=MESSAGE):
    """A step that changes the code and the spec, and proposes the code
    commit's message where the prompt told it to."""
    return fake_claude(
        READ_MESSAGE_PATH
        + READ_SPECS
        + WRITE_CODE
        + f"printf '%b\\n' {json.dumps(message)} > \"$message_file\"\n"
        + f"echo '{json.dumps(RESULT_OK)}'"
    )


def silent_claude(fake_claude, then="", prompt_seen="/dev/null"):
    """A step that changes the code and writes no message at all."""
    return fake_claude(
        f"cat > {prompt_seen}\n" + READ_SPECS + WRITE_CODE + then + f"echo '{json.dumps(RESULT_OK)}'"
    )


def test_the_code_commit_is_the_message_the_step_wrote(runner, workspace, fake_claude):
    rc, out, _ = run(runner, workspace, message_writing_claude(fake_claude))
    assert rc == 0, out
    assert git(workspace["project"], "log", "-1", "--pretty=%B", BRANCH).strip() == MESSAGE


def test_the_specs_commit_keeps_the_step_s_own_subject(runner, workspace, fake_claude):
    rc, out, _ = run(runner, workspace, message_writing_claude(fake_claude))
    assert rc == 0, out
    subjects = git(workspace["specs"], "log", "--pretty=%s", BRANCH)
    assert "Run /aide-implement for 81-queue-and-runner (headless)" in subjects


def test_without_a_message_the_code_commit_is_the_spec_s_title(runner, workspace, fake_claude):
    rc, out, _ = run(runner, workspace, silent_claude(fake_claude))
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert git(workspace["project"], "log", "-1", "--pretty=%B", BRANCH).strip() == "Queue"


def test_the_prompt_says_where_the_message_goes_and_what_it_leaves_out(runner, workspace, fake_claude):
    seen = fake_claude.calls.parent / "prompt-seen.txt"
    rc, out, _ = run(runner, workspace, silent_claude(fake_claude, prompt_seen=seen))
    assert rc == 0, out
    prompt = seen.read_text()
    assert "write the commit message for that change to " in prompt
    assert "Do not mention the spec, the workflow step, Aide, or any AI tool or model." in prompt


def test_the_pull_request_says_what_the_commit_says(runner, workspace, fake_claude, fake_gh, origin):
    claude = message_writing_claude(fake_claude)
    rc, out, _ = run_with_gh(runner, workspace, claude, fake_gh(), push="pr")
    assert rc == 0, out
    called = fake_gh.calls.read_text()
    assert "--title Keep the queue in order --body Jobs now start in the order they were added." in called
    assert "aide run" not in called.lower()
    assert "Run /aide-" not in called


def test_a_stopped_step_folds_into_its_own_code_commit_without_a_note(runner, workspace, fake_claude):
    """The stop reason and the model are the specs repository's record;
    the code commit keeps the step's own words."""
    claude = partially_committing_claude(
        fake_claude, then="trap '' TERM\nwhile true; do sleep 0.2; done\n"
    )
    rc, out, _ = run(runner, workspace, claude, timeout_sec=STOP_DEADLINE_SEC, kill_grace_sec="2")
    assert out["terminalReason"] == "timeout"
    message = git(workspace["project"], "log", "-1", "--pretty=%B", BRANCH)
    assert message.strip() == "The step wrote this itself\n\nAnd explained why, the way a written message does."
    assert git(workspace["project"], "show", f"{BRANCH}:left-behind.txt")


def test_a_stopped_step_s_own_code_commit_is_marked_unfinished(runner, workspace, fake_claude):
    claude = silent_claude(fake_claude, then="trap '' TERM\nwhile true; do sleep 0.2; done\n")
    rc, out, _ = run(runner, workspace, claude, timeout_sec=STOP_DEADLINE_SEC, kill_grace_sec="2")
    assert out["terminalReason"] == "timeout"
    assert git(workspace["project"], "log", "-1", "--pretty=%B", BRANCH).strip() == "WIP: Queue"
