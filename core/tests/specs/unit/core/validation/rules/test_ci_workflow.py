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


@pytest.mark.validation
class TestCiWorkflow:
    """The workflow must run the gates .claude/CLAUDE.md documents."""

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
        """AC-2: --help must sit above the shellcheck-installed probe, so
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

    def test_bun_version_matches_lockfile(self, workspace_root):
        """Criterion 5: the workflow's bun pin follows dashboard/bun.lock.

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
        """Criterion 7: pytest.ini's own deselection is the only one in force.

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
