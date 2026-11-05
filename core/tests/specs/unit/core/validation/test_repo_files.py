"""The checks that read the repository's own files see a file the moment it
is written, not only once it is committed: a step's tests run before the
runner commits its work, so a new file that only `git ls-files` would list
reaches the landing unchecked."""
import subprocess

from .repo_files import repo_files


def _git(root, *args):
    subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True)


def _repo(tmp_path):
    _git(tmp_path, "init", "-q")
    (tmp_path / ".gitignore").write_text("ignored.ts\n")
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "kept.ts").write_text("kept\n")
    (tmp_path / "src" / "gone.ts").write_text("gone\n")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init")
    return tmp_path


def test_a_new_file_not_yet_committed_is_listed(tmp_path):
    root = _repo(tmp_path)
    (root / "src" / "new.ts").write_text("new\n")
    assert "src/new.ts" in repo_files(root)


def test_an_ignored_file_and_a_deleted_one_are_not(tmp_path):
    root = _repo(tmp_path)
    (root / "src" / "ignored.ts").write_text("ignored\n")
    (root / "src" / "gone.ts").unlink()
    assert repo_files(root) == [".gitignore", "src/kept.ts"]


def test_the_listing_can_be_limited_to_folders(tmp_path):
    root = _repo(tmp_path)
    (root / "other.ts").write_text("other\n")
    assert repo_files(root, "src") == ["src/gone.ts", "src/kept.ts"]
