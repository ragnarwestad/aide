"""An archive leaves the wiki alone: the refresh after its landing
rewrites the pages, on the default branch. A page the archive writes is
taken back like any other path outside its own folder."""

import json
import subprocess
from ...conftest import READ_SPECS, git, run
from ..run_spec_origins import origin
from ..run_spec_results import RESULT_OK
from ..run_spec_status_files import status_with_phase


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


def test_an_archive_that_rewrites_the_page_covering_its_own_change_is_taken_back(
    runner, workspace, workspace_root, fake_claude
):
    """Two archives rewriting the same page on their own branches conflicted
    on every landing after the first (619 and 622, 2026-10-09)."""
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    before = _wiki_page(workspace, "main", "p.md")
    wiki = _wiki_bin(workspace_root)
    claude = fake_claude(
        "cat > /dev/null\n"
        + READ_SPECS
        + f'printf "# P\\n\\nRewritten.\\n" | {wiki} write --specs-root "$specs" '
        + '--project-dir "$PWD" --page p.md --file x.txt >/dev/null\n'
        + f"echo '{json.dumps(RESULT_OK)}'"
    )
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert out["terminalReason"] == "scope-violation", out
    assert _wiki_page(workspace, branch, "p.md") == before


def test_an_archive_that_touches_no_wiki_page_completes(
    runner, workspace, workspace_root, fake_claude
):
    status_with_phase(workspace, "create, analyze, implement", ["| a | ✅ | |"])
    branch = _archive_wiki_workspace(workspace, workspace_root)
    before = {name: _wiki_page(workspace, "main", name) for name in ("p.md", "q.md", "notes.md")}
    claude = fake_claude("cat > /dev/null\n" f"echo '{json.dumps(RESULT_OK)}'")
    rc, out, _ = run(runner, workspace, claude, command="archive")
    assert rc == 0, out
    assert out["terminalReason"] == "completed", out
    for name, text in before.items():
        assert _wiki_page(workspace, branch, name) == text


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
