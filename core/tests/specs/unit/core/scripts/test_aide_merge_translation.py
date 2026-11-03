"""Tests for core/scripts/aide-merge-translation and the git arguments that
make a merge use it (`aide_translation_merge_args` in lib/translation-files.sh).

A project names its translation files under `translationFiles` in its
.aide/project.yaml. A merge in that project then merges those files key by
key: two branches that each add messages to the same file merge cleanly,
while two different values for one key are still a conflict, with git's own
markers. Every test here is a real `git merge` in a throwaway repository.
"""

import json
import shutil
import subprocess

import pytest

MESSAGES = "packages/i18n/messages/nb.json"


@pytest.fixture
def scripts(workspace_root):
    return workspace_root / "core" / "scripts"


def git(repo, *args, check=True):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=check)


def messages(entries):
    """A translation file as Paraglide writes one: tab-indented, one key a line."""
    body = ",\n".join(f"\t{json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}" for k, v in entries.items())
    return "{\n" + body + "\n}\n"


@pytest.fixture
def repo(tmp_path):
    """A project whose manifest names its translation files, on main, with
    one message file of two keys."""
    r = tmp_path / "project"
    r.mkdir()
    git(r, "init", "-q", "-b", "main")
    git(r, "config", "user.email", "t@example.com")
    git(r, "config", "user.name", "T")
    (r / ".aide").mkdir()
    (r / ".aide" / "project.yaml").write_text("name: project\ntranslationFiles: packages/i18n/messages/*.json\n")
    (r / MESSAGES).parent.mkdir(parents=True)
    (r / MESSAGES).write_text(messages({"title": "Skjera", "login": "Logg inn"}))
    git(r, "add", "-A")
    git(r, "commit", "-q", "-m", "base")
    return r


def commit_on(repo, branch, entries, start="main"):
    git(repo, "checkout", "-q", "-b", branch, start)
    (repo / MESSAGES).write_text(messages(entries))
    git(repo, "commit", "-q", "-am", branch)
    git(repo, "checkout", "-q", "main")


def merge(repo, scripts, tmp_path, branch, use_driver=True):
    """`git merge <branch>` on main, with the project's translation arguments."""
    args = []
    if use_driver:
        out = subprocess.run(
            ["bash", "-c", f'source "{scripts}/_aide-spec-lib.sh" && source "{scripts}/lib/translation-files.sh" && aide_translation_merge_args "$1" "$2" "$3"',
             "_", str(repo), str(tmp_path), str(scripts)],
            capture_output=True, text=True, check=True,
        )
        args = [a for a in out.stdout.split("\n") if a]
    return subprocess.run(["git", "-C", str(repo), *args, "merge", "-q", "--no-edit", branch],
                          capture_output=True, text=True)


def two_branches_adding(repo):
    """Main and a spec branch that each add one message at the end."""
    commit_on(repo, "spec", {"title": "Skjera", "login": "Logg inn", "reminder": "Påminnelse"})
    git(repo, "checkout", "-q", "main")
    (repo / MESSAGES).write_text(messages({"title": "Skjera", "login": "Logg inn", "invites": "Invitasjoner"}))
    git(repo, "commit", "-q", "-am", "main adds")


def test_two_branches_adding_messages_at_the_end_merge_cleanly(repo, scripts, tmp_path):
    two_branches_adding(repo)
    proc = merge(repo, scripts, tmp_path, "spec")
    assert proc.returncode == 0, proc.stderr
    assert (repo / MESSAGES).read_text() == messages(
        {"title": "Skjera", "login": "Logg inn", "invites": "Invitasjoner", "reminder": "Påminnelse"}
    )


def test_the_same_additions_conflict_without_the_projects_setting(repo, scripts, tmp_path):
    two_branches_adding(repo)
    proc = merge(repo, scripts, tmp_path, "spec", use_driver=False)
    assert proc.returncode != 0


def test_two_values_for_one_key_leave_gits_own_conflict_markers(repo, scripts, tmp_path):
    commit_on(repo, "spec", {"title": "Skjera", "login": "Logg på"})
    (repo / MESSAGES).write_text(messages({"title": "Skjera", "login": "Logg inn nå"}))
    git(repo, "commit", "-q", "-am", "main changes login")
    proc = merge(repo, scripts, tmp_path, "spec")
    assert proc.returncode != 0
    text = (repo / MESSAGES).read_text()
    assert "<<<<<<<" in text and "Logg på" in text and "Logg inn nå" in text


def test_a_message_deleted_on_one_side_is_gone_after_the_merge(repo, scripts, tmp_path):
    commit_on(repo, "spec", {"title": "Skjera", "login": "Logg inn", "reminder": "Påminnelse"})
    (repo / MESSAGES).write_text(messages({"title": "Skjera"}))
    git(repo, "commit", "-q", "-am", "main drops login")
    proc = merge(repo, scripts, tmp_path, "spec")
    assert proc.returncode == 0, proc.stderr
    assert (repo / MESSAGES).read_text() == messages({"title": "Skjera", "reminder": "Påminnelse"})


def test_a_layout_it_cannot_write_back_falls_back_to_the_line_merge(repo, scripts, tmp_path):
    # Two separators that differ: the key merge refuses the file, and git's
    # own line merge decides — here cleanly, since the edits are far apart.
    lines = ["{", '\t"a": "1",', '\t"b": "2",', '\t"c": "3",', '\t"d": "4",', '\t"e": "5",  "f": "6"', "}", ""]
    (repo / MESSAGES).write_text("\n".join(lines))
    git(repo, "commit", "-q", "-am", "odd layout")
    git(repo, "checkout", "-q", "-b", "spec")
    (repo / MESSAGES).write_text("\n".join(lines).replace('"1"', '"one"'))
    git(repo, "commit", "-q", "-am", "spec")
    git(repo, "checkout", "-q", "main")
    (repo / MESSAGES).write_text("\n".join(lines).replace('"6"', '"six"'))
    git(repo, "commit", "-q", "-am", "main")
    proc = merge(repo, scripts, tmp_path, "spec")
    assert proc.returncode == 0, proc.stderr
    text = (repo / MESSAGES).read_text()
    assert '"one"' in text and '"six"' in text


def test_without_bun_the_file_is_merged_line_by_line(repo, scripts, tmp_path, monkeypatch):
    commit_on(repo, "spec", {"title": "Skjera", "login": "Logg på"})
    (repo / MESSAGES).write_text(messages({"title": "Skjera", "login": "Logg inn nå"}))
    git(repo, "commit", "-q", "-am", "main changes login")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for tool in ("git", "bash", "sed", "head", "dirname"):
        (bin_dir / tool).symlink_to(shutil.which(tool))
    monkeypatch.setenv("PATH", str(bin_dir))
    proc = merge(repo, scripts, tmp_path, "spec")
    assert proc.returncode != 0
    assert "<<<<<<<" in (repo / MESSAGES).read_text()


def test_a_project_naming_no_translation_files_adds_no_arguments(repo, scripts, tmp_path):
    (repo / ".aide" / "project.yaml").write_text("name: project\n")
    out = subprocess.run(
        ["bash", "-c", f'source "{scripts}/_aide-spec-lib.sh" && source "{scripts}/lib/translation-files.sh" && aide_translation_merge_args "$1" "$2" "$3"',
         "_", str(repo), str(tmp_path), str(scripts)],
        capture_output=True, text=True, check=True,
    )
    assert out.stdout == ""
