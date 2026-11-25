"""What the installer tests for each tool share: running an installer
script with only the system PATH and a HOME of the test's own."""
import subprocess

import pytest

SYSTEM_PATH = "/usr/bin:/bin"


@pytest.fixture
def run_installer(workspace_root):
    """Runs `script_path` (relative to the repo root) with `home` as HOME,
    feeding it `stdin` when given and nothing otherwise."""
    def run(script_path, home, stdin=None):
        return subprocess.run(
            [str(workspace_root / script_path)],
            input=stdin,
            capture_output=True,
            text=True,
            env={"PATH": SYSTEM_PATH, "HOME": str(home)},
            stdin=subprocess.DEVNULL if stdin is None else None,
            timeout=120,
        )
    return run
