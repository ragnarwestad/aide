"""Group code stays fixed between members; Archive reconciles main."""
import subprocess
import pytest
from ...conftest import git, run
from ..run_spec_fakes import specs_only_claude, project_only_claude
from ..run_spec_status_files import with_status

BRANCH = "aide/group-81-queue-and-runner"


@pytest.mark.parametrize("command", ["analyze", "implement"])
@pytest.mark.parametrize("own_code", [True, False])
def test_group_analysis_keeps_its_code_and_refreshes_separate_specs(
    runner, workspace, fake_claude, own_code, command
):
    if command == "implement":
        with_status(workspace, ["create", "analyze"])
    project, specs = workspace["project"], workspace["specs"]
    git(project, "switch", "-qc", BRANCH)
    if own_code:
        (project / "contested.txt").write_text("group code\n")
        git(project, "add", "contested.txt")
        git(project, "commit", "-qm", "earlier group member")
    tip = git(project, "rev-parse", "HEAD")
    git(project, "switch", "-q", "main")
    (project / "contested.txt").write_text("main code\n")
    git(project, "add", "contested.txt")
    git(project, "commit", "-qm", "unrelated main change")
    git(specs, "branch", BRANCH)
    (specs / "latest-description.txt").write_text("latest spec metadata\n")
    git(specs, "add", "latest-description.txt")
    git(specs, "commit", "-qm", "update spec metadata")
    specs_tip = git(specs, "rev-parse", "HEAD")

    claude = specs_only_claude(fake_claude, workspace) if command == "analyze" else project_only_claude(fake_claude)
    rc, out, _ = run(runner, workspace, claude, branch=BRANCH, command=command)

    assert rc == 0, out
    assert git(project, "merge-base", "--is-ancestor", tip, BRANCH) == ""
    assert subprocess.run(["git", "-C", str(project), "merge-base", "--is-ancestor", "main", BRANCH]).returncode == 1
    if command == "analyze":
        assert git(project, "rev-parse", BRANCH) == tip
    assert git(specs, "merge-base", "--is-ancestor", specs_tip, BRANCH) == ""
