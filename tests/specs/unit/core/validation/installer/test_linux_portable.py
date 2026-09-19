"""The installed scripts run on Linux as well as macOS: no command form
that only BSD tools (or only macOS) accept.

Each of these stopped Aide on a clean Debian (scripts/test-linux-install)
while passing on every Mac. dashboard/deploy/ is left out: it installs the
launchd service and is macOS-only by design.
"""
import re
from pathlib import Path

import pytest

MACOS_ONLY = {
    "sed -i '' (GNU sed reads '' as a file name; use sed -i.bak and remove the .bak)":
        re.compile(r"""sed\s+-i\s*(''|"")"""),
    "mktemp -t NAME (GNU mktemp needs XXXXXX in the name; use mktemp \"${TMPDIR:-/tmp}/NAME.XXXXXX\")":
        re.compile(r"mktemp\s+-t\s+[\w.-]+\s*\)"),
    "bc (not installed on a minimal Linux; use bash arithmetic)":
        re.compile(r"\|\s*bc\b"),
    "date -j / date -v (BSD date only)":
        re.compile(r"\bdate\s+(-j|-v[+-])"),
    "stat -f (BSD stat only; GNU stat takes -c)":
        re.compile(r"\bstat\s+-f\s"),
    "base64 -D (BSD only; -d works on both)":
        re.compile(r"\bbase64\s+-D\b"),
}


def _is_shell(path: Path) -> bool:
    if path.suffix == ".sh":
        return True
    try:
        first = path.open("rb").readline()
    except OSError:
        return False
    return first.startswith(b"#!") and b"sh" in first


def _installed_scripts(root: Path):
    paths = [root / "install-all.sh", root / "uninstall-all.sh"]
    for base in (root / "core" / "scripts", root / "core" / "skills", root / "implementations"):
        paths += [p for p in base.rglob("*") if p.is_file() and _is_shell(p)]
    return sorted(set(p for p in paths if p.exists()))


@pytest.mark.validation
def test_no_installed_script_uses_a_macos_only_command_form(workspace_root):
    found = []
    for path in _installed_scripts(workspace_root):
        for n, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
            if line.lstrip().startswith("#"):
                continue
            for why, pattern in MACOS_ONLY.items():
                if pattern.search(line):
                    found.append(f"{path.relative_to(workspace_root)}:{n}: {why}")
    assert not found, "macOS-only command forms:\n" + "\n".join(found)
