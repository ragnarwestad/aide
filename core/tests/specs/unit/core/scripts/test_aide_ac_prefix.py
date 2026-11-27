"""Tests for core/scripts/aide-ac-prefix: the one place the prefix a test's
name puts before a criterion's id is worked out, from the manifest's
`acPrefix` and the number the spec's folder writes.

No AI is involved: the implement skill runs this command, so the rule
lives here, where it can be tested, and not in the session's own reading
of a YAML file.
"""
import json
import subprocess

import pytest

from .spec.spec_repos import git, project  # noqa: F401

FOLDER = "652-a-project-can-have-its-tests-name-a-criterion-with-the-spec-s-number-as-in-f02-ac-2"


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-ac-prefix"


def write_manifest(repo, text):
    (repo / ".aide").mkdir(exist_ok=True)
    (repo / ".aide" / "project.yaml").write_text(text)


def prefix(script, project_dir, *args):
    out = subprocess.run(
        [str(script), "--project-dir", str(project_dir), *args], capture_output=True, text=True,
    )
    return out.returncode, json.loads(out.stdout.strip().splitlines()[-1])


def prefix_for(script, project_dir, spec):
    return prefix(script, project_dir, "--spec", spec)


def test_the_prefix_has_the_folder_s_number_in_place_of_spec(script, project):
    write_manifest(project, "name: p\nacPrefix: F{spec}\n")
    assert prefix_for(script, project, FOLDER) == (0, {"ok": True, "prefix": "F652"})


def test_the_number_keeps_the_folder_s_leading_zero(script, project):
    write_manifest(project, "acPrefix: F{spec}\n")
    assert prefix_for(script, project, "02-totals") == (0, {"ok": True, "prefix": "F02"})


def test_a_value_quoted_as_a_whole_is_read_without_its_quotes(script, project):
    write_manifest(project, 'acPrefix: "{spec}"\n')
    assert prefix_for(script, project, FOLDER) == (0, {"ok": True, "prefix": "652"})


def test_a_trailing_comment_is_not_part_of_the_prefix_ac_3(script, project):
    write_manifest(project, "acPrefix: F{spec} # feature\n")
    assert prefix_for(script, project, FOLDER) == (0, {"ok": True, "prefix": "F652"})


def test_every_spec_in_the_value_is_replaced(script, project):
    write_manifest(project, "acPrefix: '{spec}/F{spec}'\n")
    assert prefix_for(script, project, "02-totals") == (0, {"ok": True, "prefix": "02/F02"})


def test_a_worktree_without_a_manifest_reads_the_main_checkout(script, project, tmp_path):
    wt = tmp_path / "wt"
    git(project, "worktree", "add", "-q", "-b", "spec", str(wt))
    write_manifest(project, "acPrefix: F{spec}\n")
    assert prefix_for(script, wt, FOLDER) == (0, {"ok": True, "prefix": "F652"})


@pytest.mark.parametrize("spec", ["652", f"specs/aide/{FOLDER}/", f"specs/aide/{FOLDER}"])
def test_a_bare_number_and_a_path_name_the_same_number(script, project, spec):
    write_manifest(project, "acPrefix: F{spec}\n")
    assert prefix_for(script, project, spec) == (0, {"ok": True, "prefix": "F652"})


def test_a_folder_without_a_number_has_no_prefix(script, project):
    write_manifest(project, "acPrefix: F{spec}\n")
    assert prefix_for(script, project, "new-abc123de") == (0, {"ok": True, "prefix": ""})


def test_no_acprefix_key_is_an_empty_prefix(script, project):
    write_manifest(project, "name: p\n")
    assert prefix_for(script, project, FOLDER) == (0, {"ok": True, "prefix": ""})


def test_no_manifest_is_an_empty_prefix(script, project):
    assert prefix_for(script, project, FOLDER) == (0, {"ok": True, "prefix": ""})


def test_refuses_without_spec(script, project):
    code, answer = prefix(script, project)
    assert code == 2 and answer["ok"] is False


def test_refuses_without_project_dir(script):
    out = subprocess.run([str(script), "--spec", FOLDER], capture_output=True, text=True)
    assert out.returncode == 2 and json.loads(out.stdout)["ok"] is False


def test_refuses_a_directory_that_is_not_there(script, tmp_path):
    code, answer = prefix(script, tmp_path / "nope", "--spec", FOLDER)
    assert code == 2 and "no such --project-dir" in answer["error"]
