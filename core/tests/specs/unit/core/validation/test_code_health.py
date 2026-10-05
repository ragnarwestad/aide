"""The repository's code-health limits outside dashboard/, which keeps its
own test (dashboard/test/design/code-health-limits.test.ts): a source file
is at most 500 lines and a test file at most 800, and a folder holds at
most 15 of them directly. The rules are written down in
.claude/rules/development.md, "Code health". Markdown is left out: a page
is as long as what it says."""
import subprocess
from pathlib import Path

SOURCE_LIMIT = 500
TEST_LIMIT = 800

FOLDER_LIMIT = 15

SOURCE_SUFFIXES = {".sh", ".py", ".ts", ".js", ".mjs", ".css"}

# Files already over the limit, at the length measured when this list was
# written. One that grows fails; one split below the limit leaves the list.
# None is left.
OVER_LINE_LIMIT = {}

# Folders already over the limit, at the count measured when this list was
# written, held until they are split. None is left.
OVER_FOLDER_LIMIT = {}

# The commands installed onto PATH sit flat in one folder, the established
# pattern for them (rule 5), whatever their number.
FLAT_BY_PATTERN = {"core/scripts"}


def _tracked(root):
    out = subprocess.run(["git", "-C", str(root), "ls-files"], capture_output=True, text=True, check=True)
    return [p for p in out.stdout.splitlines() if not p.startswith("dashboard/")]


def _is_source(root, rel):
    path = Path(root, rel)
    if path.suffix in SOURCE_SUFFIXES:
        return True
    if path.suffix or not path.is_file():
        return False
    try:
        first = path.open("rb").readline()
    except OSError:
        return False
    return first.startswith(b"#!") and (b"bash" in first or b"python" in first or b"/sh" in first)


def _lines(path):
    return path.read_bytes().count(b"\n")


def _files(root):
    for rel in _tracked(root):
        if not _is_source(root, rel):
            continue
        is_test = rel.startswith("core/tests/")
        yield rel, _lines(Path(root, rel)), TEST_LIMIT if is_test else SOURCE_LIMIT


def test_the_scan_sees_the_scripts_and_the_tests(workspace_root):
    seen = [rel for rel, _, _ in _files(workspace_root)]
    assert "core/scripts/aide-run-spec" in seen
    assert any(rel.startswith("core/tests/") for rel in seen)


def test_every_source_and_test_file_stays_within_its_limit(workspace_root):
    bad = []
    for rel, lines, limit in _files(workspace_root):
        recorded = OVER_LINE_LIMIT.get(rel)
        if recorded is not None:
            if lines != recorded:
                bad.append(f"{rel}: {lines} lines (recorded {recorded} — update or remove the exception)")
            continue
        if lines > limit:
            bad.append(f"{rel}: {lines} lines (limit {limit})")
    assert bad == []


def test_every_folder_holds_at_most_fifteen_source_or_test_files(workspace_root):
    counts = {}
    for rel, _, _ in _files(workspace_root):
        folder = str(Path(rel).parent)
        counts[folder] = counts.get(folder, 0) + 1
    bad = []
    for folder, count in sorted(counts.items()):
        if folder in FLAT_BY_PATTERN:
            continue
        recorded = OVER_FOLDER_LIMIT.get(folder)
        if recorded is not None:
            if count != recorded:
                bad.append(f"{folder}: {count} files (recorded {recorded} — update or remove the exception)")
            continue
        if count > FOLDER_LIMIT:
            bad.append(f"{folder}: {count} files (limit {FOLDER_LIMIT})")
    assert bad == []
