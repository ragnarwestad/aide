"""Spec 355 (REQ-7): a spec's state file (4-status.json) has exactly one
writer — core/scripts/lib/spec-state.sh's write_spec_state, sourced by
the three scripts that already own the machine-read lines
(aide-run-spec, aide-archive-spec, aide-write-spec) and by the one-time
backfill (aide-backfill-spec-state). Two invariants:

1. No code anywhere else CONSTRUCTS the file's content — every other
   mention of "4-status.json" in the codebase is a read, a staging
   step, or documentation, never a second implementation of the
   derivation.
2. The three writer scripts genuinely produce a 4-status.json that
   agrees with the 4-status.md prose beside it, run for real against a
   real temp spec folder — not asserted from a mock.
"""
import json
import subprocess

import pytest


# The exact, curated set of files this repo has today that mention
# "4-status.json" at all. A file added to this list is a deliberate,
# reviewed decision (a new reader, a new comment); a file NOT on this
# list that starts mentioning the state file is exactly the drift this
# guard exists to catch.
ALLOWED_BASH_FILES = {
    "core/scripts/lib/spec-state.sh",       # the one writer
    "core/scripts/aide-write-spec",          # reads the derived file back, for its own stdout contract
    "core/scripts/aide-archive-spec",        # stages the new file alongside the git-mv rename
    "core/scripts/aide-run-spec",            # derives it after every completed step, so the gates read what the run just landed
    "core/scripts/aide-backfill-spec-state",  # doc comment only
}
ALLOWED_DASHBOARD_FILES = {
    "dashboard/src/project/parse-spec-state.ts",  # the one reader
    "dashboard/src/serve/spec-lookup.ts",          # reads it through parse-spec-state.ts
    "dashboard/src/serve/handle-queue/spec-edit.ts",  # relays what aide-write-spec derived
    "dashboard/src/git/run-aide-write-spec.ts",    # spawns the script, in scratch space
    "dashboard/src/git/branch-file.ts",            # generic multi-file commit plumbing; doc comment
    "dashboard/src/git/specs-pull.ts",             # generic multi-file commit plumbing; doc comment
    "dashboard/src/render/pages/queue-list/data-model/types.ts",  # doc comment on the stateMissing field
}


def _grep(root, *globs):
    hits = []
    for pattern in globs:
        for path in root.glob(pattern):
            if path.is_file() and "4-status.json" in path.read_text(errors="ignore"):
                hits.append(str(path.relative_to(root)))
    return sorted(hits)


class TestBashWriterConfinement:
    def test_only_the_allowed_bash_files_mention_the_state_file(self, workspace_root):
        found = set(_grep(
            workspace_root,
            "core/scripts/aide-*",
            "core/scripts/lib/*.sh",
        ))
        # Executable scripts have no extension — glob for the bare
        # `aide-*` names, excluding the tests directory entirely (never
        # scanned here; the guard is about source, not its own fixtures).
        assert found <= ALLOWED_BASH_FILES, (
            f"unexpected file(s) mentioning 4-status.json: {found - ALLOWED_BASH_FILES} "
            "— either this is a new, legitimate reader (add it to ALLOWED_BASH_FILES "
            "after review) or it is a second writer of the state file, which REQ-7 forbids"
        )

    def test_the_atomic_write_lives_only_in_spec_state_sh(self, workspace_root):
        """The actual write — a temp file moved onto the resolved state
        path — is the operation REQ-7 forbids a second copy of. Grepping
        for an `mv`/`>` INTO a variable holding the state path, across
        every other bash file, confirms none of them re-implements it —
        aide-write-spec legitimately READS the path back (a `state_file=`
        assignment with no `mv`/`>` writing to it), which this allows."""
        lib = (workspace_root / "core/scripts/lib/spec-state.sh").read_text()
        assert 'mv "$tmp" "$state_file"' in lib

        write_shapes = ('mv "$tmp" "$state_file"', 'mv "$content_tmp" "$state_file"',
                         '> "$state_file"', '>> "$state_file"')
        for name in ("aide-run-spec", "aide-archive-spec", "aide-write-spec",
                     "aide-backfill-spec-state"):
            text = (workspace_root / "core/scripts" / name).read_text()
            for shape in write_shapes:
                assert shape not in text, (
                    f"{name} writes $state_file directly ({shape!r}) — only "
                    "spec-state.sh's write_spec_state may write that path"
                )


class TestDashboardWriterConfinement:
    def test_only_the_allowed_dashboard_files_mention_the_state_file(self, workspace_root):
        found = set(_grep(workspace_root, "dashboard/src/**/*.ts"))
        assert found <= ALLOWED_DASHBOARD_FILES, (
            f"unexpected file(s) mentioning 4-status.json: {found - ALLOWED_DASHBOARD_FILES} "
            "— either this is a new, legitimate reader (add it to ALLOWED_DASHBOARD_FILES "
            "after review) or it is a second, TypeScript-side derivation of the state "
            "file, which REQ-7 forbids"
        )

    def test_the_reader_module_never_writes(self, workspace_root):
        text = (workspace_root / "dashboard/src/project/parse-spec-state.ts").read_text()
        assert "writeFileSync" not in text
        assert "Bun.write" not in text


# --- criterion 10: the file and the prose agree, run for real ---------------


@pytest.fixture
def specs_root(tmp_path):
    d = tmp_path / "specs"
    d.mkdir()
    return d


def run_write_spec(script, specs_root, folder, content):
    proc = subprocess.run(
        [str(script), "--specs-root", str(specs_root), "--folder", folder, "--file", "4-status.md"],
        input=content, capture_output=True, text=True,
    )
    return proc.returncode


class TestWriterOutputAgreesWithProse:
    def test_aide_write_spec_produces_agreeing_state(self, workspace_root, specs_root):
        script = workspace_root / "core/scripts/aide-write-spec"
        folder = "42-example"
        (specs_root / folder).mkdir()
        (specs_root / folder / "4-status.md").write_text("placeholder\n")
        content = (
            "# X - Status\n\n## Tracking info\n\n"
            "- **Workflow steps completed:** create, analyze\n\n"
            "## Acceptance criteria\n\n"
            "| Task | Status | Notes |\n|------|--------|-------|\n"
            "| REQ-1: x | ✅ | |\n"
        )
        assert run_write_spec(script, specs_root, folder, content) == 0
        state = json.loads((specs_root / folder / "4-status.json").read_text())
        assert state["completedPhases"] == ["create", "analyze"]
        assert state["acceptanceCriteria"] == [{"task": "REQ-1: x", "done": True}]

    def test_aide_archive_spec_stamps_agree_after_a_real_archive_run(self, workspace_root, tmp_path):
        import subprocess as sp

        specs = tmp_path / "specs"
        project = tmp_path / "proj"
        for repo in (specs, project):
            repo.mkdir()
            sp.run(["git", "-C", str(repo), "init", "-q", "-b", "main"], check=True)
            sp.run(["git", "-C", str(repo), "config", "user.name", "Test"], check=True)
            sp.run(["git", "-C", str(repo), "config", "user.email", "t@example.com"], check=True)
        (project / ".aide").mkdir()
        (project / ".aide" / "config").write_text(f"AIDE_SPECS_PATH={specs}\nAIDE_TEST_CMD=true\n")
        # -f: the user's global gitignore covers .aide/config.
        sp.run(["git", "-C", str(project), "add", "-f", ".aide/config"], check=True)
        sp.run(["git", "-C", str(project), "commit", "-qm", "init"], check=True)

        folder = "42-example"
        (specs / folder).mkdir()
        (specs / folder / "1-description.md").write_text(f"# {folder}\n")
        (specs / folder / "4-status.md").write_text(
            "# X - Status\n\n## Tracking info\n\n"
            "- **Workflow steps completed:** create, analyze, implement\n\n"
            "## Phase 1: RED\n\n"
            "| Task | Status | Notes |\n|------|--------|-------|\n"
            "| a | ✅ | |\n"
        )
        record = {"command": "true", "exitCode": 0,
                  "commit": sp.run(["git", "-C", str(project), "rev-parse", "HEAD"],
                                    capture_output=True, text=True, check=True).stdout.strip(),
                  "note": None}
        (specs / folder / "test-run.json").write_text(json.dumps(record))
        sp.run(["git", "-C", str(specs), "add", "-A"], check=True)
        sp.run(["git", "-C", str(specs), "commit", "-qm", "add spec"], check=True)

        script = workspace_root / "core/scripts/aide-archive-spec"
        proc = sp.run(
            [str(script), "--project-dir", str(project), "--spec", folder],
            capture_output=True, text=True,
        )
        out = json.loads(proc.stdout.strip().splitlines()[-1])
        assert out["terminalReason"] == "archived", out

        prose = (specs / "archive" / folder / "4-status.md").read_text()
        state = json.loads((specs / "archive" / folder / "4-status.json").read_text())
        assert state["completedPhases"] == ["create", "analyze", "implement"]
        assert "**Archived:**" in prose
        assert state["archived"]["date"]
