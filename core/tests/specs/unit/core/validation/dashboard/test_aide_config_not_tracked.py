"""aide's own `.aide/config` is personal and stays out of git."""
import subprocess

import pytest


@pytest.mark.validation
class TestConfigIsNotTracked:
    """REQ-1, REQ-6: `.aide/config` is untracked in aide's own repo, and a
    test fails if that ever regresses."""

    def test_aide_config_is_not_tracked(self, workspace_root):
        out = subprocess.run(
            ["git", "-C", str(workspace_root), "ls-files", "--", ".aide/config"],
            capture_output=True, text=True, check=True,
        ).stdout
        assert out.strip() == "", (
            ".aide/config must not be tracked in aide's own repository (REQ-1/REQ-6)"
        )
