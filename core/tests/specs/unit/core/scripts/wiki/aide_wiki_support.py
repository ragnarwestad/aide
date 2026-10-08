"""The fixtures and helpers the aide-wiki tests share: a project and a
specs repository, and the calls that write, index and read a wiki."""
import json
import subprocess

import pytest

from ..conftest import git, init_repo


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-wiki"


@pytest.fixture
def project(tmp_path):
    repo = init_repo(tmp_path / "proj")
    (repo / "x.txt").write_text("x\n")
    (repo / "y.txt").write_text("y\n")
    (repo / "dir").mkdir()
    (repo / "dir" / "z.txt").write_text("z\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "files")
    return repo


@pytest.fixture
def specs_repo(tmp_path):
    return init_repo(tmp_path / "specs")


@pytest.fixture
def specs_root(specs_repo):
    root = specs_repo / "aide"
    root.mkdir()
    (root / "01-first").mkdir()
    (root / "01-first" / "1-description.md").write_text("# First\n")
    git(specs_repo, "add", "-A")
    git(specs_repo, "commit", "-qm", "specs")
    return root


def call(script, *args, stdin=""):
    proc = subprocess.run([str(script), *map(str, args)], input=stdin, capture_output=True, text=True)
    line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line)


def write_page(script, specs_root, project, page, files, body="# Title\n\nWhat it does.\n"):
    args = ["write", "--specs-root", specs_root, "--project-dir", project, "--page", page]
    for f in files:
        args += ["--file", f]
    return call(script, *args, stdin=body)


def build_index(script, specs_root, project):
    return call(script, "index", "--specs-root", specs_root, "--project-dir", project)


def status(script, specs_root, project):
    return call(script, "status", "--specs-root", specs_root, "--project-dir", project)[1]


def head(repo):
    return git(repo, "rev-parse", "HEAD")


def commit_all(repo, message):
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", message)




def hand_written(specs_root, name="notes.md", text="# Notes\n\nWritten by a person.\n"):
    (specs_root / "wiki").mkdir(exist_ok=True)
    (specs_root / "wiki" / name).write_text(text)
    return text


def verify(script, specs_root, ref="HEAD"):
    rc, out = call(script, "verify", "--specs-root", specs_root, "--base-ref", ref)
    assert rc == 0, out
    return sorted((v["kind"], v["page"]) for v in out["violations"])
