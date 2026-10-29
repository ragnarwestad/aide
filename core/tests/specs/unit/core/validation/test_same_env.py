"""The suite sees the same environment wherever it is started (core/tests/same_env.py)."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

from .....same_env import same_env


def test_the_callers_own_variables_are_dropped_and_the_rest_kept():
    env = {"AIDE_CHECKOUT_ROOT": "/board/checkouts", "AIDE_RUN_URL": "http://127.0.0.1:8788",
           "CLAUDECODE": "1", "CLAUDE_CODE_SESSION_ID": "s", "GIT_DIR": "/elsewhere/.git",
           "HOME": "/Users/me", "LANG": "C", "PATH": "/usr/bin"}
    assert same_env(env, []) == {"HOME": "/Users/me", "LANG": "C", "PATH": "/usr/bin"}


def test_a_mise_shims_directory_on_path_becomes_the_directories_it_points_to():
    env = {"PATH": "/home/me/.local/share/mise/shims:/opt/homebrew/bin:/usr/bin"}
    tools = ["/home/me/.local/share/mise/installs/jq/latest"]
    assert same_env(env, tools)["PATH"] == \
        "/home/me/.local/share/mise/installs/jq/latest:/opt/homebrew/bin:/usr/bin"


def test_the_shims_stay_when_mise_cannot_say_where_they_point():
    env = {"PATH": "/home/me/.local/share/mise/shims:/usr/bin"}
    assert same_env(env, [])["PATH"] == env["PATH"]


def test_a_suite_started_by_the_board_does_not_see_its_variables():
    if os.environ.get("SAME_ENV_PROBE") != "1":
        return
    assert "AIDE_RUN_URL" not in os.environ
    assert "CLAUDECODE" not in os.environ
    if shutil.which("mise"):
        assert not any(Path(e).name == "shims" for e in os.environ["PATH"].split(":"))


def test_the_suite_cleans_its_environment_before_the_first_test():
    root = Path(__file__).resolve().parents[6]
    env = {**os.environ, "SAME_ENV_PROBE": "1", "AIDE_RUN_URL": "http://127.0.0.1:1",
           "CLAUDECODE": "1",
           "PATH": f"{Path.home()}/.local/share/mise/shims:{os.environ['PATH']}"}
    r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-n0", "-p", "no:cacheprovider",
                        f"{Path(__file__)}::test_a_suite_started_by_the_board_does_not_see_its_variables"],
                       cwd=root, env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout[-2000:]
