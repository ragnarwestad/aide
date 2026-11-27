"""E2E: Copilot, installed by Aide but running no spec step on the board
(core/scripts/lib/runnable-tools.json), sees the skills Aide installs for
it, and a shell command it starts inherits the job's environment.

The skill check reads `copilot skill list` and makes no model call; the
environment check is a real, billed call. Both are deselected by
pytest.ini, run with `-m e2e`.
"""
import os
import subprocess
from pathlib import Path

import pytest

from .conftest import available, mise_path

# Where the Copilot installer puts Aide's skills, and the list of what it
# put there (core/scripts/_install-skills.sh).
PERSONAL_SKILLS = Path.home() / ".agents" / "skills"
INSTALLED_MANIFEST = PERSONAL_SKILLS / ".aide-installed-manifest"


def _personal_skills(listing: str) -> set[str]:
    """The skill names under `Personal skills:` in `copilot skill list`."""
    names, inside = set(), False
    for line in listing.splitlines():
        if line.endswith("skills:") and not line.startswith(" "):
            inside = line == "Personal skills:"
        elif inside and line.startswith("  ") and " - " in line:
            names.add(line.strip().split(" - ", 1)[0])
    return names


@pytest.mark.e2e
@pytest.mark.copilot
@pytest.mark.slow
@pytest.mark.skipif(not available("copilot"), reason="Copilot CLI not installed")
def test_copilot_lists_the_installed_aide_skills(tmp_path):
    """Every skill the installer put in ~/.agents/skills is one Copilot
    lists as a personal skill. Run outside any project, so no project's
    own skills are mixed in."""
    assert INSTALLED_MANIFEST.exists(), \
        f"{INSTALLED_MANIFEST} is missing: Aide is not installed for Copilot (./install-all.sh)"
    installed = {n for n in INSTALLED_MANIFEST.read_text().split() if n}
    assert installed, f"{INSTALLED_MANIFEST} lists no skills"

    result = subprocess.run(
        ["copilot", "skill", "list"], capture_output=True, text=True, timeout=60,
        cwd=str(tmp_path), env={**os.environ, "PATH": mise_path()},
    )

    assert result.returncode == 0, f"copilot skill list failed: {result.stderr}"
    missing = installed - _personal_skills(result.stdout)
    assert not missing, f"Copilot does not list these installed skills: {sorted(missing)}\n{result.stdout}"


ENV_MARKER = "AIDE_E2E_ENV_MARKER"


@pytest.mark.e2e
@pytest.mark.copilot
@pytest.mark.slow
@pytest.mark.skipif(not available("copilot"), reason="Copilot CLI not installed")
def test_child_process_inherits_the_job_environment_ac_1(e2e_env):
    """A shell command Copilot starts sees the variables the job sets:
    a harmless marker and AIDE_INSTALLATION_PATH, with the values given."""
    workspace, _specs, env = e2e_env
    marker = "aide-e2e-marker-7f3c"
    env = {**env, ENV_MARKER: marker}
    seen = workspace / "env-seen.txt"
    command = f'printf "%s\\n%s\\n" "${ENV_MARKER}" "$AIDE_INSTALLATION_PATH" > {seen.name}'

    result = subprocess.run(
        ["copilot", "-p", f"Run exactly this shell command and nothing else: {command}",
         "--allow-tool", "shell(printf)"],
        capture_output=True, text=True, timeout=180, cwd=str(workspace), env=env,
    )

    assert result.returncode == 0, f"copilot failed: {result.stderr}"
    assert seen.exists(), f"the shell command did not write {seen.name}: {result.stdout}"
    assert seen.read_text().splitlines() == [marker, env["AIDE_INSTALLATION_PATH"]]
