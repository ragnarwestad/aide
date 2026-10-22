"""aide-run-spec: the display name of each Claude session a run starts —
`<project> <spec number> <step>`, `<project> new create` for a create and
`<project> schedule <entry name>` for a scheduled job — so a session list
says which project, spec and step a session belonged to. A turn that
continues a session passes no name, and Codex and OpenCode have none to pass.
"""

import re

import pytest

from ...conftest import run
from ..run_spec_invoking import CREATE_KEY, SCHEDULE_KEY, create, schedule

SESSION = "analysis-session-1"


def _name(argv):
    """The one element after `--name`: a name with spaces is a single argument."""
    return argv[argv.index("--name") + 1]


def _as_dashboard_checkout(workspace, project):
    """Moves the fixture's project to where the dashboard keeps a clone:
    `checkouts/<project>/code`."""
    home = workspace["project"].parent / "checkouts" / project
    home.mkdir(parents=True)
    workspace["project"].rename(home / "code")
    return {**workspace, "project": home / "code"}


def test_a_step_s_session_is_named_for_its_project_spec_and_step_AC_1(runner, workspace, fake_claude):
    claude = fake_claude("exit 1")  # never called in a dry run
    names = {}
    for step in ("analyze", "implement"):
        rc, out, _ = run(runner, workspace, claude, command=step, dry_run=True)
        assert rc == 0, out
        names[step] = _name(out["argv"])
    assert names == {"analyze": "proj 81 analyze", "implement": "proj 81 implement"}


def test_a_dashboard_checkout_s_session_is_named_for_its_project_not_for_code_AC_1(
    runner, workspace, fake_claude
):
    ws = _as_dashboard_checkout(workspace, "north-star")
    rc, out, _ = run(runner, ws, fake_claude("exit 1"), command="analyze", dry_run=True)
    assert rc == 0, out
    assert _name(out["argv"]) == "north-star 81 analyze"


def test_an_implement_that_continues_a_session_passes_no_name_AC_1(runner, workspace, fake_claude):
    """It starts no session, so the session keeps the name it has."""
    rc, out, _ = run(
        runner, workspace, fake_claude("exit 1"), command="implement", resume_session=SESSION, dry_run=True
    )
    assert rc == 0, out
    argv = out["argv"]
    assert argv[argv.index("--resume") + 1] == SESSION
    assert "--name" not in argv


def test_a_create_s_session_is_named_for_its_project_and_new_create_AC_3(runner, workspace, fake_claude):
    rc, out, _ = create(runner, workspace, fake_claude("exit 1"), spec=CREATE_KEY, dry_run=True)
    assert rc == 0, out
    assert _name(out["argv"]) == "proj new create"


def test_a_scheduled_job_s_session_is_named_for_its_project_and_entry_AC_3(runner, workspace, fake_claude):
    (workspace["project"] / "docs").mkdir()
    (workspace["project"] / "docs" / "nightly-report.md").write_text("Summarize last night's traffic.\n")
    rc, out, _ = schedule(runner, workspace, fake_claude("exit 1"), spec=SCHEDULE_KEY, dry_run=True)
    assert rc == 0, out
    assert _name(out["argv"]) == "proj schedule nightly-report"


def test_the_schedule_prefix_the_name_strips_is_the_one_the_dashboard_adds_AC_3(workspace_root):
    """The runner reads the entry's name out of the dashboard's tracking key,
    so the two must use the same prefix."""
    invocation = (workspace_root / "core/scripts/lib/run-spec/setup/invocation.sh").read_text()
    schedule_ts = (workspace_root / "dashboard/src/queue/schedule.ts").read_text()
    stripped = re.findall(r"\$\{spec_arg#([^}]*)\}", invocation)
    added = re.findall(r"scheduleTrackingKey = \(name: string\): string => `([^$`]*)\$\{name\}`", schedule_ts)
    assert stripped, "invocation.sh no longer strips a prefix from the schedule's key"
    assert added, "scheduleTrackingKey no longer builds the key from a prefix and the name"
    assert set(stripped) == set(added)


@pytest.mark.parametrize("tool", ["codex", "opencode"])
def test_a_codex_or_opencode_session_gets_no_name_AC_4(
    runner, workspace, fake_codex, fake_opencode, tool
):
    stand_in = {"codex": fake_codex("exit 1"), "opencode": fake_opencode("exit 1")}[tool]
    for kwargs in ({"command": "analyze"}, {"command": "implement", "resume_session": SESSION}):
        rc, out, _ = run(runner, workspace, tool=tool, **{tool: stand_in}, dry_run=True, **kwargs)
        assert rc == 0, out
        assert "--name" not in out["argv"], (tool, kwargs, out["argv"])
