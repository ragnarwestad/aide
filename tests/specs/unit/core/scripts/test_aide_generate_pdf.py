"""Tests for core/scripts/aide-generate-pdf — spec 358: the dashboard's
own PDF route runs this exact script, so its two-argument form is what
REQ-3/REQ-4 hold on.
"""
import os
import shutil
import subprocess

import pytest


@pytest.fixture
def script(workspace_root):
    return workspace_root / "core" / "scripts" / "aide-generate-pdf"


def make_spec(specs_root, folder):
    d = specs_root / folder
    d.mkdir(parents=True)
    (d / "1-description.md").write_text("# Spec - Description\n\n## Description\n\nSomething.\n")
    (d / "4-status.md").write_text("# Spec - Status\n")
    return d


@pytest.fixture
def fake_md_to_pdf(tmp_path):
    """A stand-in for md-to-pdf on PATH: writes the .pdf beside the .md it
    is given, which is all the script relies on. The real tool needs a
    headless browser, which no test host is required to have; what
    these tests hold on is the script's own argument handling."""
    bin_dir = tmp_path / "fakebin"
    bin_dir.mkdir()
    fake = bin_dir / "md-to-pdf"
    fake.write_text('#!/bin/bash\nout="${1%.md}.pdf"\nprintf "%%PDF-fake" > "$out"\n')
    fake.chmod(0o755)
    return {**os.environ, "PATH": os.pathsep.join([str(bin_dir), os.environ.get("PATH", "")])}


def run(script, root, args, env=None):
    return subprocess.run(
        [str(script), *args], cwd=str(root), capture_output=True, text=True, env=env,
    )


def test_default_call_still_writes_beside_the_four_files(script, tmp_path, fake_md_to_pdf):
    root = tmp_path / "project"
    specs = root / "specs"
    make_spec(specs, "42-do-a-thing")
    proc = run(script, root, ["42-do-a-thing"], env=fake_md_to_pdf)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert (specs / "42-do-a-thing" / "42-do-a-thing.pdf").exists()


def test_second_argument_writes_there_instead_and_makes_missing_parents(script, tmp_path, fake_md_to_pdf):
    root = tmp_path / "project"
    specs = root / "specs"
    make_spec(specs, "42-do-a-thing")
    out = tmp_path / "cache" / "nested" / "out.pdf"
    proc = run(script, root, ["42-do-a-thing", str(out)], env=fake_md_to_pdf)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert out.exists()
    assert not (specs / "42-do-a-thing" / "42-do-a-thing.pdf").exists()


def test_missing_md_to_pdf_exits_nonzero_with_the_existing_message(script, tmp_path):
    root = tmp_path / "project"
    specs = root / "specs"
    make_spec(specs, "42-do-a-thing")
    found = shutil.which("md-to-pdf")
    path_dirs = [
        p for p in os.environ.get("PATH", "").split(os.pathsep)
        if not (found and os.path.dirname(found) == p)
    ]
    env = {**os.environ, "PATH": os.pathsep.join(path_dirs)}
    proc = run(script, root, ["42-do-a-thing"], env=env)
    assert proc.returncode != 0
    assert "md-to-pdf is not installed" in proc.stdout
