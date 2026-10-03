"""An archive that rewrites the wiki pages covering the files its own
spec changed, and retains current reasons in those pages: what it may write, and
what is taken back."""

import json
import subprocess
from ...conftest import READ_SPECS, git, run
from ..run_spec_origins import origin
from ..run_spec_results import RESULT_OK
from ..run_spec_status_files import status_with_phase


# --- an archive that rewrites the wiki pages its own spec touched -----------
# The new `wiki/` exception in run-spec/record/specs-guard.sh (archive-only), and
# the precision check in run-spec/publish/wiki-guard.sh that recomputes the
# allowed pages fresh via `aide-wiki affected` and takes back anything
# else — never trusting what the session claims it rewrote.

ARCHIVE_BRANCH = "aide/81-queue-and-runner"


def _wiki_bin(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-wiki"


def _write_wiki_page(workspace_root, specs, project, name, files):
    wiki = _wiki_bin(workspace_root)
    args = [str(wiki), "write", "--specs-root", str(specs), "--project-dir", str(project), "--page", name]
    for f in files:
        args += ["--file", f]
    proc = subprocess.run(args, input=f"# {name}\n\nAbout {name}.\n", capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr


def _archive_wiki_workspace(workspace, workspace_root):
    """A project with two generated wiki pages (`p.md` over `x.txt`,
    `q.md` over `y.txt`) and one hand-written page (`notes.md`), then the
    spec's own branch already carrying an `implement`-shaped commit
    (`_branch_with_earlier_implement_code`'s own shape) that changes
    `x.txt` alone — `p.md` is this spec's own diff, `q.md` is not."""
    project = workspace["project"]
    specs = workspace["specs"]
    (project / "x.txt").write_text("x\n")
    (project / "y.txt").write_text("y\n")
    git(project, "add", "-A")
    git(project, "commit", "-qm", "add x and y")
    _write_wiki_page(workspace_root, specs, project, "p.md", ["x.txt"])
    _write_wiki_page(workspace_root, specs, project, "q.md", ["y.txt"])
    (specs / "wiki" / "notes.md").write_text("# Notes\n\nWritten by a person.\n")
    git(specs, "add", "-A")
    git(specs, "commit", "-qm", "seed the wiki")
    git(project, "switch", "-q", "-c", ARCHIVE_BRANCH)
    (project / "x.txt").write_text("x, changed by implement\n")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "implement")
    git(project, "switch", "-q", "main")
    return ARCHIVE_BRANCH


def _wiki_page(workspace, branch, name):
    return git(workspace["specs"], "show", f"{branch}:wiki/{name}")


def test_an_archive_rewrites_the_page_covering_its_own_changed_file_AC_1(
    runner, workspace, workspace_root, fake_claude
):
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    wiki = _wiki_bin(workspace_root)
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "# P\\n\\nRewritten.\\n" | {wiki} write --specs-root "$specs" '
        + '--project-dir "$PWD" --page p.md --file x.txt >/dev/null\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _, err = run(runner, workspace, claude, command="archive", return_stderr=True)
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    text = _wiki_page(workspace, branch, "p.md")
    assert "Rewritten." in text
    head = git(workspace["project"], "rev-parse", branch)
    assert f"commit: {head}" in text
    assert "wiki pages rewritten: p.md" in err


def test_an_archive_that_touches_no_wiki_page_leaves_it_unchanged_AC_2_AC_4(
    runner, workspace, workspace_root, fake_claude
):
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    before = {name: _wiki_page(workspace, "main", name) for name in ("p.md", "q.md", "notes.md")}
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _, err = run(runner, workspace, claude, command="archive", return_stderr=True)
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    for name, text in before.items():
        assert _wiki_page(workspace, branch, name) == text
    assert "wiki pages rewritten: none" in err


def test_a_page_main_changed_while_the_archive_ran_is_not_the_archives_write(
    runner, workspace, workspace_root, fake_claude, origin
):
    """Another run lands a new `schema.md` on the default branch while
    this archive runs — a page an archive may never write. The archive's
    branch still has the older wiki, which is main moving on, not the
    archive writing it."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    _archive_wiki_workspace(workspace, workspace_root)
    specs = workspace["specs"]
    git(specs, "push", "-q", "origin", "main")
    moved = (
        f'echo "# Schema" > "{specs}/wiki/schema.md"\n'
        f'git -C "{specs}" add wiki/schema.md\n'
        f'git -C "{specs}" commit -qm "another run\'s wiki refresh"\n'
        f'git -C "{specs}" push -q origin main\n'
    )
    claude = fake_claude("cat > /dev/null\n" + moved + f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert out["terminalReason"] == "completed", out.get("error")


def test_an_archive_that_writes_a_page_outside_its_own_diff_is_taken_back_AC_2_AC_4(
    runner, workspace, workspace_root, fake_claude
):
    """A page whose own file the spec never touched (`q.md`, over `y.txt`)
    rewritten anyway — the guard's own recomputed answer, not the
    session's claim, decides what stays."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    before = _wiki_page(workspace, "main", "q.md")
    wiki = _wiki_bin(workspace_root)
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "# Q\\n\\nRewritten anyway.\\n" | {wiki} write --specs-root "$specs" '
        + '--project-dir "$PWD" --page q.md --file y.txt >/dev/null\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    assert "q.md" in out["error"], out
    assert _wiki_page(workspace, branch, "q.md") == before


def test_an_archive_that_creates_a_brand_new_unaffected_page_is_taken_back_AC_2_AC_4(
    runner, workspace, workspace_root, fake_claude
):
    """A page that never existed before this run is UNTRACKED at the
    point the guard checks it — `git diff` alone is silent about an
    untracked file, so a check built on `git diff --quiet` misses it
    unless it also looks at `git status`."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    wiki = _wiki_bin(workspace_root)
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "# New\\n\\nUnrelated.\\n" | {wiki} write --specs-root "$specs" '
        + '--project-dir "$PWD" --page new.md --file y.txt >/dev/null\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    assert "new.md" in out["error"], out
    tree = git(workspace["specs"], "ls-tree", "-r", "--name-only", branch).split()
    assert "wiki/new.md" not in tree, tree


def test_an_archive_that_deletes_an_unaffected_page_is_restored_AC_2_AC_4(
    runner, workspace, workspace_root, fake_claude
):
    """A page the run DELETED is absent from `wiki/`'s own listing
    afterward — a check that only globs what remains on disk never
    visits it, so the deletion would otherwise land unnoticed."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    before = _wiki_page(workspace, "main", "q.md")
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'rm "$specs/wiki/q.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    assert "q.md" in out["error"], out
    assert _wiki_page(workspace, branch, "q.md") == before


def test_an_archive_that_edits_a_hand_written_page_is_taken_back_AC_3(
    runner, workspace, workspace_root, fake_claude
):
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    before = _wiki_page(workspace, "main", "notes.md")
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'echo "edited by the step" >> "$specs/wiki/notes.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out
    assert "notes.md" in out["error"], out
    assert _wiki_page(workspace, branch, "notes.md") == before


def test_an_archive_cannot_add_a_legacy_page_even_with_backlinks_AC_1(
    runner, workspace, workspace_root, fake_claude
):
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    body = (
        "cat > /dev/null\n" + READ_SPECS
        + f'printf -- "---\\nwiki: decision\\nspec: {workspace["folder"]}\\n---\\n\\n# Old\\n\\nKeep it.\\n\\n## Concerns\\n\\n- [Q](q.md)\\n" > "$specs/wiki/legacy.md"\n'
        + 'printf "\\n## Decisions\\n\\n- [Old](legacy.md) — Keep it.\\n" >> "$specs/wiki/q.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, fake_claude(body), command="archive")
    assert out["terminalReason"] == "scope-violation", out
    assert "wiki/legacy.md" not in git(workspace["specs"], "ls-tree", "-r", "--name-only", branch).split()
    assert _wiki_page(workspace, branch, "q.md") == _wiki_page(workspace, "main", "q.md")


def test_a_non_archive_step_writing_the_wiki_is_still_a_scope_violation(
    runner, workspace, fake_claude
):
    """The new `wiki/` exception in run-spec/record/specs-guard.sh is
    `archive`-only, by the literal command string — mirrors
    `test_archive_no_progress_guard_never_fires_for_other_steps` above,
    inverted: an unrelated step must never be able to write the wiki
    undetected, or the guard's whole purpose is defeated (the guard
    file's own comment, spec 366)."""
    status_with_phase(workspace, "create", ["| a | ⬜ | |"])
    (workspace["specs"] / "wiki").mkdir()
    (workspace["specs"] / "wiki" / "p.md").write_text("# P\n\nSeed.\n")
    git(workspace["specs"], "add", "-A")
    git(workspace["specs"], "commit", "-qm", "seed the wiki")
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + 'echo "changed by analyze" >> "$specs/wiki/p.md"\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="analyze")
    assert out["ok"] is False, out
    assert out["terminalReason"] == "scope-violation", out


def test_an_archive_in_a_project_with_no_wiki_is_unaffected_AC_5(
    runner, workspace, fake_claude
):
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert out["ok"] is True, out
    assert out["terminalReason"] == "completed", out
    assert not (workspace["specs"] / "wiki").exists()



def test_an_archive_rewrites_a_page_covering_a_file_it_deleted_AC_1(
    runner, workspace, workspace_root, fake_claude
):
    """The rewrite drops the deleted file from the page's own list, so the
    page no longer names anything the spec changed once it is rewritten.
    What the page named before the rewrite is what lets it stay."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    project, specs = workspace["project"], workspace["specs"]
    (project / "gone.txt").write_text("gone\n")
    (project / "kept.txt").write_text("kept\n")
    git(project, "add", "-A")
    git(project, "commit", "-qm", "add two files")
    _write_wiki_page(workspace_root, specs, project, "r.md", ["gone.txt", "kept.txt"])
    git(specs, "add", "-A")
    git(specs, "commit", "-qm", "seed the wiki")
    git(project, "switch", "-q", "-c", ARCHIVE_BRANCH)
    git(project, "rm", "-q", "gone.txt")
    git(project, "commit", "-q", "-m", "implement")
    git(project, "switch", "-q", "main")
    wiki = _wiki_bin(workspace_root)
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "# R\\n\\nRewritten.\\n" | {wiki} write --specs-root "$specs" '
        + '--project-dir "$PWD" --page r.md --file kept.txt >/dev/null\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _, err = run(runner, workspace, claude, command="archive", return_stderr=True)
    assert out["terminalReason"] == "completed", out
    assert "Rewritten." in _wiki_page(workspace, ARCHIVE_BRANCH, "r.md")
    assert "wiki pages rewritten: r.md" in err


def test_a_page_an_earlier_archive_run_rewrote_is_not_this_runs_write(
    runner, workspace, workspace_root, fake_claude
):
    """597: the first archive landed the code and stopped on a conflict in
    the specs repo, leaving the page it had rightly rewritten on the specs
    branch alone. On the next run the code diff against main is empty, so
    no page is the spec's own, and that earlier rewrite read as this run
    writing a page it may not. A run answers for what it wrote itself."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    project, specs = workspace["project"], workspace["specs"]
    git(project, "merge", "-q", "--ff-only", branch)
    git(specs, "switch", "-q", "-c", branch)
    (specs / "wiki" / "p.md").write_text(_wiki_page(workspace, "main", "p.md") + "\nRewritten by the earlier run.\n")
    git(specs, "add", "-A")
    git(specs, "commit", "-qm", "an earlier archive run's wiki rewrite")
    git(specs, "switch", "-q", "main")
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert out["terminalReason"] == "completed", out.get("error")
    assert "Rewritten by the earlier run." in _wiki_page(workspace, branch, "p.md")
