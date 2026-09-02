"""Validation of the `testScopes` rule (spec 196).

A repository with two toolchains has two test commands, and command
detection reads the project ROOT only — it finds one command for the whole
repo. `testScopes:` in `.aide/project.yaml` is where a project declares the
subdirectories that carry their own command, and the skills that run tests
(analyze, implement, archive's conflict resolution) turn a spec's touched
files into the command(s) that actually cover them.

Nothing here runs at another component's boundary: the manifest field and
the rule are read by whichever AI session executes the skill. So these are
content assertions on the files that carry the rule, in the same style
test_core_rules.py uses for core/rules/*.md.
"""
from pathlib import Path

ROOT = Path(__file__).parents[5]

MANIFEST = ROOT / ".aide" / "project.yaml"
TOOLS_AND_SCRIPTS = ROOT / "core" / "skills" / "tools-and-scripts" / "SKILL.md"
AIDE_ANALYZE = ROOT / "core" / "skills" / "aide-analyze" / "SKILL.md"
AIDE_IMPLEMENT = ROOT / "core" / "skills" / "aide-implement" / "SKILL.md"
RESOLVE_CONFLICT = (
    ROOT / "core" / "skills" / "aide-archive" / "references" / "resolve-conflict.md"
)
AIDE_MANIFEST = ROOT / "core" / "skills" / "aide-manifest" / "SKILL.md"


def section(text: str, start: str, end: str) -> str:
    """The text between two headings — `end` may be absent (last section)."""
    assert start in text, f"missing heading: {start}"
    after = text.split(start, 1)[1]
    return after.split(end, 1)[0] if end in after else after


def test_project_manifest_declares_dashboard_test_scope():
    """AC1: aide's own manifest names the dashboard's separate toolchain."""
    text = MANIFEST.read_text()
    assert "testScopes:" in text
    assert "path: dashboard" in text
    assert "command: cd dashboard && make test" in text


def test_tools_and_scripts_documents_the_matching_rule():
    """AC2: the rule for turning a file list into commands is written once."""
    text = TOOLS_AND_SCRIPTS.read_text()
    commands = section(text, "## Project commands", "## Per-project configuration")
    assert "testScopes" in commands, "the matching rule belongs in Project commands"

    lower = commands.lower()
    # A directory boundary, never a bare string prefix.
    assert "dashboard/" in commands and "prefix" in lower, (
        "the rule must say the match is a directory boundary, not a string prefix"
    )
    # The tie-break when more than one scope could match.
    assert "first" in lower and "order" in lower, (
        "the rule must say the first entry in list order wins a multi-match"
    )
    # Everything else belongs to the root command.
    assert "root" in lower
    # An absent list changes nothing.
    assert "absent" in lower or "no `testscopes`" in lower


def test_aide_analyze_names_the_scoped_command_in_the_plan():
    """AC3: Step 6 writes the real command(s), not the placeholder."""
    text = AIDE_ANALYZE.read_text()
    step6 = section(text, "### Step 6", "### Step 7")
    assert "testScopes" in step6, "Step 6 must send the plan through testScopes"
    # The placeholder may only appear as the thing NOT to write.
    assert "never leave the" in step6 and "<project test command>" in step6, (
        "the plan names the command the file list resolves to, not the placeholder"
    )


def test_aide_implement_names_the_resolver_script():
    """Spec 361/REQ-4: Phase 3 and the Quality check section both call
    `aide-resolve-test-cmd` — the same script the archive gate calls —
    rather than each independently reasoning about `testScopes` in
    prose. A content assertion standing in for runtime equivalence,
    since Phase 3 is AI-run prose and cannot itself be unit-tested."""
    text = AIDE_IMPLEMENT.read_text()
    assert "aide-resolve-test-cmd" in section(text, "### Phase 3", "### Reporting the phase")
    assert "aide-resolve-test-cmd" in section(text, "## Quality check", "## After implementation")
    # The status file records what ran and what was left alone.
    assert "left untested" in text
    assert "4-status.md" in text


def test_tools_and_scripts_documents_the_scoped_config_keys():
    """Spec 361/REQ-1, REQ-7: the deterministic-script side of the same
    idea `testScopes:` describes for an AI session's prose — the two
    key families, cross-referenced both ways."""
    text = TOOLS_AND_SCRIPTS.read_text()
    config_section = section(
        text, "## Per-project configuration (.aide/config)", "## Spec storage",
    )
    assert "AIDE_TEST_SCOPE_PATHS_" in config_section
    assert "AIDE_TEST_SCOPE_CMD_" in config_section
    assert "testScopes" in config_section, (
        "the config-key table must cross-reference the manifest's own testScopes: key"
    )


def test_resolve_conflict_uses_the_same_scoped_selection():
    """AC5: archive's gate scopes to the merge's changed files."""
    text = RESOLVE_CONFLICT.read_text()
    step4 = section(text, "### Step 4", "### Step 5")
    assert "testScopes" in step4
    assert "changed" in step4.lower(), (
        "the selection is made from the files the merge changed"
    )


def test_aide_manifest_keeps_a_test_scopes_key():
    """Beyond the five criteria: a refresh must not silently drop the key.

    `/aide-manifest` rewrites the manifest, and it is told to preserve
    `worktreeLinks` for exactly this reason — a key a refresh cannot derive
    back. `testScopes` is the second of those, so it needs the same guard or
    the next refresh undoes the scope this spec declares.
    """
    text = AIDE_MANIFEST.read_text()
    assert "testScopes" in text
    assert "Never drop one on a refresh" in text
