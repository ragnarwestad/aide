"""An implement on a short analysis that finds the spec is not small after all
writes one sentence to a file its prompt names, and the runner ends the step
`sent-back`: it records the sentence in the description's Tracking info, so
the next Analyze is not offered a short analysis again. The same sentence on a
spec whose analysis was full, or whose description cannot hold the line, ends
`sent-back-refused`, failed, and changes nothing.
"""

import json

from ...conftest import READ_SPECS, git, run
from ..run_spec_invoking import BRANCH
from ..run_spec_results import RESULT_OK
from ..run_spec_status_files import phase_file_text, status_with_phase

SENTENCE = "it changes the result format every page reads, in nine files"
LABEL = "- **Sent back to a full analysis:**"
CREATED = "- **Created:** `2026-10-19 12:02 UTC`"
ANALYSIS_SHORT = "- **Analysis:** short"


def _spec(workspace, analysis=ANALYSIS_SHORT, tracking=(CREATED,)):
    """A spec ready for implement: its analysis, and a description whose
    Tracking info holds `tracking`, committed."""
    status_with_phase(workspace, "create, analyze", ["| a | ⬜ | |"])
    spec = workspace["specs"] / workspace["folder"]
    head = "# Queue - Analysis\n\n## Tracking info\n\n"
    (spec / "2-analysis.md").write_text(head + (f"{analysis}\n" if analysis else "") + "\n## Findings\n")
    lines = ["# Queue - Description", "", "## Tracking info", "", "- **Task:** `81-queue-and-runner/`", *tracking]
    (spec / "1-description.md").write_text("\n".join(lines) + "\n\n## Description\n")
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "the spec before implement")


def _claude(fake_claude, sentence=SENTENCE, code=False, seen=None):
    """A session that writes `sentence` to the file the prompt names (nothing
    when `sentence` is None), and a code file when `code`."""
    keep = f'printf "%s" "$prompt" > {seen}\n' if seen else ""
    write = ""
    if sentence is not None:
        write = f'[ -n "$file" ] && cat > "$file" <<\'SENTENCEEOF\'\n{sentence}\nSENTENCEEOF\n'
    body = (
        'prompt="$(cat)"\n' + keep
        + 'file="$(printf "%s\\n" "$prompt" | grep -oE "[^ ]+/sent-back" | head -1)"\n'
        + READ_SPECS + write
        + ('echo "written by the step" > "$PWD/new-code.txt"\n' if code else "")
        + f"echo '{json.dumps(RESULT_OK)}'\n"
    )
    return fake_claude(body)


def _implement(runner, workspace, claude):
    rc, out, _ = run(runner, workspace, claude, command="implement")
    assert rc == 0, out
    return out


def _description(workspace, branch=BRANCH):
    return phase_file_text(workspace, f"{workspace['folder']}/1-description.md", branch)


def _recorded(workspace):
    return [l for l in _description(workspace).splitlines() if l.startswith(LABEL)]


def test_a_sentence_on_a_short_analysis_ends_the_step_sent_back_AC_1(runner, workspace, fake_claude):
    _spec(workspace)
    out = _implement(runner, workspace, _claude(fake_claude))
    assert out["ok"] is False, out
    assert out["terminalReason"] == "sent-back", out
    assert SENTENCE in out["error"], out["error"]
    subject = git(workspace["specs"], "log", "-1", "--pretty=%s", BRANCH)
    assert subject.endswith("(stopped: sent-back)"), subject


def test_a_sentence_ends_the_step_sent_back_whatever_else_the_session_wrote_AC_1(runner, workspace, fake_claude):
    _spec(workspace, analysis="- **Analysis:** short — no plan")
    out = _implement(runner, workspace, _claude(fake_claude, code=True))
    assert out["terminalReason"] == "sent-back", out


def test_no_sentence_leaves_the_step_as_it_was_AC_1(runner, workspace, fake_claude):
    _spec(workspace)
    out = _implement(runner, workspace, _claude(fake_claude, sentence=None))
    assert out["terminalReason"] == "no-progress", out
    assert _recorded(workspace) == []


def test_a_sentence_that_is_empty_once_cleaned_is_no_sentence_AC_1(runner, workspace, fake_claude):
    _spec(workspace)
    out = _implement(runner, workspace, _claude(fake_claude, sentence="  \n\n  "))
    assert out["terminalReason"] == "no-progress", out
    assert _recorded(workspace) == []


def test_every_implement_prompt_names_the_sentence_file_and_the_limits_AC_1(runner, workspace, fake_claude, tmp_path):
    _spec(workspace, analysis="- **Analysis:** full")
    seen = tmp_path / "implement-prompt.txt"
    _implement(runner, workspace, _claude(fake_claude, sentence=None, seen=seen))
    prompt = seen.read_text()
    [line] = [l for l in prompt.splitlines() if "sent-back" in l]
    assert "more than 3 source files to change (tests and documentation are not counted)" in line and "LOW" in line, line


def test_an_analyze_prompt_does_not_name_a_sentence_file_AC_1(runner, workspace, fake_claude, tmp_path):
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    seen = tmp_path / "analyze-prompt.txt"
    claude = fake_claude(f'cat > {seen}\necho \'{json.dumps(RESULT_OK)}\'\n')
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert rc == 0, out
    assert "sent-back" not in seen.read_text()


def test_the_sentence_is_kept_in_the_description_on_one_line_without_backticks_AC_1(runner, workspace, fake_claude):
    _spec(workspace, tracking=(CREATED, "- **Let me choose the approach:** no"))
    out = _implement(runner, workspace, _claude(fake_claude, sentence="it needs `three` more\nfiles \\n and a\nnew format"))
    assert out["terminalReason"] == "sent-back", out
    assert _recorded(workspace) == [f"{LABEL} it needs three more files \\n and a new format"]
    lines = _description(workspace).splitlines()
    assert lines.index(_recorded(workspace)[0]) == lines.index("- **Let me choose the approach:** no") + 1


def test_the_sentence_is_cut_to_a_length_a_row_can_show_AC_1(runner, workspace, fake_claude):
    _spec(workspace)
    _implement(runner, workspace, _claude(fake_claude, sentence="x" * 500))
    [line] = _recorded(workspace)
    assert line == f"{LABEL} " + "x" * 300


def test_an_earlier_line_is_replaced_not_added_to_AC_1(runner, workspace, fake_claude):
    _spec(workspace, tracking=(CREATED, f"{LABEL} an earlier sentence"))
    _implement(runner, workspace, _claude(fake_claude))
    assert _recorded(workspace) == [f"{LABEL} {SENTENCE}"]


def test_a_sentence_on_a_full_analysis_is_refused_and_the_description_is_left_alone_AC_4(runner, workspace, fake_claude):
    _spec(workspace, analysis="- **Analysis:** full")
    before = _description(workspace, "main")
    out = _implement(runner, workspace, _claude(fake_claude))
    assert out["ok"] is False, out
    assert out["terminalReason"] == "sent-back-refused", out
    assert "its analysis is already full" in out["error"], out["error"]
    assert _description(workspace) == before
    subject = git(workspace["specs"], "log", "-1", "--pretty=%s", BRANCH)
    assert subject.endswith("(stopped: sent-back-refused)"), subject


def test_a_sentence_with_no_analysis_line_is_refused_AC_4(runner, workspace, fake_claude):
    _spec(workspace, analysis=None)
    out = _implement(runner, workspace, _claude(fake_claude))
    assert out["terminalReason"] == "sent-back-refused", out


def test_a_description_that_cannot_hold_the_line_is_refused_AC_4(runner, workspace, fake_claude):
    _spec(workspace, tracking=())
    before = _description(workspace, "main")
    out = _implement(runner, workspace, _claude(fake_claude))
    assert out["ok"] is False, out
    assert out["terminalReason"] == "sent-back-refused", out
    assert "no Created line" in out["error"], out["error"]
    assert _description(workspace) == before
