"""Required script libraries are checked before a command changes state."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest


REQUIRED_LIBRARIES = {
    "aide-create-spec": (
        "_aide-spec-lib.sh", "lib/config/aide-config.sh", "lib/spec-result.sh",
        "lib/tracking-info.sh",
    ),
    "aide-archive-spec": (
        "_aide-spec-lib.sh", "lib/config/aide-config.sh", "lib/spec-result.sh",
        "lib/spec-state.sh", "lib/status-progress.sh", "lib/spec-transitions.sh",
    ),
    "aide-spec-overlap": (
        "_aide-spec-lib.sh", "lib/config/aide-config.sh",
        "lib/spec-transitions.sh", "lib/spec-state.sh",
        "lib/status-progress.sh", "lib/files-to-change.sh",
        "lib/translation-files.sh", "lib/spec-result.sh",
    ),
    "aide-close-spec": (
        "_aide-spec-lib.sh", "lib/config/aide-config.sh", "lib/spec-result.sh",
        "lib/spec-state.sh", "lib/status-progress.sh", "lib/spec-transitions.sh",
    ),
    "aide-write-spec": (
        "lib/spec-state.sh", "lib/status-progress.sh", "lib/spec-result.sh",
    ),
}

FAULTY_COMMANDS = tuple(
    (command, library)
    for command, libraries in REQUIRED_LIBRARIES.items()
    for library in libraries
)

SAFE_COMMANDS = (
    ("aide-reopen-spec", ("--specs-root", "{specs}", "--spec", "770-example")),
    ("aide-ac-prefix", ("--project-dir", "{project}", "--spec", "770-example")),
    ("aide-resolve-test-cmd", ("--project-dir", "{project}")),
    ("aide-reset-spec", ("--specs-root", "{specs}", "--spec", "770-example")),
)

RESULT_FILE_COMMANDS = (
    "aide-create-spec", "aide-archive-spec", "aide-close-spec", "aide-write-spec",
)


@pytest.fixture
def scripts(workspace_root):
    return workspace_root / "core" / "scripts"


def copy_scripts(scripts: Path, tmp_path: Path, missing: str) -> Path:
    copied = tmp_path / "scripts"
    shutil.copytree(scripts, copied)
    (copied / missing).unlink()
    return copied


def run(command: Path, *args: str, input_text: str | None = None):
    return subprocess.run(
        [str(command), *args], input=input_text, capture_output=True, text=True,
    )


def fixture_args(command: str, tmp_path: Path):
    project = tmp_path / "project"
    specs = tmp_path / "specs"
    folder = specs / "770-example"
    project.mkdir()
    folder.mkdir(parents=True)
    analysis = folder / "2-analysis.md"
    analysis.write_text("# Example\n\n### Files to change\n\n- `one.py`\n")
    status = folder / "4-status.md"
    status.write_text("# Example - Status\n\n## Phase 1: RED\n\n| Task | Status | Notes |\n|---|---|---|\n| One | ✅ | |\n")

    if command == "aide-create-spec":
        return (
            "--specs-root", str(specs), "--number", "771", "--slug", "new",
            "--title", "New", "--description", "Description",
        ), specs / "771-new", None
    if command == "aide-archive-spec":
        return (
            "--project-dir", str(project), "--specs-dir", str(specs),
            "--spec", "770-example",
        ), specs / "archive", None
    if command == "aide-spec-overlap":
        return (
            "--specs-root", str(specs), "--spec", "770-example",
            "--record", "--project-dir", str(project),
        ), analysis, analysis.read_bytes()
    if command == "aide-close-spec":
        return (
            "--project-dir", str(project), "--specs-dir", str(specs),
            "--spec", "770-example", "--reason", "No longer needed",
        ), specs / "archive", None
    return (
        "--specs-root", str(specs), "--folder", "770-example",
        "--file", "4-status.md",
    ), status, status.read_bytes()


@pytest.mark.parametrize(("command", "missing"), FAULTY_COMMANDS)
def test_missing_required_library_refuses_before_mutation_ac_1_ac_2_ac_3(
    scripts, tmp_path, command, missing,
):
    copied = copy_scripts(scripts, tmp_path, missing)
    args, sentinel, before = fixture_args(command, tmp_path)

    result = run(
        copied / command, *args,
        input_text="# Replacement\n" if command == "aide-write-spec" else None,
    )

    assert result.returncode == 2
    payload = json.loads(result.stdout)
    assert payload["ok"] is False
    assert payload["exitCode"] == 2
    assert payload["terminalReason"] == "refused"
    assert missing in payload["error"]
    if before is None:
        assert not sentinel.exists()
    else:
        assert sentinel.read_bytes() == before


@pytest.mark.parametrize(("command", "missing"), FAULTY_COMMANDS)
def test_help_succeeds_without_required_libraries_ac_4(
    scripts, tmp_path, command, missing,
):
    copied = copy_scripts(scripts, tmp_path, missing)

    result = run(copied / command, "--help")

    assert result.returncode == 0
    assert result.stdout.startswith("Usage:\n")


def test_help_text_used_as_a_create_description_is_not_an_option_ac_4(
    scripts, tmp_path,
):
    specs = tmp_path / "specs"
    specs.mkdir()

    result = run(
        scripts / "aide-create-spec", "--specs-root", str(specs),
        "--number", "770", "--slug", "example", "--title", "Example",
        "--description", "--help",
    )

    assert result.returncode == 0
    assert (specs / "770-example" / "1-description.md").is_file()


@pytest.mark.parametrize(
    ("command", "arguments"),
    (
        ("aide-archive-spec", ("--project-dir", "--help")),
        ("aide-spec-overlap", ("--specs-root", "--help")),
        ("aide-close-spec", ("--reason", "--help")),
        ("aide-write-spec", ("--folder", "--help")),
    ),
)
def test_help_text_used_as_an_argument_value_is_not_an_option_ac_4(
    scripts, command, arguments,
):
    result = run(scripts / command, *arguments)

    assert result.returncode == 2
    assert json.loads(result.stdout)["terminalReason"] == "refused"


@pytest.mark.parametrize("command", RESULT_FILE_COMMANDS)
def test_missing_library_refusal_replaces_the_result_file_ac_2_ac_3(
    scripts, tmp_path, command,
):
    missing = REQUIRED_LIBRARIES[command][0]
    copied = copy_scripts(scripts, tmp_path, missing)
    args, _, _ = fixture_args(command, tmp_path)
    result_file = tmp_path / "result.json"
    result_file.write_text('{"ok":true,"terminalReason":"stale"}\n')

    result = run(copied / command, *args, "--result-file", str(result_file))

    assert result.returncode == 2
    assert json.loads(result_file.read_text()) == json.loads(result.stdout)
    assert missing in json.loads(result.stdout)["error"]


@pytest.mark.parametrize(("command", "arguments"), SAFE_COMMANDS)
def test_existing_safe_commands_still_name_a_missing_required_library_ac_2_ac_3(
    scripts, tmp_path, command, arguments,
):
    copied = copy_scripts(scripts, tmp_path, "_aide-spec-lib.sh")
    project = tmp_path / "project"
    specs = tmp_path / "specs"
    project.mkdir()
    (specs / "770-example").mkdir(parents=True)
    args = tuple(
        value.format(project=project, specs=specs) for value in arguments
    )

    result = run(copied / command, *args)

    assert result.returncode == 2
    payload = json.loads(result.stdout)
    assert payload["terminalReason"] == "refused"
    assert "_aide-spec-lib.sh" in payload["error"]


def test_push_specs_keeps_its_plain_text_missing_library_refusal_ac_2(
    scripts, tmp_path,
):
    copied = copy_scripts(scripts, tmp_path, "_aide-spec-lib.sh")

    result = run(copied / "aide-push-specs", "--specs-root", str(tmp_path))

    assert result.returncode == 1
    assert result.stdout == ""
    assert "_aide-spec-lib.sh" in result.stderr


def test_record_test_run_keeps_its_optional_tree_hash_library_ac_4(
    scripts, tmp_path,
):
    copied = copy_scripts(scripts, tmp_path, "_aide-spec-lib.sh")
    project = tmp_path / "project"
    spec = tmp_path / "specs" / "770-example"
    project.mkdir()
    spec.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(project)], check=True)
    subprocess.run(
        ["git", "-C", str(project), "commit", "--allow-empty", "-qm", "Initial"],
        check=True,
    )

    result = run(
        copied / "aide-record-test-run", "--project-dir", str(project),
        "--specs-root", str(spec.parent), "--folder", spec.name, "--cmd", "true",
    )

    assert result.returncode == 0
    assert json.loads(result.stdout)["terminalReason"] == "recorded"
