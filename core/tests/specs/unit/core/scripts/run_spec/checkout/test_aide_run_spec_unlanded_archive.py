"""An archive whose landing never finished leaves the spec's folder under
`archive/` on the spec's own specs branch while the default branch still
has it open. A later step other than archive puts the folder back where
the default branch has it before its session starts
(run-spec/checkout/unlanded-archive.sh), and a later Archive works from
there as from any implemented spec.
"""

import json
import subprocess

import pytest

from ...conftest import READ_SPECS, git, run
from ..run_spec_results import RESULT_OK
from ..run_spec_status_files import with_status

FOLDER = "81-queue-and-runner"
BRANCH = f"aide/{FOLDER}"


def _archive_that_never_landed(runner, workspace):
    """The spec's specs branch as an archive leaves it when its landing
    stops: aide-archive-spec's stamp and move, a file the archive session
    wrote into the archived copy, `archive` on the steps line, all
    committed under the archive step's own subject. Main is untouched."""
    specs = workspace["specs"]
    git(specs, "switch", "-q", "-c", BRANCH)
    out = subprocess.run(
        [str(runner.parent / "aide-archive-spec"), "--project-dir", str(workspace["project"]),
         "--spec", FOLDER, "--specs-dir", str(specs)],
        capture_output=True, text=True,
    ).stdout
    assert json.loads(out.strip().splitlines()[-1])["terminalReason"] == "archived", out
    archived = specs / "archive" / FOLDER
    (archived / "notes.md").write_text("written by the archive session\n")
    status = archived / "4-status.md"
    status.write_text(status.read_text().replace(
        "Workflow steps completed:** create, analyze, implement",
        "Workflow steps completed:** create, analyze, implement, archive",
    ))
    git(specs, "add", "-A")
    git(specs, "commit", "-qm", f"Run /aide-archive for {FOLDER} (headless)")
    git(specs, "switch", "-q", "main")


def _session_writing_into_the_open_folder(fake_claude, tmp_path, writes_code=True):
    seen = tmp_path / "folder-seen.txt"
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'if [ -d "$specs/{FOLDER}" ]; then echo open >> {seen}; else echo missing >> {seen}; fi\n'
        + f'[ -d "$specs/{FOLDER}" ] && printf "the session\\n" > "$specs/{FOLDER}/3-solution.md"\n'
        + ("printf 'real work\\n' > implemented.txt\n"
           "git add -A && git commit -q -m 'the step' >/dev/null 2>&1 || true\n" if writes_code else "")
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    return claude, seen


@pytest.mark.parametrize("command", ["analyze", "implement"])
def test_a_step_on_a_branch_whose_archive_never_landed_moves_the_folder_back(
    runner, workspace, fake_claude, tmp_path, command
):
    with_status(workspace, ["create", "analyze", "implement"])
    _archive_that_never_landed(runner, workspace)
    claude, seen = _session_writing_into_the_open_folder(fake_claude, tmp_path, writes_code=command == "implement")

    rc, out, _ = run(runner, workspace, claude, command=command)

    assert out["terminalReason"] == "completed", out
    assert seen.read_text().splitlines()[0] == "open", "the session must find the folder where main has it"
    specs = workspace["specs"]
    tree = git(specs, "ls-tree", "-r", "--name-only", BRANCH).splitlines()
    assert f"{FOLDER}/notes.md" in tree, "what the archive wrote must come along"
    assert f"{FOLDER}/3-solution.md" in tree, tree
    assert not any(p.startswith(f"archive/{FOLDER}/") for p in tree), tree
    steps = git(specs, "show", f"{BRANCH}:{FOLDER}/4-status.md")
    steps_line = next(l for l in steps.splitlines() if "Workflow steps completed" in l)
    assert "archive" not in steps_line, steps_line
    state = json.loads(git(specs, "show", f"{BRANCH}:{FOLDER}/4-status.json"))
    assert state["archived"] is None, state
    assert "archive" not in state["completedPhases"], state
    subjects = git(specs, "log", "--format=%s", BRANCH).splitlines()
    assert any(s.startswith(f"Move {FOLDER} back out of archive/") for s in subjects), subjects


def test_an_archive_after_the_move_back_archives_as_usual(runner, workspace, fake_claude, tmp_path):
    with_status(workspace, ["create", "analyze", "implement"])
    _archive_that_never_landed(runner, workspace)
    claude, _ = _session_writing_into_the_open_folder(fake_claude, tmp_path)
    run(runner, workspace, claude, command="implement")

    checkout = tmp_path / "branch-checkout"
    git(workspace["specs"], "worktree", "add", "-q", str(checkout), BRANCH)
    out = subprocess.run(
        [str(runner.parent / "aide-archive-spec"), "--project-dir", str(workspace["project"]),
         "--spec", FOLDER, "--specs-dir", str(checkout)],
        capture_output=True, text=True,
    ).stdout
    assert json.loads(out.strip().splitlines()[-1])["terminalReason"] == "archived", out
