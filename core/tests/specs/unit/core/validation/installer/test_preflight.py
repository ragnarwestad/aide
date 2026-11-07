"""Behaviour tests for core/scripts/aide-preflight.

Installing blind was a whole class of silent misses: files copied for a
tool that is not there, or landing in a directory the tool never reads.
The preflight probes what is actually installed and reports where each
piece will land — it informs, it never blocks (exit 0 either way).
"""
import stat
import subprocess

import pytest

SYSTEM_PATH = "/usr/bin:/bin"


def _run(workspace_root, args, home, path=SYSTEM_PATH, env=None):
    script = workspace_root / "core" / "scripts" / "aide-preflight"
    return subprocess.run(
        [str(script), *args],
        capture_output=True,
        text=True,
        env={"PATH": path, "HOME": str(home), **(env or {})},
    )


def _fake_tool(directory, name, version):
    directory.mkdir(parents=True, exist_ok=True)
    tool = directory / name
    tool.write_text(f'#!/bin/sh\necho "{version}"\n')
    tool.chmod(tool.stat().st_mode | stat.S_IEXEC)


@pytest.mark.validation
class TestPreflight:
    """aide-preflight probes tools and reports target paths."""

    def test_missing_tool_reports_but_does_not_block(self, workspace_root, tmp_path):
        result = _run(workspace_root, ["claude"], home=tmp_path)
        assert result.returncode == 0, result.stderr
        assert "not found" in result.stdout
        assert ".claude/skills" in result.stdout, \
            "The report must say where the pieces will land"

    def test_found_tool_reports_its_version(self, workspace_root, tmp_path):
        bin_dir = tmp_path / "bin"
        _fake_tool(bin_dir, "claude", "9.9.9")
        result = _run(
            workspace_root, ["claude"], home=tmp_path,
            path=f"{bin_dir}:{SYSTEM_PATH}",
        )
        assert result.returncode == 0, result.stderr
        assert "9.9.9" in result.stdout

    def test_all_covers_every_tool(self, workspace_root, tmp_path):
        result = _run(workspace_root, ["all"], home=tmp_path)
        assert result.returncode == 0, result.stderr
        for piece in ("Claude Code", "Copilot", "Codex"):
            assert piece in result.stdout, f"'all' must cover {piece}"

    def test_default_is_all(self, workspace_root, tmp_path):
        result = _run(workspace_root, [], home=tmp_path)
        assert result.returncode == 0, result.stderr
        assert "Codex" in result.stdout

    def test_unknown_argument_fails(self, workspace_root, tmp_path):
        result = _run(workspace_root, ["gemini"], home=tmp_path)
        assert result.returncode != 0

    def test_copilot_report_explains_the_skill_path(self, workspace_root, tmp_path):
        """Copilot reads skills from ~/.claude/skills — the report must say so,
        or a user without Claude Code will think the skills are missing."""
        result = _run(workspace_root, ["copilot"], home=tmp_path)
        assert ".claude/skills" in result.stdout


@pytest.mark.validation
class TestPreflightIsWiredIn:
    """The preflight ships to ~/.local/bin and every installer runs it."""

    def test_every_installer_runs_preflight(self, workspace_root):
        """Every implementation, not a list of them: a new tool that
        skips the preflight is exactly what this has to catch."""
        root = workspace_root / "core" / "implementations"
        installers = sorted(d.name for d in root.iterdir() if (d / "install.sh").is_file())
        assert installers, "no core/implementations/<ai>/install.sh found at all"
        for ai in installers:
            install = root / ai / "install.sh"
            assert "aide-preflight" in install.read_text(), \
                f"{ai}/install.sh does not run the preflight"


@pytest.mark.validation
class TestPreflightDrift:
    """aide-preflight names when the installed ~/.local/bin copy is behind
    the repo it was installed from, via the version stamp
    install_common_bin writes."""

    @staticmethod
    def _write_stamp(home, repo_root, sha):
        stamp_dir = home / ".local" / "bin"
        stamp_dir.mkdir(parents=True, exist_ok=True)
        (stamp_dir / ".aide-installed-version").write_text(
            f"{repo_root}\n{sha}\n2026-09-01T00:00:00Z\n"
        )

    def test_reports_match_when_stamp_equals_head(self, workspace_root, tmp_path):
        head = subprocess.run(
            ["git", "-C", str(workspace_root), "rev-parse", "HEAD"],
            capture_output=True, text=True,
        ).stdout.strip()
        self._write_stamp(tmp_path, workspace_root, head)
        result = _run(workspace_root, ["claude"], home=tmp_path)
        assert result.returncode == 0, result.stderr
        assert "match" in result.stdout.lower(), result.stdout
        assert head in result.stdout, result.stdout

    def test_reports_behind_when_stamp_is_stale(self, workspace_root, tmp_path):
        fake_sha = "0000000000000000000000000000000000dead"
        self._write_stamp(tmp_path, workspace_root, fake_sha)
        result = _run(workspace_root, ["claude"], home=tmp_path)
        assert result.returncode == 0, result.stderr
        assert "behind" in result.stdout.lower(), result.stdout
        assert fake_sha in result.stdout, result.stdout

    def test_an_installer_run_does_not_warn_about_the_files_it_is_updating(self, workspace_root, tmp_path):
        """AIDE_INSTALLING=1 is what the installers set: a stale stamp
        is then the thing this very run fixes, and a ⚠️ for it fired
        the dashboard's install banner on every landing."""
        fake_sha = "0000000000000000000000000000000000dead"
        self._write_stamp(tmp_path, workspace_root, fake_sha)
        result = _run(workspace_root, ["claude"], home=tmp_path, env={"AIDE_INSTALLING": "1"})
        assert result.returncode == 0, result.stderr
        drift = [l for l in result.stdout.splitlines() if "behind" in l.lower()]
        assert drift, result.stdout
        assert all("⚠️" not in l for l in drift), drift

    def test_no_stamp_is_silent(self, workspace_root, tmp_path):
        result = _run(workspace_root, ["claude"], home=tmp_path)
        assert result.returncode == 0, result.stderr
        assert "match" not in result.stdout.lower()
        assert "behind" not in result.stdout.lower()


FACT_LINES = ("cli", "place", "files")


def _table_rows(workspace_root, ai):
    """The (place, to) rows install-targets.txt gives one tool."""
    rows = []
    for line in (workspace_root / "core" / "scripts" / "lib" / "install-targets.txt").read_text().splitlines():
        fields = line.split()
        if len(fields) == 4 and fields[0] == ai:
            rows.append((fields[1], fields[3]))
    return rows


def _facts(workspace_root, ai, home, **kwargs):
    result = _run(workspace_root, ["--facts", ai], home=home, **kwargs)
    return result, [line.split("\t") for line in result.stdout.splitlines()]


@pytest.mark.validation
class TestPreflightFacts:
    """aide-preflight --facts <tool> answers what the board needs as one
    fact per line, tab-separated: the CLI, each place, the installed files.
    It is the one place that decides each of them."""

    def test_a_cli_on_path_is_found(self, workspace_root, tmp_path):
        bin_dir = tmp_path / "bin"
        _fake_tool(bin_dir, "codex", "9.9.9")
        result, facts = _facts(workspace_root, "codex", tmp_path, path=f"{bin_dir}:{SYSTEM_PATH}")
        assert result.returncode == 0, result.stderr
        assert ["cli", "found"] in facts

    def test_a_cli_not_on_path_is_missing(self, workspace_root, tmp_path):
        result, facts = _facts(workspace_root, "codex", tmp_path)
        assert result.returncode == 0, result.stderr
        assert ["cli", "missing"] in facts

    def test_every_place_of_the_table_is_a_line_saying_whether_it_exists(self, workspace_root, tmp_path):
        (tmp_path / ".codex" / "hooks").mkdir(parents=True)
        result, facts = _facts(workspace_root, "codex", tmp_path)
        assert result.returncode == 0, result.stderr
        places = {f[1]: f for f in facts if f[0] == "place"}
        assert list(places) == [place for place, _ in _table_rows(workspace_root, "codex")]
        assert places["hooks"] == ["place", "hooks", "~/.codex/hooks/", "exists"]
        assert places["hookConfig"] == ["place", "hookConfig", "~/.codex/hooks.json", "missing"]

    def test_a_place_under_xdg_config_home_is_shown_where_it_is(self, workspace_root, tmp_path):
        xdg = tmp_path / "xdg"
        result, facts = _facts(workspace_root, "opencode", tmp_path, env={"XDG_CONFIG_HOME": str(xdg)})
        assert ["place", "instructions", f"{xdg}/opencode/AGENTS.md", "missing"] in facts

    def test_files_match_when_the_stamp_is_the_repos_head(self, workspace_root, tmp_path):
        head = subprocess.run(
            ["git", "-C", str(workspace_root), "rev-parse", "HEAD"], capture_output=True, text=True,
        ).stdout.strip()
        TestPreflightDrift._write_stamp(tmp_path, workspace_root, head)
        _, facts = _facts(workspace_root, "claude", tmp_path)
        assert ["files", "match"] in facts

    def test_files_are_behind_when_the_stamp_is_stale_installer_run_or_not(self, workspace_root, tmp_path):
        TestPreflightDrift._write_stamp(tmp_path, workspace_root, "0000000000000000000000000000000000dead")
        for env in (None, {"AIDE_INSTALLING": "1"}):
            _, facts = _facts(workspace_root, "claude", tmp_path, env=env)
            assert ["files", "behind"] in facts

    def test_files_are_unknown_without_a_stamp_or_with_a_repo_that_cannot_be_read(self, workspace_root, tmp_path):
        _, facts = _facts(workspace_root, "claude", tmp_path)
        assert ["files", "unknown"] in facts
        TestPreflightDrift._write_stamp(tmp_path, tmp_path / "no-such-repo", "abc123")
        _, facts = _facts(workspace_root, "claude", tmp_path)
        assert ["files", "unknown"] in facts

    def test_it_prints_no_banner_and_no_colour(self, workspace_root, tmp_path):
        result, facts = _facts(workspace_root, "claude", tmp_path)
        assert all(f[0] in FACT_LINES for f in facts), result.stdout
        assert "\033" not in result.stdout

    @pytest.mark.parametrize("args", [["--facts"], ["--facts", "all"], ["--facts", "gemini"]])
    def test_a_tool_it_does_not_know_exits_1_with_the_message_on_stderr(self, workspace_root, tmp_path, args):
        result = _run(workspace_root, args, home=tmp_path)
        assert result.returncode == 1
        assert result.stdout == ""
        assert result.stderr.strip()

    def test_the_terminal_mode_prints_no_fact_line(self, workspace_root, tmp_path):
        result = _run(workspace_root, ["codex"], home=tmp_path)
        assert not [l for l in result.stdout.splitlines() if l.split("\t")[0] in FACT_LINES and "\t" in l]
