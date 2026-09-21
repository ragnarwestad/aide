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


def test_the_repositorys_top_level_with_the_projects_folder_beside_it_is_refused(
    runner, workspace, fake_claude
):
    """One specs repository holds several projects, each in a folder of
    its own, so a root set one level too high looks exactly like a root
    set right. Both readings are plausible and the script picks neither:
    it says what it saw. Left to guess, a create writes its folder at the
    repository root while every list looks for it under the project's own
    folder, which is what cost woodstack-climate its first spec."""
    claude = fake_claude("exit 1")
    (workspace["project"] / ".aide" / "project.yaml").write_text("name: proj\n")
    (workspace["specs"] / "proj").mkdir()

    rc, out, _ = create(
        runner, workspace, claude, specs_root=str(workspace["specs"]), dry_run=True
    )

    assert rc == 2, out
    assert str(workspace["specs"] / "proj") in out["error"], out


def test_the_projects_own_folder_as_the_root_is_what_the_refusal_asks_for(
    runner, workspace, fake_claude
):
    """The same layout, set the way the refusal above tells the reader to
    set it. Nothing is in the way, so nothing is said."""
    claude = fake_claude("exit 1")
    (workspace["project"] / ".aide" / "project.yaml").write_text("name: proj\n")
    inside = workspace["specs"] / "proj"
    inside.mkdir()

    rc, out, _ = create(runner, workspace, claude, specs_root=str(inside), dry_run=True)

    assert rc == 0, out
    assert out["specsRoot"] == str(inside), out
