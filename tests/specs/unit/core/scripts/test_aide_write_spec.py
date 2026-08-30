"""Tests for core/scripts/aide-write-spec — the one legitimate way
/aide-analyze, /aide-implement and /aide-archive land a spec file's
content on disk (spec 282, closing the gap spec 248 left open for
/aide-create's own file creation).

No AI is involved anywhere in this file: the point of the script is to
make every spec-file write a Bash-only path, so a permission rule can be
scoped to deny Write/Edit under the specs root with no legitimate case
left to break.
"""
import json
import subprocess

import pytest


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-write-spec"


@pytest.fixture
def specs_root(tmp_path):
    d = tmp_path / "specs"
    d.mkdir()
    return d


def run(script, specs_root, folder, file, content, result_file=None, extra_args=None):
    args = [
        str(script),
        "--specs-root", str(specs_root),
        "--folder", folder,
        "--file", file,
    ]
    if result_file:
        args += ["--result-file", str(result_file)]
    if extra_args:
        args += extra_args
    proc = subprocess.run(args, input=content, capture_output=True, text=True)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line), proc.stdout


def make_spec(specs_root, folder, files=("2-analysis.md",)):
    d = specs_root / folder
    d.mkdir(parents=True)
    for f in files:
        (d / f).write_text("placeholder\n")
    return d


# --- happy path -------------------------------------------------------


def test_writes_content_verbatim_to_active_location(script, specs_root):
    make_spec(specs_root, "42-do-a-thing")
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "2-analysis.md", "# New content\n")
    assert rc == 0, out
    assert out["ok"] is True
    assert out["exitCode"] == 0
    assert out["terminalReason"] == "written"
    assert out["specFolder"] == "42-do-a-thing"
    assert out["file"] == "2-analysis.md"
    assert (specs_root / "42-do-a-thing" / "2-analysis.md").read_text() == "# New content\n"


def test_overwrites_existing_content_completely(script, specs_root):
    make_spec(specs_root, "42-do-a-thing")
    run(script, specs_root, "42-do-a-thing", "2-analysis.md", "first\n")
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "2-analysis.md", "second\n")
    assert rc == 0, out
    assert (specs_root / "42-do-a-thing" / "2-analysis.md").read_text() == "second\n"


# --- dual-location resolution (archive/) --------------------------------


def test_resolves_archive_location_when_active_folder_is_missing(script, specs_root):
    make_spec(specs_root / "archive", "42-do-a-thing")
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "2-analysis.md", "archived content\n")
    assert rc == 0, out
    assert out["specFolder"] == "42-do-a-thing"
    assert (specs_root / "archive" / "42-do-a-thing" / "2-analysis.md").read_text() == "archived content\n"
    assert not (specs_root / "42-do-a-thing").exists()


def test_prefers_active_location_over_archive(script, specs_root):
    make_spec(specs_root, "42-do-a-thing")
    make_spec(specs_root / "archive", "42-do-a-thing")
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "2-analysis.md", "active content\n")
    assert rc == 0, out
    assert (specs_root / "42-do-a-thing" / "2-analysis.md").read_text() == "active content\n"
    assert (specs_root / "archive" / "42-do-a-thing" / "2-analysis.md").read_text() == "placeholder\n"


def test_refuses_when_neither_location_has_the_folder(script, specs_root):
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "2-analysis.md", "content\n")
    assert rc != 0
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"


def test_refuses_when_folder_exists_but_not_that_file(script, specs_root):
    make_spec(specs_root, "42-do-a-thing", files=("1-description.md",))
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "2-analysis.md", "content\n")
    assert rc != 0
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"


# --- the 5-filename whitelist -------------------------------------------


def test_refuses_on_unknown_file_name(script, specs_root):
    make_spec(specs_root, "42-do-a-thing", files=("not-a-spec-file.md",))
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "not-a-spec-file.md", "content\n")
    assert rc != 0
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"
    assert (specs_root / "42-do-a-thing" / "not-a-spec-file.md").read_text() == "placeholder\n"


@pytest.mark.parametrize("name", [
    "0-README.md", "1-description.md", "2-analysis.md", "3-solution.md", "4-status.md",
])
def test_accepts_every_known_spec_file_name(script, specs_root, name):
    make_spec(specs_root, "42-do-a-thing", files=(name,))
    rc, out, _ = run(script, specs_root, "42-do-a-thing", name, "content\n")
    assert rc == 0, out
    assert out["ok"] is True


# --- missing flags / bad input ------------------------------------------


@pytest.mark.parametrize("missing", ["--specs-root", "--folder", "--file"])
def test_refuses_on_missing_required_flag(script, specs_root, missing):
    make_spec(specs_root, "42-do-a-thing")
    args = [
        str(script),
        "--specs-root", str(specs_root),
        "--folder", "42-do-a-thing",
        "--file", "2-analysis.md",
    ]
    idx = args.index(missing)
    del args[idx:idx + 2]
    proc = subprocess.run(args, input="content\n", capture_output=True, text=True)
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    assert proc.returncode != 0
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"


def test_refuses_on_empty_stdin(script, specs_root):
    make_spec(specs_root, "42-do-a-thing")
    rc, out, _ = run(script, specs_root, "42-do-a-thing", "2-analysis.md", "")
    assert rc != 0
    assert out["ok"] is False
    assert out["terminalReason"] == "refused"
    assert (specs_root / "42-do-a-thing" / "2-analysis.md").read_text() == "placeholder\n"


# --- --result-file --------------------------------------------------------


def test_result_file_mirrors_stdout(script, specs_root, tmp_path):
    make_spec(specs_root, "42-do-a-thing")
    result_file = tmp_path / "result.json"
    rc, out, _ = run(
        script, specs_root, "42-do-a-thing", "2-analysis.md", "content\n",
        result_file=result_file,
    )
    assert rc == 0, out
    assert json.loads(result_file.read_text().strip()) == out
