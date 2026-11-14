"""The CI workflow and scripts/check-bash: the bun pin follows the
lockfile, the pytest job keeps pytest.ini's deselection of the billed
suites, and check-bash behaves without shellcheck installed.

The workflow is read as text, not parsed as YAML: CI installs only what
requirements.txt names."""
import re

import pytest

# Steps a job may declare between "jobs:" and the next job. Job keys sit at
# exactly two spaces of indent under "jobs:", everything belonging to a job
# is indented deeper.
JOB_KEY = re.compile(r"^  ([A-Za-z0-9_-]+):\s*$")


def _workflow_text(workspace_root):
    path = workspace_root / ".github" / "workflows" / "ci.yml"
    assert path.exists(), \
        "No CI workflow at .github/workflows/ci.yml — the checks run only " \
        "when a person remembers to run them"
    return path.read_text()


def _jobs(text):
    """Split the workflow into {job name: the job's own block of text}."""
    lines = text.splitlines()
    start = next(
        (i for i, line in enumerate(lines) if line.rstrip() == "jobs:"), None
    )
    assert start is not None, "The workflow has no top-level 'jobs:' key"

    jobs = {}
    current = None
    for line in lines[start + 1:]:
        if line.strip() and not line.startswith(" "):
            break  # back to a top-level key — the jobs section is over
        match = JOB_KEY.match(line)
        if match:
            current = match.group(1)
            jobs[current] = []
        elif current is not None:
            jobs[current].append(line)
    return {name: "\n".join(body) for name, body in jobs.items()}


def _run_commands(job_text):
    """Every shell command the job runs, one string per step.

    Handles both `run: <command>` and a `run: |` block scalar, so a later
    rewrite into block form cannot quietly empty out these assertions.
    """
    commands = []
    lines = job_text.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index]
        match = re.match(r"^(\s*)-?\s*run:\s*(.*)$", line)
        if not match:
            index += 1
            continue
        indent, inline = match.group(1), match.group(2).strip()
        if inline in ("|", ">", "|-", ">-"):
            body = []
            index += 1
            while index < len(lines):
                following = lines[index]
                if following.strip() and len(following) - len(
                    following.lstrip()
                ) <= len(indent):
                    break
                body.append(following.strip())
                index += 1
            commands.append("\n".join(body))
            continue
        commands.append(inline)
        index += 1
    return commands


def _git(repo, *args):
    import subprocess
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)


def _run_check_bash(root):
    """scripts/check-bash under `root`, with a shellcheck that records the
    files it is given, one per line: the run, and those files."""
    import os
    import subprocess
    record = root.parent / f"{root.name}-shellcheck-args"
    stub = ('() { for a in "$@"; do case "$a" in -*) ;; *) echo "$a" >> '
            f'"{record}" ;; esac; done; }}')
    result = subprocess.run(
        ["bash", str(root / "scripts" / "check-bash")],
        env={**os.environ, "BASH_FUNC_shellcheck%%": stub,
             "GIT_CEILING_DIRECTORIES": str(root.parent)},
        capture_output=True, text=True,
    )
    given = record.read_text().splitlines() if record.exists() else []
    return result, given


@pytest.mark.validation
class TestCiWorkflow:
    """The workflow must run the gates AGENTS.md documents."""

    def test_check_bash_says_how_to_install_shellcheck(self, workspace_root):
        """Without shellcheck on PATH the script refuses with the install
        command, rather than failing on 'command not found'."""
        import os
        import subprocess
        result = subprocess.run(
            [str(workspace_root / "scripts" / "check-bash")],
            env={**os.environ, "PATH": "/usr/bin:/bin"},
            capture_output=True, text=True,
        )
        assert result.returncode == 2, \
            f"Expected exit 2 without shellcheck, got {result.returncode}"
        assert "brew install shellcheck" in result.stderr, \
            f"The refusal never says how to install it: {result.stderr!r}"

    def test_check_bash_help_works_without_shellcheck_installed(self, workspace_root):
        """--help must sit above the shellcheck-installed probe, so
        it never depends on shellcheck being on PATH at all."""
        import os
        import subprocess
        result = subprocess.run(
            [str(workspace_root / "scripts" / "check-bash"), "--help"],
            env={**os.environ, "PATH": "/usr/bin:/bin"},
            capture_output=True, text=True,
        )
        assert result.returncode == 0, \
            f"Expected exit 0 for --help, got {result.returncode}: {result.stderr}"
        assert "usage" in result.stdout.lower(), result.stdout

    def test_check_bash_checks_every_tracked_bash_script_and_nothing_else_AC_4(
            self, workspace_root, tmp_path):
        """A tracked *.sh, and a tracked file with no suffix whose shebang
        runs bash, at any depth; never a Python script or an untracked file."""
        repo = tmp_path / "repo"
        (repo / "scripts").mkdir(parents=True)
        (repo / "tools").mkdir()
        (repo / "deep" / "x").mkdir(parents=True)
        (repo / "scripts" / "check-bash").write_text(
            (workspace_root / "scripts" / "check-bash").read_text())
        (repo / "a.sh").write_text("echo a\n")
        (repo / "tools" / "run").write_text("#!/usr/bin/env bash\necho run\n")
        (repo / "deep" / "x" / "hook").write_text("#!/bin/bash\necho hook\n")
        (repo / "tool.py").write_text("#!/usr/bin/env python3\nprint(1)\n")
        _git(repo, "init", "-q")
        _git(repo, "add", "-A")
        (repo / "loose.sh").write_text("echo loose\n")

        result, given = _run_check_bash(repo)

        assert result.returncode == 0, result.stderr
        assert sorted(given) == sorted(
            ["a.sh", "scripts/check-bash", "tools/run", "deep/x/hook"])

    def test_check_bash_outside_a_git_checkout_says_it_finds_scripts_through_git_AC_4(
            self, workspace_root, tmp_path):
        copy = tmp_path / "loose"
        (copy / "scripts").mkdir(parents=True)
        (copy / "scripts" / "check-bash").write_text(
            (workspace_root / "scripts" / "check-bash").read_text())

        result, given = _run_check_bash(copy)

        assert result.returncode == 2
        assert "through git" in result.stderr
        assert given == []

    def test_bun_version_matches_lockfile(self, workspace_root):
        """The workflow's bun pin follows dashboard/bun.lock.

        Bun publishes @types/bun in lockstep with each bun release, so the
        version the lockfile resolved is the bun version.
        """
        lock = (workspace_root / "dashboard" / "bun.lock").read_text()
        resolved = re.search(r'"@types/bun@([\d.]+)"', lock)
        assert resolved, "dashboard/bun.lock resolves no @types/bun version"

        pinned = re.search(
            r"bun-version:\s*['\"]?([\d.]+)", _workflow_text(workspace_root)
        )
        assert pinned, "The dashboard job pins no bun-version"
        assert pinned.group(1) == resolved.group(1), \
            f"The workflow pins bun {pinned.group(1)} but dashboard/bun.lock " \
            f"resolves {resolved.group(1)}"

    def test_pytest_job_has_no_marker_override(self, workspace_root):
        """Pytest.ini's own deselection is the only one in force.

        e2e and evaluation call AI APIs and cost money. Scoped to the
        invocation line: the venv-creation step, python -m venv .venv, also
        contains '-m ' and is not what this means.
        """
        jobs = _jobs(_workflow_text(workspace_root))
        commands = _run_commands(jobs["pytest"])
        invocations = [
            line
            for command in commands
            for line in command.splitlines()
            if re.search(r"(?<![\w/.-])\.venv/bin/pytest(?![\w/.-])", line)
        ]
        assert invocations, "The pytest job never invokes .venv/bin/pytest"
        for line in invocations:
            assert "-m " not in line, \
                f"'{line.strip()}' overrides pytest.ini's marker deselection " \
                "— e2e and evaluation would run and be billed"
            assert "--override-ini" not in line, \
                f"'{line.strip()}' overrides pytest.ini"
