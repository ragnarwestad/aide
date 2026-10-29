"""The environment the suite runs in, made the same wherever it is started.

The suite runs in a session on a laptop, in a step the board starts, and
in the board's landing, and each hands it a different environment: the
board gives every step its own `AIDE_*` paths and a URL to report runs
to, a session adds the AI tool's `CLAUDE*` variables, and Aide's test
command puts mise's shims first on PATH. A shim reads mise's settings
under HOME and refuses to run under the HOME a test makes up, so the same
tool ran on one machine and not on the other.

Every inherited `AIDE_*`, `CLAUDE*` and `GIT_*` variable is dropped, and
each mise shims directory on PATH is replaced by the directories the
shims point to, so a test that passes in one place passes in the others.
`dashboard/test/helpers/preload/same-env.ts` does the same for bun.
"""
import subprocess
from pathlib import Path

DROPPED_PREFIXES = ("AIDE_", "CLAUDE", "GIT_")


def is_shims_dir(entry: str) -> bool:
    path = Path(entry)
    return path.name == "shims" and path.parent.name == "mise"


def same_env(env: dict, tool_dirs: list) -> dict:
    """`env` without the caller's own variables, with every mise shims
    directory on PATH replaced by `tool_dirs`."""
    out = {k: v for k, v in env.items() if not k.startswith(DROPPED_PREFIXES)}
    if "PATH" in env:
        path = []
        for entry in env["PATH"].split(":"):
            path.extend(tool_dirs if is_shims_dir(entry) and tool_dirs else [entry])
        out["PATH"] = ":".join(path)
    return out


def mise_tool_dirs(env: dict) -> list:
    """The directories mise's shims point to, or none when mise cannot say."""
    if not any(is_shims_dir(e) for e in env.get("PATH", "").split(":")):
        return []
    try:
        out = subprocess.run(["mise", "bin-paths"], capture_output=True, text=True,
                             env=env, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return []
    return out.stdout.split() if out.returncode == 0 else []
