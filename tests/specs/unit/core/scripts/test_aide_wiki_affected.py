"""aide-wiki affected: which generated pages a spec's own diff touches,
narrowed to the files of each that still exist."""
import subprocess

from .conftest import git, init_repo
# The fixtures are imported for pytest to find; the tests take them by name.
from .aide_wiki_support import (
    script,
    project,
    specs_repo,
    specs_root,
    call,
    write_page,
    commit_all,
    hand_written,
)


# --- `affected`: which pages a file set (a spec's own diff) touches ---------


def affected(script, specs_root, project):
    rc, out = call(script, "affected", "--specs-root", specs_root, "--project-dir", project)
    assert rc == 0, out
    return out


def test_affected_returns_a_page_whose_files_overlap_the_diff_since_merge_base_AC_1(
    script, specs_root, project
):
    write_page(script, specs_root, project, "p.md", ["x.txt"])
    git(project, "checkout", "-q", "-b", "feature")
    (project / "x.txt").write_text("changed\n")
    commit_all(project, "touch x")
    out = affected(script, specs_root, project)
    assert out["pages"] == [{"page": "p.md", "files": ["x.txt"]}]


def test_affected_omits_a_page_whose_files_do_not_overlap_AC_2(script, specs_root, project):
    write_page(script, specs_root, project, "p.md", ["y.txt"])
    git(project, "checkout", "-q", "-b", "feature")
    (project / "x.txt").write_text("changed\n")
    commit_all(project, "touch x")
    assert affected(script, specs_root, project)["pages"] == []


def test_affected_omits_a_hand_written_page_even_when_its_files_overlap_AC_3(
    script, specs_root, project
):
    hand_written(
        specs_root, "notes.md",
        "---\nfiles:\n  - x.txt\n---\n\n# Notes\n\nWritten by a person.\n",
    )
    git(project, "checkout", "-q", "-b", "feature")
    (project / "x.txt").write_text("changed\n")
    commit_all(project, "touch x")
    assert affected(script, specs_root, project)["pages"] == []


def test_affected_is_empty_when_the_branch_has_not_diverged_AC_4(script, specs_root, project):
    write_page(script, specs_root, project, "p.md", ["x.txt"])
    assert affected(script, specs_root, project)["pages"] == []


def test_affected_is_empty_for_a_project_with_no_wiki_AC_5(script, project, tmp_path):
    empty_specs = init_repo(tmp_path / "no-wiki-specs")
    assert affected(script, empty_specs, project)["pages"] == []


def test_affected_resolves_a_non_main_default_branch_via_origin_head(script, tmp_path, specs_root):
    """A repo whose default branch is not literally `main` still resolves
    the right merge-base — `default_branch_of`'s own fallback, mirroring
    run-spec-gates.sh's `default_branch()`."""
    bare = tmp_path / "origin.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "trunk", str(bare)], check=True)
    seed = init_repo(tmp_path / "seed")
    git(seed, "branch", "-m", "trunk")
    (seed / "x.txt").write_text("x\n")
    git(seed, "add", "-A")
    git(seed, "commit", "-qm", "seed x")
    git(seed, "push", "-q", str(bare), "trunk")
    project = tmp_path / "clone"
    subprocess.run(["git", "clone", "-q", str(bare), str(project)], check=True)
    subprocess.run(["git", "-C", str(project), "config", "user.name", "Test"], check=True)
    subprocess.run(["git", "-C", str(project), "config", "user.email", "test@example.com"], check=True)
    write_page(script, specs_root, project, "p.md", ["x.txt"])
    git(project, "checkout", "-q", "-b", "feature")
    (project / "x.txt").write_text("changed\n")
    commit_all(project, "touch x")
    assert affected(script, specs_root, project)["pages"] == [{"page": "p.md", "files": ["x.txt"]}]


def test_affected_drops_a_file_the_diff_deleted_but_keeps_the_pages_others_AC_1(
    script, specs_root, project
):
    """A page naming two files where the spec deletes one is still
    affected, but the deleted file is dropped from what `affected`
    hands back — `aide-wiki write` refuses any file no longer at HEAD,
    so passing it straight through would break the rewrite."""
    write_page(script, specs_root, project, "p.md", ["x.txt", "y.txt"])
    git(project, "checkout", "-q", "-b", "feature")
    (project / "x.txt").unlink()
    commit_all(project, "delete x")
    assert affected(script, specs_root, project)["pages"] == [{"page": "p.md", "files": ["y.txt"]}]


def test_affected_omits_a_page_whose_only_named_file_the_diff_deleted_AC_1(
    script, specs_root, project
):
    """A page with nothing left to rewrite it from is left out entirely,
    rather than handed to `aide-wiki write` with an empty --file list."""
    write_page(script, specs_root, project, "p.md", ["x.txt"])
    git(project, "checkout", "-q", "-b", "feature")
    (project / "x.txt").unlink()
    commit_all(project, "delete x")
    assert affected(script, specs_root, project)["pages"] == []


def test_write_accepts_the_file_list_affected_returns_after_a_deletion_AC_1(
    script, specs_root, project
):
    """End to end: the archive step passes `affected`'s own file list
    straight to `write`, which must not refuse it as unknown-file."""
    write_page(script, specs_root, project, "p.md", ["x.txt", "y.txt"])
    git(project, "checkout", "-q", "-b", "feature")
    (project / "x.txt").unlink()
    commit_all(project, "delete x")
    surviving = affected(script, specs_root, project)["pages"][0]["files"]
    rc, out = write_page(script, specs_root, project, "p.md", surviving, "# Title\n\nRewritten.\n")
    assert rc == 0, out
