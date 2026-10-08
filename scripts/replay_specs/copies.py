"""The copies a replay works in: the Aide commit's `core/`, the configuration folder of each AI CLI, the project's
code repository at the commit before the spec's code landed, and a specs repository holding only that spec."""
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

from gitutil import git

IDENTITY = ("-c", "user.name=replay", "-c", "user.email=replay@localhost", "-c", "commit.gpgsign=false")
DEFAULT_RULES = "llm-discipline git testing spec-structure communication"
LOCAL_IDENTITY = {"user.name": "replay", "user.email": "replay@localhost", "commit.gpgsign": "false"}


class Refusal(Exception):
    """The run cannot start; nothing has been copied that stays."""


class CannotReplay(Exception):
    """This spec cannot be replayed; the next one can."""


def export_aide(aide_repo, commit, dest):
    """`core/` of the Aide commit unpacked into `dest`; returns it and the commit's full sha."""
    sha = git(str(aide_repo), "rev-parse", "--verify", "--quiet", f"{commit}^{{commit}}", check=False)
    if not sha:
        raise Refusal(f"the Aide commit {commit} is unknown to {aide_repo}")
    archive = subprocess.run(["git", "-C", str(aide_repo), "archive", sha, "core"], capture_output=True)
    if archive.returncode != 0:
        raise Refusal(f"cannot export core/ from the Aide commit {commit}: {archive.stderr.decode().strip()}")
    subprocess.run(["tar", "-x", "-C", str(dest)], input=archive.stdout, check=True)
    core = Path(dest) / "core"
    for needed in ("scripts/aide-run-spec", "scripts/aide-reset-spec", "skills"):
        if not (core / needed).exists():
            raise Refusal(f"the Aide commit {commit} has no core/{needed}")
    runner_parts = [core / "scripts" / "aide-run-spec", *sorted((core / "scripts" / "lib").rglob("*.sh"))]
    if not any(re.search(r"--worktree-base\)", p.read_text(errors="replace")) for p in runner_parts):
        raise Refusal(f"the runner of the Aide commit {commit} does not take --worktree-base, so its worktrees would go "
                      "under the board's own folder")
    return core, sha


def copy_skills(core, dest, skip=()):
    for skill in sorted((core / "skills").iterdir()):
        if skill.is_dir() and skill.name not in skip:
            shutil.copytree(skill, Path(dest) / "skills" / skill.name)


def tool_environment(core, tool, tools_dir, home):
    """Set up the configuration folder `tool` reads its skills from, filled from the Aide commit the way its installer
    lays them out, and return the environment that points the CLI at it."""
    folder = Path(tools_dir) / ("claude" if tool == "fake-claude" else tool)
    folder.mkdir(parents=True)
    if tool in ("claude", "fake-claude"):
        copy_skills(core, folder, skip=("spec-structure",))
        installer = core / "implementations" / "claude-code" / "install.sh"
        listed = re.search(r'^GENERIC_RULES="([^"]*)"', installer.read_text() if installer.exists() else "", re.M)
        rules = listed.group(1).split() if listed else [p.stem for p in sorted((core / "rules").glob("*.md"))]
        (folder / "rules").mkdir()
        for rule in rules:
            if (core / "rules" / f"{rule}.md").exists():
                shutil.copy(core / "rules" / f"{rule}.md", folder / "rules")
        return {"CLAUDE_CONFIG_DIR": str(folder)}
    if tool == "codex":
        copy_skills(core, folder)
        if (core / "AGENTS.md").exists():
            shutil.copy(core / "AGENTS.md", folder / "AGENTS.md")
        login = Path(home) / ".codex" / "auth.json"
        if login.exists():  # a link, not a copy: a refreshed token is written back in place
            (folder / "auth.json").symlink_to(login)
        # Codex lists ~/.agents/skills whatever CODEX_HOME says, so each installed skill is switched off
        installed = sorted((Path(home) / ".agents" / "skills").glob("*/SKILL.md"))
        (folder / "config.toml").write_text("".join(
            f"[[skills.config]]\npath = {json.dumps(str(p))}\nenabled = false\n\n" for p in installed))
        return {"CODEX_HOME": str(folder)}
    copy_skills(core, folder)
    return {"OPENCODE_CONFIG_DIR": str(folder), "OPENCODE_DISABLE_EXTERNAL_SKILLS": "1"}


def default_branch(repo):
    """The default branch's ref: `origin/HEAD`'s, else `main` or `master`, else what is checked out. A branch that
    exists only on the remote is returned as `origin/<name>`."""
    named = git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD", check=False)
    name = re.sub("^origin/", "", named) if named else None
    for candidate in ([name] if name else []) + ["main", "master"]:
        for ref in (candidate, f"origin/{candidate}"):
            if git(repo, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}", check=False):
                return ref
    return git(repo, "symbolic-ref", "--short", "HEAD")


def manifest_value(project_dir, key):
    path = Path(project_dir) / ".aide" / "project.yaml"
    found = re.search(rf"^{re.escape(key)}:[ \t]*(.*?)[ \t]*$", path.read_text() if path.exists() else "", re.M)
    return found.group(1).strip("'\"") if found else ""


def set_identity(repo):
    for key, value in LOCAL_IDENTITY.items():
        git(str(repo), "config", key, value)


def code_copy(code, branch, before, dest):
    """A clone of the code checkout with `branch` at `before`, no remote and none of the history after it."""
    subprocess.run(["git", "clone", "--quiet", str(code), str(dest)], check=True, capture_output=True)
    dest = str(dest)
    git(dest, "checkout", "--quiet", "-B", branch, before)
    git(dest, "remote", "remove", "origin")
    for ref in (git(dest, "for-each-ref", "--format=%(refname)", "refs/heads", "refs/tags") or "").splitlines():
        if ref != f"refs/heads/{branch}":
            git(dest, "update-ref", "-d", ref)
    git(dest, "reflog", "expire", "--expire=now", "--all")
    git(dest, "gc", "--quiet", "--prune=now")
    set_identity(dest)
    checkout_manifest = Path(code) / ".aide" / "project.yaml"
    if checkout_manifest.exists() and not (Path(dest) / ".aide" / "project.yaml").exists():
        (Path(dest) / ".aide").mkdir(exist_ok=True)
        shutil.copy(checkout_manifest, Path(dest) / ".aide" / "project.yaml")
    link_worktree_paths(code, dest)
    return dest


def link_worktree_paths(code, dest, manifest_dir=None):
    """Each path the manifest's `worktreeLinks` names, linked to the checkout's own, as the board's worktrees are."""
    for rel in re.split(r"[\s,]+", manifest_value(manifest_dir or dest, "worktreeLinks")):
        source, target = Path(code) / rel, Path(dest) / rel
        if rel and os.path.lexists(source) and not os.path.lexists(target):
            target.parent.mkdir(parents=True, exist_ok=True)
            target.symlink_to(source)


def dependency_folders(description, specs_root):
    """The folder of each spec the description's `Depends on:` line names, as it is under the real specs root."""
    line = re.search(r"^[ \t]*-[ \t]*\*\*Depends on:\*\*[ \t]*(.*)$", description, re.M)
    folders = []
    for dep in (d.strip(" `\t") for d in (line.group(1).split(",") if line else [])):
        taken = [p.name for base in (Path(specs_root), Path(specs_root) / "archive") if base.is_dir()
                 for p in base.iterdir() if p.is_dir() and (p.name == dep or p.name.startswith(f"{dep}-"))]
        if dep:
            folders.append(taken[0] if taken else dep)
    return folders


def specs_copy(archived, folder, project, dest, core, specs_root):
    """A specs repository holding the spec's archived description, the other files fresh from the commit's
    templates, and an empty folder for each spec it depends on. Returns the project's folder inside it."""
    subprocess.run(["git", "init", "--quiet", "-b", "main", str(dest)], check=True)
    set_identity(dest)
    root = Path(dest) / project
    (root / folder).mkdir(parents=True)
    for name in ("0-README.md", "1-description.md"):
        shutil.copyfile(Path(archived) / name, root / folder / name)
    reset = subprocess.run(["bash", str(core / "scripts" / "aide-reset-spec"), "--specs-root", str(root), "--spec", folder],
                           capture_output=True, text=True)
    if reset.returncode != 0:
        raise CannotReplay(f"the templates of the Aide commit could not be written: {reset.stdout.strip() or reset.stderr.strip()}")
    description = (root / folder / "1-description.md").read_text()
    for dep in dependency_folders(description, specs_root):
        (root / "archive" / dep).mkdir(parents=True, exist_ok=True)
    git(str(dest), "add", "-A")
    git(str(dest), "commit", "--quiet", "-m", f"Run /aide-create for {folder}")
    return str(root)
