"""Tests for core/scripts/aide-install-spec-hook — the per-repo installer
for commit-msg-spec-guard (spec 219).

Same repo-path-list shape as aide-pull-specs, same test style: real git
repos built with subprocess, not mocked. This file is about INSTALL
MECHANICS — where the hook file ends up, that it survives a second run
unchanged, and that an operator's own commit-msg hook is never
clobbered. See test_commit_msg_spec_guard.py for the hook's own
rejection logic.
"""
import os
import subprocess

import pytest


@pytest.fixture
def installer(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-install-spec-hook"


def git(repo, *args, check=True):
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True, check=check,
    ).stdout.strip()


def init_repo(path):
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q", "-b", "main", str(path)], check=True)
    git(path, "config", "user.name", "Test")
    git(path, "config", "user.email", "test@example.com")
    (path / "README.md").write_text("start\n")
    git(path, "add", "README.md")
    git(path, "commit", "-qm", "init")
    return path


def run(installer, *paths):
    return subprocess.run(
        [str(installer), *[str(p) for p in paths]],
        capture_output=True, text=True,
    )


def test_no_arguments_refuses_with_a_usage_line(installer):
    result = subprocess.run([str(installer)], capture_output=True, text=True)

    assert result.returncode == 2
    assert "usage:" in result.stderr


def test_the_hook_is_installed_into_the_common_git_dir(installer, tmp_path):
    repo = init_repo(tmp_path / "specs")

    result = run(installer, repo)

    assert result.returncode == 0, result.stderr
    hook_path = repo / ".git" / "hooks" / "commit-msg"
    assert hook_path.is_file()
    assert hook_path.stat().st_mode & 0o111, "the hook is not executable"


def test_a_second_run_is_byte_identical(installer, tmp_path):
    repo = init_repo(tmp_path / "specs")
    run(installer, repo)
    hook_path = repo / ".git" / "hooks" / "commit-msg"
    first = hook_path.read_bytes()

    result = run(installer, repo)

    assert result.returncode == 0, result.stderr
    assert hook_path.read_bytes() == first


def test_a_foreign_hook_is_left_untouched(installer, tmp_path):
    repo = init_repo(tmp_path / "specs")
    hooks_dir = repo / ".git" / "hooks"
    hooks_dir.mkdir(parents=True, exist_ok=True)
    hook_path = hooks_dir / "commit-msg"
    original = "#!/bin/sh\n# an operator's own hook\nexit 0\n"
    hook_path.write_text(original)
    hook_path.chmod(0o755)

    result = run(installer, repo)

    assert hook_path.read_text() == original
    assert str(hook_path) in result.stderr or str(hook_path) in result.stdout


def test_installing_against_one_worktree_protects_every_worktree(installer, tmp_path):
    """AC6. Hooks live in the repo's COMMON git dir, shared by every
    `git worktree` — proving that means the guard fires in a SECOND
    worktree the installer was never pointed at directly."""
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True)
    main = tmp_path / "main"
    subprocess.run(["git", "clone", "-q", str(origin), str(main)], check=True)
    git(main, "config", "user.name", "Test")
    git(main, "config", "user.email", "test@example.com")
    (main / "README.md").write_text("start\n")
    git(main, "add", "README.md")
    git(main, "commit", "-qm", "init")
    git(main, "push", "-q", "origin", "main")

    other = tmp_path / "other-worktree"
    git(main, "worktree", "add", "-q", "-b", "feature", str(other))

    result = run(installer, main)
    assert result.returncode == 0, result.stderr

    spec_file = other / "55-example" / "2-analysis.md"
    spec_file.parent.mkdir(parents=True, exist_ok=True)
    spec_file.write_text("content\n")
    git(other, "add", "55-example/2-analysis.md")
    commit_result = subprocess.run(
        ["git", "-C", str(other), "commit", "-qm", "Copied from another spec"],
        capture_output=True, text=True,
    )

    assert commit_result.returncode != 0


def test_a_repo_that_has_never_had_the_hook_installed_commits_unconditionally(tmp_path):
    """AC5. The hook is opt-in per repo — a repo the installer never
    touched has no guard at all, whatever the message."""
    repo = init_repo(tmp_path / "specs")
    spec_file = repo / "55-example" / "2-analysis.md"
    spec_file.parent.mkdir(parents=True, exist_ok=True)
    spec_file.write_text("content\n")
    git(repo, "add", "55-example/2-analysis.md")

    result = subprocess.run(
        ["git", "-C", str(repo), "commit", "-qm", "Copied from another spec"],
        capture_output=True, text=True,
    )

    assert result.returncode == 0, result.stderr


def test_no_such_directory_is_skipped_not_fatal(installer, tmp_path):
    result = run(installer, tmp_path / "nowhere")

    assert result.returncode == 0
    assert "no such directory" in result.stderr


def test_something_that_is_not_a_repo_is_skipped_not_fatal(installer, tmp_path):
    plain = tmp_path / "plain"
    plain.mkdir()

    result = run(installer, plain)

    assert result.returncode == 0
    assert "not a git working tree" in result.stderr


def test_the_script_is_installed_with_the_other_shared_scripts(workspace_root):
    """The one list of shared scripts (`_install-bin.sh`). A script that
    is not on it is never copied to ~/.local/bin."""
    installer_sh = (workspace_root / "core" / "scripts" / "_install-bin.sh").read_text()

    assert "aide-install-spec-hook" in installer_sh


def test_the_hook_body_is_installed_alongside_it(workspace_root, tmp_path):
    """Without this, an installed ~/.local/bin/aide-install-spec-hook
    cannot find its own hook source — install_common_bin only copies
    flat files, and the hook body lives in core/scripts/hooks/."""
    installer_sh = workspace_root / "core" / "scripts" / "_install-bin.sh"
    env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
    result = subprocess.run(
        ["bash", "-c", f'source "{installer_sh}"; install_common_bin'],
        capture_output=True, text=True, env=env,
    )

    assert result.returncode == 0, result.stderr
    hook_body = tmp_path / ".local" / "bin" / "hooks" / "commit-msg-spec-guard"
    assert hook_body.is_file()
    assert hook_body.stat().st_mode & 0o111


def test_the_installed_installer_can_find_its_own_hook_body(workspace_root, tmp_path):
    """End-to-end: install into a throwaway HOME the way a real machine
    would, then run the INSTALLED script (not the repo copy) against a
    repo and confirm it actually installs a working hook."""
    installer_sh = workspace_root / "core" / "scripts" / "_install-bin.sh"
    home = tmp_path / "home"
    env = {"PATH": os.environ["PATH"], "HOME": str(home)}
    subprocess.run(
        ["bash", "-c", f'source "{installer_sh}"; install_common_bin'],
        capture_output=True, text=True, env=env, check=True,
    )
    installed = home / ".local" / "bin" / "aide-install-spec-hook"
    repo = init_repo(tmp_path / "specs")

    result = subprocess.run(
        [str(installed), str(repo)], capture_output=True, text=True,
    )

    assert result.returncode == 0, result.stderr
    assert (repo / ".git" / "hooks" / "commit-msg").is_file()
