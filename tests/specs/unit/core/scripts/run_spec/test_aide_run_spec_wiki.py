"""aide-run-spec --command wiki: a step that writes the project's wiki into
the specs repository and nothing else. Its tracking key is wiki-<project>,
the name `wiki` is reserved, and whatever the session wrote outside the
generated pages of wiki/ is taken back on every ending.
"""

import json
import os
import signal
import subprocess

import pytest

from ..conftest import READ_SPECS, STOP_DEADLINE_SEC, git, init_repo
from .run_spec_invoking import wait_until
from .run_spec_results import RESULT_OK

KEY = "wiki-demo"
BRANCH = f"aide/{KEY}"
FINISHED = f"echo '{json.dumps(RESULT_OK)}'"
HAND = "# Notes\n\nWritten by a person.\n"


def wiki_cmd(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-wiki"


def build_pages(workspace_root, pages=("queue",)):
    """What a session does with the script: pages, the schema, the prune, the index."""
    wiki_bin = wiki_cmd(workspace_root)
    lines = [READ_SPECS]
    for name in pages:
        lines.append(
            f'printf "# The {name}\\n\\nRuns the {name}.\\n" | {wiki_bin} write --specs-root "$specs" '
            f'--project-dir "$PWD" --page {name}.md --file README.md >/dev/null\n'
        )
    keep = " ".join(f"{n}.md" for n in pages)
    lines.append(f'{wiki_bin} schema --specs-root "$specs" --project-dir "$PWD" >/dev/null\n')
    lines.append(f'{wiki_bin} prune --specs-root "$specs" --keep {keep} >/dev/null\n')
    lines.append(f'{wiki_bin} index --specs-root "$specs" --project-dir "$PWD" >/dev/null\n')
    return "".join(lines)


def job(fake_claude, body):
    return fake_claude("cat > /dev/null\n" + body)


def wiki(runner, workspace, claude, **kwargs):
    kwargs.setdefault("command", "wiki")
    kwargs.setdefault("spec", KEY)
    kwargs.setdefault("push", "branch")
    from ..conftest import run
    return run(runner, workspace, claude, **kwargs)


def heads(bare):
    return git(bare, "ls-remote", "--heads", ".")


def show(bare, path):
    return git(bare, "show", f"{BRANCH}:{path}")


def land_hand_written(workspace, name="notes.md", text=HAND):
    """A page a person wrote, on the specs repository's default branch."""
    specs = workspace["specs"]
    (specs / "wiki").mkdir(exist_ok=True)
    (specs / "wiki" / name).write_text(text)
    git(specs, "add", "-A")
    git(specs, "commit", "-qm", f"hand-written {name}")
    git(specs, "push", "-q", "origin", "main")


# --- AC-1: the step, its key and its branch ---------------------------------


def test_a_build_commits_the_pages_on_its_own_branch_and_touches_nothing_else_AC_1(
    runner, workspace, workspace_root, fake_claude, origin
):
    project_before = heads(origin["project"])
    claude = job(fake_claude, build_pages(workspace_root) + FINISHED)
    rc, out, _ = wiki(runner, workspace, claude)
    assert rc == 0, out
    assert out["ok"] is True and out["terminalReason"] == "completed", out
    assert BRANCH in heads(origin["specs"])
    subjects = git(origin["specs"], "log", "--format=%s", f"main..{BRANCH}").splitlines()
    assert len(subjects) == 1 and subjects[0].startswith(f"Run /aide-wiki for {KEY} (headless)"), subjects
    for name in ("index.md", "schema.md", "queue.md"):
        assert show(origin["specs"], f"wiki/{name}")
    assert heads(origin["project"]) == project_before
    assert git(workspace["project"], "status", "--porcelain", "--untracked-files=no") == ""
    assert "Workflow steps completed" not in git(origin["specs"], "log", "--format=%B", f"main..{BRANCH}")


def test_a_second_build_with_a_wiki_on_disk_is_a_wiki_step_and_not_a_spec_AC_1(
    runner, workspace, workspace_root, fake_claude, origin
):
    land_hand_written(workspace)
    claude = job(fake_claude, build_pages(workspace_root, ("queue", "landing")) + FINISHED)
    rc, out, _ = wiki(runner, workspace, claude)
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    assert show(origin["specs"], "wiki/landing.md")
    assert show(origin["specs"], "wiki/notes.md") == HAND.strip()


def test_two_projects_sharing_a_specs_repository_each_get_their_own_branch_AC_1(
    runner, workspace, workspace_root, fake_claude, origin
):
    claude = job(fake_claude, build_pages(workspace_root) + FINISHED)
    rc, first, _ = wiki(runner, workspace, claude)
    assert rc == 0, first
    rc, second, _ = wiki(runner, workspace, claude, spec="wiki-other")
    assert rc == 0, second
    assert second["terminalReason"] == "completed", second
    listed = heads(origin["specs"])
    assert BRANCH in listed and "aide/wiki-other" in listed
    assert first["branch"] == BRANCH and second["branch"] == "aide/wiki-other"


def test_the_wiki_prompt_names_the_skill_and_asks_for_no_commit_message_AC_1(
    runner, workspace, fake_claude
):
    seen = fake_claude.calls.parent / "prompt-seen.txt"
    rc, out, _ = wiki(runner, workspace, fake_claude(f"cat > {seen}\n{FINISHED}"))
    assert rc == 0, out
    prompt = seen.read_text()
    assert prompt.startswith("/aide-wiki"), prompt
    assert "headless" in prompt
    assert "commit message" not in prompt, prompt


@pytest.mark.parametrize(
    "command,spec",
    [("wiki", "demo"), ("wiki", "wiki"), ("wiki", "81"), ("analyze", "wiki"), ("implement", "wiki")],
)
def test_a_wrong_key_or_the_reserved_name_is_refused_before_a_worktree_exists_AC_1(
    runner, workspace, fake_claude, command, spec
):
    rc, out, _ = wiki(runner, workspace, fake_claude(FINISHED), command=command, spec=spec)
    assert rc == 2 and out["terminalReason"] == "refused", out
    assert not fake_claude.calls.exists()
    assert not workspace["wtbase"].exists() or not any(workspace["wtbase"].iterdir())


def test_a_specs_folder_git_ignores_inside_the_project_is_refused_and_says_what_resolves_it_AC_1(
    runner, tmp_path, fake_claude
):
    project = init_repo(tmp_path / "solo")
    (project / ".gitignore").write_text("/specs/\n.aide/config\n")
    (project / "specs").mkdir()
    (project / ".aide").mkdir()
    (project / ".aide" / "config").write_text("AIDE_TEST_CMD=true\n")
    git(project, "add", ".gitignore")
    git(project, "commit", "-qm", "ignore specs")
    workspace = {"project": project, "specs": project / "specs", "folder": "x", "wtbase": tmp_path / "wt"}
    rc, out, _ = wiki(runner, workspace, fake_claude(FINISHED))
    assert rc == 2 and out["terminalReason"] == "refused", out
    assert "repository of their own" in out["error"], out
    assert not fake_claude.calls.exists()


# --- AC-4: what a session may not write is taken back -----------------------


def edit_hand_written():
    return 'echo "changed by the build" >> "$specs/wiki/notes.md"\n'


FOREIGN = {
    "edit": edit_hand_written(),
    "delete": 'rm "$specs/wiki/notes.md"\n',
    "outside": 'echo "note" > "$specs/job-note.txt"\n',
    "unmarked": 'printf "# Loose\\n\\nNo mark.\\n" > "$specs/wiki/loose.md"\n',
    "project": 'echo "changed by the build" > "$PWD/changed.txt"\n'
    'git add -A && git -c user.name=Job -c user.email=job@example.com commit -qm "build change"\n',
}


def assert_taken_back(origin, kind):
    bare = origin["specs"]
    assert show(bare, "wiki/notes.md") == HAND.strip(), "the hand-written page changed on the pushed branch"
    if kind != "outside":
        return
    assert git(bare, "ls-tree", "--name-only", BRANCH).split().count("job-note.txt") == 0


@pytest.mark.parametrize("kind", sorted(FOREIGN))
def test_a_foreign_write_is_taken_back_and_ends_the_build_as_a_scope_violation_AC_4(
    runner, workspace, workspace_root, fake_claude, origin, kind
):
    land_hand_written(workspace)
    project_before = heads(origin["project"])
    body = READ_SPECS + FOREIGN[kind] + build_pages(workspace_root) + FINISHED
    rc, out, _ = wiki(runner, workspace, job(fake_claude, body))
    assert out["ok"] is False and out["terminalReason"] == "scope-violation", out
    assert "the wiki build wrote what it may not" in out["error"], out
    assert_taken_back(origin, kind)
    assert heads(origin["project"]) == project_before
    if BRANCH in heads(origin["specs"]):
        assert "job-note.txt" not in git(origin["specs"], "ls-tree", "-r", "--name-only", BRANCH)
        assert "loose.md" not in git(origin["specs"], "ls-tree", "-r", "--name-only", BRANCH)


@pytest.mark.parametrize("kind", ["edit", "project"])
def test_a_build_stopped_by_its_clock_takes_foreign_writes_back_and_keeps_its_ending_AC_4(
    runner, workspace, workspace_root, fake_claude, origin, kind
):
    land_hand_written(workspace)
    project_before = heads(origin["project"])
    body = READ_SPECS + FOREIGN[kind] + build_pages(workspace_root) + "sleep 120\n"
    rc, out, _ = wiki(runner, workspace, job(fake_claude, body), timeout_sec=STOP_DEADLINE_SEC)
    assert out["terminalReason"] == "timeout", out
    assert_taken_back(origin, kind)
    assert heads(origin["project"]) == project_before


def test_a_cancelled_build_takes_foreign_writes_back_AC_4(
    runner, workspace, workspace_root, fake_claude, origin, tmp_path
):
    land_hand_written(workspace)
    ready = tmp_path / "ready"
    body = "cat > /dev/null\n" + READ_SPECS + FOREIGN["edit"] + build_pages(workspace_root) + f"touch {ready}\nsleep 60\n"
    claude = fake_claude(body)
    env = {**os.environ, "AIDE_CLAUDE_BIN": str(claude)}
    proc = subprocess.Popen(
        [
            str(runner), "--project-dir", str(workspace["project"]), "--command", "wiki", "--spec", KEY,
            "--timeout-sec", "120", "--permission-mode", "acceptEdits", "--push", "branch",
            "--result-file", str(tmp_path / "result.json"), "--worktree-base", str(workspace["wtbase"]),
        ],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
    )
    try:
        wait_until(ready.exists, 60, "the build never wrote its pages")
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=60)
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)
    assert_taken_back(origin, "edit")
    assert "queue.md" in git(origin["specs"], "ls-tree", "-r", "--name-only", BRANCH)


def test_a_foreign_write_a_cancelled_run_left_on_the_branch_is_taken_back_by_the_next_build_AC_4(
    runner, workspace, workspace_root, fake_claude, origin
):
    land_hand_written(workspace)
    # An earlier run's branch that already carries a foreign write.
    specs = workspace["specs"]
    git(specs, "checkout", "-q", "-b", BRANCH)
    (specs / "wiki" / "notes.md").write_text("edited by an earlier run\n")
    (specs / "job-note.txt").write_text("an earlier note\n")
    git(specs, "add", "-A")
    git(specs, "commit", "-qm", "an earlier build's leftovers")
    git(specs, "push", "-q", "origin", BRANCH)
    git(specs, "checkout", "-q", "main")
    rc, out, _ = wiki(runner, workspace, job(fake_claude, build_pages(workspace_root) + FINISHED))
    assert out["terminalReason"] == "scope-violation", out
    assert_taken_back(origin, "outside")
    assert "job-note.txt" not in git(origin["specs"], "ls-tree", "-r", "--name-only", BRANCH)


def test_building_again_rewrites_generated_pages_and_leaves_a_hand_written_one_AC_4(
    runner, workspace, workspace_root, fake_claude, origin
):
    land_hand_written(workspace)
    claude = job(fake_claude, build_pages(workspace_root, ("queue", "old")) + FINISHED)
    rc, first, _ = wiki(runner, workspace, claude)
    assert rc == 0, first
    specs = workspace["specs"]
    git(specs, "fetch", "-q", str(origin["specs"]), BRANCH)
    git(specs, "merge", "-q", "--ff-only", "FETCH_HEAD")
    git(specs, "push", "-q", "origin", "main")
    claude = job(fake_claude, build_pages(workspace_root, ("queue",)) + FINISHED)
    rc, out, _ = wiki(runner, workspace, claude)
    assert rc == 0 and out["terminalReason"] == "completed", out
    files = git(origin["specs"], "ls-tree", "-r", "--name-only", BRANCH).split()
    assert "wiki/queue.md" in files and "wiki/old.md" not in files
    assert show(origin["specs"], "wiki/notes.md") == HAND.strip()


# --- a build that built nothing ----------------------------------------------


def test_a_build_that_wrote_no_wiki_ends_as_no_progress_not_as_done(runner, workspace, fake_claude, origin):
    """The first build on the board was refused every aide-wiki call, said so,
    and still read as done: a completed run that leaves no index built nothing."""
    claude = job(fake_claude, "echo 'I could not build the wiki.' >&2\n" + FINISHED)
    rc, out, _ = wiki(runner, workspace, claude)
    assert out["ok"] is False and out["terminalReason"] == "no-progress", out
    assert "left no wiki" in out["error"], out
