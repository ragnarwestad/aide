"""Spec 345: aide's own `.aide/config` stops being tracked in git.

Every other aide-managed project already keeps `.aide/config` out of git
(the operator's global ignore drops it) — this repo's own `.gitignore`
carried a `!/.aide/config` negation that made it the one exception, and
that negation is what blocked a fast-forward on every checkout whose
config had diverged locally (the normal state everywhere). REQ-1/REQ-6
remove the negation and the tracking; REQ-4 adds a documented example
file; REQ-5 verifies no doc still carves out an aide-specific exception;
REQ-3 is a one-time, documented manual cutover — proven here as a
runbook regression test, not a product-code path, since no code ships to
perform it (see 3-solution.md, Risk analysis #1: such code could never
fire for its own purpose).
"""
import re
import subprocess

import pytest


@pytest.mark.validation
class TestConfigIsNotTracked:
    """REQ-1, REQ-6: `.aide/config` is untracked in aide's own repo, and a
    test fails if that ever regresses."""

    def test_aide_config_is_not_tracked(self, workspace_root):
        out = subprocess.run(
            ["git", "-C", str(workspace_root), "ls-files", "--", ".aide/config"],
            capture_output=True, text=True, check=True,
        ).stdout
        assert out.strip() == "", (
            ".aide/config must not be tracked in aide's own repository (REQ-1/REQ-6)"
        )

    def test_gitignore_no_longer_negates_it(self, workspace_root):
        text = (workspace_root / ".gitignore").read_text()
        assert "!/.aide/config" not in text, (
            ".gitignore must not negate the global ignore for .aide/config"
        )


@pytest.mark.validation
class TestConfigExampleFile:
    """REQ-4: an example file documents every key the tools-and-scripts
    skill's own table recognizes, read from that table rather than a
    hardcoded list — the two cannot silently drift apart."""

    def _table_keys(self, workspace_root):
        skill = (
            workspace_root / "core" / "skills" / "tools-and-scripts" / "SKILL.md"
        ).read_text()
        section = skill.split("## Per-project configuration (.aide/config)", 1)[1]
        section = section.split("## Spec storage", 1)[0]
        return re.findall(r"^\|\s*`([A-Z_]+)`", section, re.MULTILINE)

    def test_example_file_exists_and_is_tracked(self, workspace_root):
        example = workspace_root / ".aide" / "config.example"
        assert example.is_file(), ".aide/config.example must exist"
        tracked = subprocess.run(
            ["git", "-C", str(workspace_root), "ls-files", "--", ".aide/config.example"],
            capture_output=True, text=True, check=True,
        ).stdout
        assert tracked.strip() == ".aide/config.example"

    def test_example_names_every_recognized_key(self, workspace_root):
        keys = self._table_keys(workspace_root)
        assert keys, "could not find any keys in the SKILL.md table — the parser or the doc broke"
        example_text = (workspace_root / ".aide" / "config.example").read_text()
        missing = []
        for key in keys:
            # A `_N` scope key (AIDE_TEST_SCOPE_PATHS_N) is documented by its
            # PREFIX in the example, not the literal placeholder `N`.
            needle = key[:-2] if key.endswith("_N") else key
            if needle not in example_text:
                missing.append(key)
        assert missing == [], f"config.example does not mention: {missing}"


@pytest.mark.validation
class TestNoDocExceptsAide:
    """REQ-5: no doc carves out an aide-specific exception to
    "`.aide/config` is gitignored" — verified by a grep, not a one-time
    read during analysis."""

    EXCEPTION_RE = re.compile(
        r"aide[^.\n]{0,80}(is tracked|not gitignored)|except[^.\n]{0,40}aide",
        re.IGNORECASE,
    )

    def test_gitignore_itself_carves_out_no_exception(self, workspace_root):
        text = (workspace_root / ".gitignore").read_text()
        assert not self.EXCEPTION_RE.search(text), (
            ".gitignore still reads as carving out an aide-specific exception"
        )

    def test_no_dashboard_doc_carves_out_an_exception(self, workspace_root):
        docs_dir = workspace_root / "dashboard" / "docs"
        offenders = [
            md.name for md in sorted(docs_dir.glob("*.md"))
            if self.EXCEPTION_RE.search(md.read_text())
        ]
        assert offenders == [], (
            f"doc(s) carve out an aide-specific exception to '.aide/config is gitignored': {offenders}"
        )


def _git(repo, *args):
    return subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, check=True,
    ).stdout.strip()


def _init(repo, name="Test", email="test@example.com"):
    repo.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "-C", str(repo), "init", "-q", "-b", "main"], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", name], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.email", email], check=True)


@pytest.mark.validation
class TestCutoverRecipe:
    """REQ-3: a checkout whose `.aide/config` has diverged locally (the
    state of every real checkout before this spec lands) survives the
    untracking commit with the documented one-time recipe — reproduced
    against a real scratch git repo with a bare origin, standing in for
    `mergeBranchIntoDefault`'s own fast-forward step.

    No product code performs this recipe (3-solution.md, Risk analysis
    #1: a fix here can never run at the one moment it is needed, because
    the checkout that needs it is always still on pre-fix code). This
    test is the proof the recipe itself keeps working, not a test of any
    shipped function.
    """

    def test_the_fast_forward_fails_then_the_recipe_recovers_it(self, tmp_path):
        origin = tmp_path / "origin.git"
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True)

        seed = tmp_path / "seed"
        _init(seed)
        (seed / ".gitignore").write_text("!/.aide/config\n")
        (seed / ".aide").mkdir()
        (seed / ".aide" / "config").write_text("AIDE_SPECS_PATH=/original\n")
        _git(seed, "add", "-f", ".gitignore", ".aide/config")
        _git(seed, "commit", "-qm", "seed: config tracked")
        _git(seed, "remote", "add", "origin", str(origin))
        _git(seed, "push", "-q", "origin", "main")

        # The "host": a real checkout whose .aide/config has DIVERGED
        # locally from the last shared commit — every checkout's normal
        # state, since the file is personal by design.
        host = tmp_path / "host"
        subprocess.run(["git", "-C", str(tmp_path), "clone", "-q", str(origin), str(host)], check=True)
        (host / ".aide" / "config").write_text("AIDE_SPECS_PATH=/this-machines-own-path\n")

        # The "editor": lands REQ-1 — untrack the file, drop the negation
        # — and pushes.
        editor = tmp_path / "editor"
        subprocess.run(["git", "-C", str(tmp_path), "clone", "-q", str(origin), str(editor)], check=True)
        (editor / ".gitignore").write_text("")
        _git(editor, "add", ".gitignore")
        _git(editor, "rm", "-q", "--cached", ".aide/config")
        _git(editor, "commit", "-qm", "stop tracking .aide/config")
        _git(editor, "push", "-q", "origin", "main")

        # Reproduce the hazard: the host's own pull now fails, exactly as
        # 2-analysis.md's "Codebase analysis" measured.
        # The hazard reads differently per git version: 2.47 refuses the
        # fast-forward ("would be overwritten"), 2.54 lets it through and
        # the machine's own file is gone. Either way the recipe below has
        # to bring it back — so the backup is taken first, as the recipe
        # says, and both outcomes count as the hazard reproduced.
        backup = (host / ".aide" / "config").read_text()
        _git(host, "fetch", "-q", "origin")
        attempt = subprocess.run(
            ["git", "-C", str(host), "merge", "--ff-only", "origin/main"],
            capture_output=True, text=True,
        )
        refused = attempt.returncode != 0
        assert refused or not (host / ".aide" / "config").exists(), (
            "neither refused nor lost the file — the hazard this spec fixes is gone?"
        )
        if refused:
            assert "would be overwritten" in (attempt.stdout + attempt.stderr)

        # The documented recipe (3-solution.md, Recommended solution §1).
        if _git(host, "ls-files", "--", ".aide/config"):
            _git(host, "rm", "-q", "--cached", ".aide/config")
        if (host / ".aide" / "config").exists():
            (host / ".aide" / "config").unlink()
        recovered = subprocess.run(
            ["git", "-C", str(host), "merge", "--ff-only", "origin/main"],
            capture_output=True, text=True,
        )
        assert recovered.returncode == 0, recovered.stderr
        (host / ".aide").mkdir(exist_ok=True)
        (host / ".aide" / "config").write_text(backup)

        assert _git(host, "status", "--porcelain") == ""
        assert (host / ".aide" / "config").read_text() == "AIDE_SPECS_PATH=/this-machines-own-path\n"
        assert _git(host, "ls-files", "--", ".aide/config") == ""
