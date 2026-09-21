"""`--specs-root`: the caller's answer wins over the config's.

The dashboard and this script used to work out a project's specs root
separately — the script from `AIDE_SPECS_PATH` in `.aide/config`, a file
the dashboard writes itself, and the dashboard from its own resolver. On
2026-09-21 the two disagreed: a create wrote its folder at the specs
repository's root while the landing looked for it one directory down, so
the spec could not be given its number and nothing reached main.

The flag is the one answer now. Absent, the config is still read, which
is what a run started by hand has always done.
"""

from .run_spec_invoking import create


def test_the_flag_names_the_specs_root_the_run_uses(runner, workspace, fake_claude):
    """A create is the step that MAKES the folder, so it is the one the
    disagreement cost a spec."""
    claude = fake_claude("exit 1")
    inside = workspace["specs"] / "proj-a"
    inside.mkdir()

    rc, out, _ = create(runner, workspace, claude, specs_root=str(inside), dry_run=True)

    assert rc == 0, out
    assert out["specsRoot"] == str(inside), out


def test_without_the_flag_the_config_still_decides(runner, workspace, fake_claude):
    """Nothing is taken away from a caller that never passed it."""
    claude = fake_claude("exit 1")

    rc, out, _ = create(runner, workspace, claude, dry_run=True)

    assert rc == 0, out
    assert out["specsRoot"] == str(workspace["specs"]), out


def test_a_specs_root_that_is_not_there_is_refused_by_name(runner, workspace, fake_claude):
    """A flag pointing at nothing is a setup error, said in the same
    words as a configured root that is missing — never a silent fallback
    to somewhere else, which is the failure this flag exists to stop."""
    claude = fake_claude("exit 1")
    missing = workspace["specs"] / "not-there"

    rc, out, _ = create(runner, workspace, claude, specs_root=str(missing), dry_run=True)

    assert rc == 2, out
    assert str(missing) in out["error"], out
