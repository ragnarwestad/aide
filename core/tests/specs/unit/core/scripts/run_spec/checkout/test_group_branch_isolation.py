"""Group code stays fixed between members; Archive reconciles main."""
import subprocess
import pytest
from ...conftest import git, run
from ..run_spec_invoking import runner_with_branch_prefixes
from ..run_spec_fakes import specs_only_claude, project_only_claude
from ..run_spec_status_files import with_status

GROUP = "81-queue-and-runner"


@pytest.mark.parametrize("prefix", ["aide/", "work/"])
@pytest.mark.parametrize("command", ["analyze", "implement"])
@pytest.mark.parametrize("own_code", [True, False])
def test_group_analysis_keeps_its_code_and_refreshes_separate_specs(
    runner, workspace, fake_claude, own_code, command, prefix, tmp_path
):
    runner_path = runner if prefix == "aide/" else runner_with_branch_prefixes(runner, tmp_path, prefix, f"{prefix}group-")
    branch = f"{prefix}group-{GROUP}"
    if command == "implement":
        with_status(workspace, ["create", "analyze"])
    project, specs = workspace["project"], workspace["specs"]
    git(project, "switch", "-qc", branch)
    if own_code:
        (project / "contested.txt").write_text("group code\n")
        git(project, "add", "contested.txt")
        git(project, "commit", "-qm", "earlier group member")
    tip = git(project, "rev-parse", "HEAD")
    git(project, "switch", "-q", "main")
    (project / "contested.txt").write_text("main code\n")
    git(project, "add", "contested.txt")
    git(project, "commit", "-qm", "unrelated main change")
    git(specs, "branch", branch)
    (specs / "latest-description.txt").write_text("latest spec metadata\n")
    git(specs, "add", "latest-description.txt")
    git(specs, "commit", "-qm", "update spec metadata")
    specs_tip = git(specs, "rev-parse", "HEAD")

    claude = specs_only_claude(fake_claude, workspace) if command == "analyze" else project_only_claude(fake_claude)
    rc, out, _ = run(runner, workspace, claude, runner_path=runner_path, branch=branch, command=command)

    assert rc == 0, out
    assert git(project, "merge-base", "--is-ancestor", tip, branch) == ""
    assert subprocess.run(["git", "-C", str(project), "merge-base", "--is-ancestor", "main", branch]).returncode == 1
    if command == "analyze":
        assert git(project, "rev-parse", branch) == tip
    assert git(specs, "merge-base", "--is-ancestor", specs_tip, branch) == ""
