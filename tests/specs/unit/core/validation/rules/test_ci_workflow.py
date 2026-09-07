"""Validation tests for the CI workflow.

The workflow is read as text, not parsed as YAML: nothing else in this
suite imports a YAML library, and CI installs only what requirements.txt
names.

What these tests hold onto is the pairing, not the shape of the file: the
workflow's gate commands against the ones .claude/CLAUDE.md documents, and
its bun-version against the version dashboard/bun.lock resolves. Those are
the two places a silent drift can start.
"""
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

    def test_all_jobs_run_on_macos(self, workspace_root):
        """Criterion 1: five jobs, every one of them on macOS.

        BSD sed and bash 3.2 are what the shell scripts are written for; a
        Linux runner would go green while exercising different code.
        """
        jobs = _jobs(_workflow_text(workspace_root))
        assert len(jobs) == 5, \
            f"Expected one job per gate, found {sorted(jobs)}"
        for name, body in jobs.items():
            runners = re.findall(r"^\s*runs-on:\s*(\S+)", body, re.MULTILINE)
            assert runners, f"Job '{name}' declares no runs-on"
            for runner in runners:
                assert runner.strip("'\"").startswith("macos"), \
                    f"Job '{name}' runs on {runner}, not a macOS runner"

    def test_pytest_job_runs_venv_pytest(self, workspace_root):
        """Criterion 2: the root gate is the exact command CLAUDE.md names."""
        jobs = _jobs(_workflow_text(workspace_root))
        assert "pytest" in jobs, f"No 'pytest' job, found {sorted(jobs)}"
        commands = "\n".join(_run_commands(jobs["pytest"]))
        assert re.search(r"(?<![\w/.-])\.venv/bin/pytest(?![\w/.-])", commands), \
            "The pytest job never runs the exact command .venv/bin/pytest"

    def test_dashboard_job_runs_make_test(self, workspace_root):
        """Criterion 3: make test, so tsc --noEmit runs before bun test."""
        jobs = _jobs(_workflow_text(workspace_root))
        assert "dashboard" in jobs, f"No 'dashboard' job, found {sorted(jobs)}"
        commands = "\n".join(_run_commands(jobs["dashboard"]))
        assert "cd dashboard && make test" in commands, \
            "The dashboard job must run 'cd dashboard && make test' — " \
            "'bun test' alone transpiles without type-checking"

    def test_markdownlint_job_runs_correct_command(self, workspace_root):
        """Criterion 4: markdownlint from the root, where its config lives."""
        jobs = _jobs(_workflow_text(workspace_root))
        assert "markdownlint" in jobs, \
            f"No 'markdownlint' job, found {sorted(jobs)}"
        commands = "\n".join(_run_commands(jobs["markdownlint"]))
        assert "npx markdownlint-cli2 '**/*.md'" in commands, \
            "The markdownlint job never runs the documented command"

    def test_shellcheck_job_runs_correct_command(self, workspace_root):
        """Criterion 9: shellcheck runs over every bash script in
        core/scripts, not just aide-run-spec and its lib/ files."""
        jobs = _jobs(_workflow_text(workspace_root))
        assert "shellcheck" in jobs, f"No 'shellcheck' job, found {sorted(jobs)}"
        commands = "\n".join(_run_commands(jobs["shellcheck"]))
        assert commands.strip().startswith("shellcheck "), \
            "The shellcheck job never runs shellcheck"
        for target in (
            "core/scripts/aide-*",
            "core/scripts/_*.sh",
            "core/scripts/build-agents-md.sh",
            "core/scripts/upgrade-ai-tools",
            "core/scripts/validate-env",
            "core/scripts/lib/*.sh",
        ):
            assert target in commands, \
                f"The shellcheck job's command never names {target}"

    def test_biome_job_runs_lint_only(self, workspace_root):
        """Criterion 10: lint alone, not check/format — this codebase was
        never run through biome's formatter, and a gate on its existing
        line-wrapping would fail on style nobody asked about."""
        jobs = _jobs(_workflow_text(workspace_root))
        assert "biome" in jobs, f"No 'biome' job, found {sorted(jobs)}"
        commands = "\n".join(_run_commands(jobs["biome"]))
        assert "@biomejs/biome lint src/" in commands, \
            "The biome job must run biome's lint command over dashboard/src"
        assert "biome check" not in commands and "biome format" not in commands, \
            "The biome job must not run check or format — lint only"

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

    def test_requirements_pins_pytest_exactly(self, workspace_root):
        """Criterion 6: an exact pin, not a bare name and not a range."""
        path = workspace_root / "requirements.txt"
        assert path.exists(), \
            "No requirements.txt — CI has nothing to install pytest from"
        assert re.search(r"^pytest==\d+(\.\d+)+$", path.read_text(), re.MULTILINE), \
            "requirements.txt must pin pytest exactly (pytest==X.Y.Z)"

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

    def test_concurrency_and_timeouts_present(self, workspace_root):
        """Criterion 8: superseded runs are cancelled, wedged jobs fail fast."""
        text = _workflow_text(workspace_root)
        concurrency = re.search(
            r"^concurrency:\n((?:[ \t]+.*\n)+)", text, re.MULTILINE
        )
        assert concurrency, "The workflow declares no top-level concurrency block"
        assert "cancel-in-progress: true" in concurrency.group(1), \
            "The concurrency block does not cancel superseded runs"

        for name, body in _jobs(text).items():
            assert re.search(r"^\s*timeout-minutes:\s*\d+", body, re.MULTILINE), \
                f"Job '{name}' has no timeout-minutes — a wedged run would " \
                "hold a macOS runner for the default six hours"
