"""The file command runs only named files and refuses unknown input."""

import subprocess


def test_it_refuses_no_file_and_an_unsupported_file_ac_3(workspace_root):
    script = workspace_root / "scripts" / "test-files"
    assert subprocess.run([script], capture_output=True, text=True).returncode == 2
    assert subprocess.run([script, "README.md"], capture_output=True, text=True).returncode == 2


def test_it_refuses_a_missing_test_file_ac_3(workspace_root):
    script = workspace_root / "scripts" / "test-files"
    result = subprocess.run([script, "missing_test.py"], capture_output=True, text=True)
    assert result.returncode == 2
    assert "no such test file" in result.stderr
