"""core/scripts/lib/install-targets.txt is the one table of where aide
installs for each AI. The preflight prints its places from it and the
Settings tab names them from it; these tests hold the installers to it and
prove the preflight follows it.
"""
import shutil
import subprocess

import pytest

SYSTEM_PATH = "/usr/bin:/bin"

# The table's name for an AI, and the folder its installer lives in.
INSTALLERS = {
    "claude": "claude-code",
    "codex": "codex",
    "copilot": "copilot",
    "opencode": "opencode",
}


def _table(workspace_root):
    return workspace_root / "core" / "scripts" / "lib" / "install-targets.txt"


def _rows(workspace_root, ai):
    """The table's rows for one AI, as (place, from, to)."""
    rows = []
    for line in _table(workspace_root).read_text().splitlines():
        fields = line.split()
        if not fields or fields[0].startswith("#"):
            continue
        tool, place, source, to = fields
        if tool == ai:
            rows.append((place, source, to))
    return rows


def _at_home(to, home):
    assert to.startswith("~/"), f"{to} is not under the home directory"
    return home / to[2:]


def _preflight(script, ai, home, env=None):
    return subprocess.run(
        [str(script), ai],
        capture_output=True,
        text=True,
        env={"PATH": SYSTEM_PATH, "HOME": str(home), **(env or {})},
    )


@pytest.mark.validation
class TestInstallersMatchTheTable:
    """An installer whose destination moves fails here until the table moves too."""

    @pytest.mark.parametrize("ai", sorted(INSTALLERS))
    def test_every_place_the_table_names_exists_after_an_install_AC_4(self, workspace_root, tmp_path, ai):
        rows = [row for row in _rows(workspace_root, ai) if row[1] != "-"]
        assert rows, f"the table names no place aide installs for {ai}"
        result = subprocess.run(
            [str(workspace_root / "implementations" / INSTALLERS[ai] / "install.sh")],
            capture_output=True,
            text=True,
            env={"PATH": SYSTEM_PATH, "HOME": str(tmp_path)},
            stdin=subprocess.DEVNULL,
            timeout=180,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        for place, source, to in rows:
            assert (workspace_root / source).exists(), f"{ai} {place}: {source} is not in the repository"
            assert _at_home(to, tmp_path).exists(), \
                f"{ai}/install.sh did not put {place} at {to}"


@pytest.mark.validation
class TestPreflightReadsTheTable:
    """The check prints the places the table names, and follows a change to it."""

    @pytest.mark.parametrize("ai", sorted(INSTALLERS))
    def test_prints_every_place_of_the_ai_AC_4(self, workspace_root, tmp_path, ai):
        script = workspace_root / "core" / "scripts" / "aide-preflight"
        result = _preflight(script, ai, tmp_path)
        assert result.returncode == 0, result.stderr
        for _place, _source, to in _rows(workspace_root, ai):
            assert to in result.stdout, f"the preflight for {ai} does not name {to}"

    def test_a_changed_table_changes_what_it_prints_AC_4(self, workspace_root, tmp_path):
        bin_dir = tmp_path / "bin"
        (bin_dir / "lib").mkdir(parents=True)
        shutil.copy(workspace_root / "core" / "scripts" / "aide-preflight", bin_dir / "aide-preflight")
        (bin_dir / "lib" / "install-targets.txt").write_text(
            "# a table naming another place\n"
            "claude  skills  core/skills/  ~/.elsewhere/skills/\n"
        )
        result = _preflight(bin_dir / "aide-preflight", "claude", tmp_path)
        assert result.returncode == 0, result.stderr
        assert "~/.elsewhere/skills/" in result.stdout, result.stdout
        assert "~/.claude/skills/" not in result.stdout, result.stdout

    def test_names_opencode_instructions_under_xdg_config_home_AC_4(self, workspace_root, tmp_path):
        script = workspace_root / "core" / "scripts" / "aide-preflight"
        xdg = tmp_path / "xdg"
        result = _preflight(script, "opencode", tmp_path, env={"XDG_CONFIG_HOME": str(xdg)})
        assert result.returncode == 0, result.stderr
        assert str(xdg / "opencode" / "AGENTS.md") in result.stdout, result.stdout
