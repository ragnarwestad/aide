// Clone or register a project under the projects root, give it a
// manifest if it has none, and point it at its specs root if one was
// named.

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { GitRunner } from "../../git/branch-status.ts";
import {
  addProjectTarget,
  minimalManifest,
  projectNameError,
  upsertManifestScalar,
  worktreeLinksError,
  writeAideConfig,
} from "./manifest-io.ts";
import { assessProjectReadiness } from "./readiness.ts";
import { fail, type AddProjectRequest, type ProjectAdminResult, type ProjectStep, type ProjectStepName } from "./types.ts";

/** Whether a failed clone's stderr is git giving up on a login nobody
 *  was going to answer, rather than any other reason a clone fails.
 *
 *  Spec 183: `-c credential.helper=` on the clone call, plus the
 *  `GIT_TERMINAL_PROMPT=0` `createGitRunner` already sets, leave git no
 *  way at all to get credentials — so it fails in seconds with its own
 *  wording rather than handing the question to a helper that waits for
 *  a person who is not there. Several phrasings are read because the
 *  remote gets a say too (GitLab answers a bad token in its own words);
 *  one that is missed degrades to the generic message below, which is
 *  what every non-credentials failure gets anyway. */
function needsAuthentication(stderr: string): boolean {
  const said = stderr.toLowerCase();
  return (
    said.includes("terminal prompts disabled") ||
    said.includes("could not read username") ||
    said.includes("could not read password") ||
    said.includes("authentication failed") ||
    said.includes("http basic: access denied")
  );
}

/** The SSH form of an HTTPS clone address, for the reader to copy — the
 *  request's own address is never rewritten (spec 183: someone using
 *  HTTPS with a token is doing it on purpose). `null` when there is
 *  nothing to derive it from, and the message then names the problem
 *  without an example rather than guessing at one. */
function sshEquivalent(gitUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(gitUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const path = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!path) return null;
  return `git@${parsed.host}:${path}${path.endsWith(".git") ? "" : ".git"}`;
}

/** Clone or register a project under `projectsRoot`, give it a manifest
 *  if it has none, and point it at its specs root if one was named.
 *
 *  `run` is injected for the same reason every other git call in this
 *  codebase injects it: a test spawns no subprocess, and a failure is a
 *  value rather than an exception to be guessed at. The clone runs with
 *  `cwd` set to the projects root and the name as the destination
 *  argument — the destination does not exist yet, which is what makes
 *  this the one git call here that cannot run inside its own directory,
 *  and what keeps the destination from resolving outside the root. */
export async function addProject(
  run: GitRunner,
  projectsRoot: string,
  req: AddProjectRequest,
): Promise<ProjectAdminResult> {
  const gitUrl = req.gitUrl?.trim();
  const { name, existingPath } = addProjectTarget(projectsRoot, req);
  const nameError = projectNameError(name);
  if (nameError) return fail("name", nameError);
  if (!gitUrl && !existingPath) {
    return fail("name", "say where the project comes from: a git URL, or a path already on this host");
  }
  if (gitUrl && existingPath) {
    return fail("name", "give a git URL or a path already on this host, not both");
  }

  const steps: ProjectStep[] = [{ step: "name", ok: true }];
  const dir = join(projectsRoot, name);
  const done = (): ProjectAdminResult => ({ ok: steps.every((s) => s.ok), steps });
  const stop = (step: ProjectStepName, error: string): ProjectAdminResult => {
    steps.push({ step, ok: false, error });
    return done();
  };

  if (gitUrl) {
    // Before the clone, never after: git would refuse a non-empty
    // destination anyway, but not in words anybody wants to read, and
    // an empty one it would happily fill.
    if (existsSync(dir)) {
      return stop("clone", `"${name}" is already a directory under the projects root`);
    }
    // `-c credential.helper=` on THIS call only, never on the runner:
    // the same runner polls, pulls and merges every already-added
    // project, and one holding an HTTPS token needs its helper for all
    // of those. Here there is nobody to ask, so git must fail instead.
    const cloned = await run(projectsRoot, ["-c", "credential.helper=", "clone", gitUrl, name]);
    if (cloned.code !== 0) {
      const said = (cloned.stderr ?? "").trim() || (cloned.stdout ?? "").trim();
      if (needsAuthentication(said)) {
        const ssh = sshEquivalent(gitUrl);
        return stop(
          "clone",
          "the repository needs credentials this machine cannot supply without being asked — " +
            "use its SSH address instead, which a key answers with nobody there" +
            (ssh ? `: ${ssh}` : ""),
        );
      }
      return stop("clone", `the clone failed (exit ${cloned.code})${said ? `: ${said.slice(-200)}` : ""}`);
    }
    steps.push({ step: "clone", ok: true });
  } else {
    // A project is discovered as a DIRECTORY under the projects root
    // (`discover.ts`), so a checkout anywhere else is one this dashboard
    // could never list. Said in those words rather than silently
    // registering something invisible.
    if (resolve(existingPath!) !== resolve(dir)) {
      return stop(
        "register",
        `a project is found as a directory under ${projectsRoot}, so "${name}" has to be ` +
          `${dir} — not ${existingPath}`,
      );
    }
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      return stop("register", `there is no directory at ${dir}`);
    }
    steps.push({ step: "register", ok: true });
  }

  // Never clobbered: an operator may well be registering a checkout
  // that already has a full manifest from `/aide-manifest`.
  const manifest = join(dir, ".aide", "project.yaml");
  try {
    if (existsSync(manifest)) {
      steps.push({ step: "manifest", ok: true, note: "kept the .aide/project.yaml already there" });
    } else {
      mkdirSync(join(dir, ".aide"), { recursive: true });
      writeFileSync(manifest, minimalManifest(name, req.description));
      steps.push({
        step: "manifest",
        ok: true,
        note: "wrote a minimal .aide/project.yaml — name and description only; run /aide-manifest to fill in the rest",
      });
    }
  } catch (err) {
    return stop("manifest", `could not write ${manifest}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Both keys go into the one file, and an unusable links value is
  // refused BEFORE it is written: a config the runner will refuse to
  // read is worse than no config, and the reader is standing at the
  // form that produced it.
  const links = req.worktreeLinks?.trim();
  if (links) {
    const linkError = worktreeLinksError(links);
    if (linkError) return stop("worktreeLinks", linkError);
  }
  /** What became of the specs root, when there was something to say
   *  about it: made here, or not makeable. */
  let specsNote: string | undefined;
  // A specs root that is not there yet is MADE, with the `archive/`
  // beside it a run walks (spec 140): the form used to write the path
  // into `.aide/config` and then report the project as unable to run
  // because there is no such directory — a refusal over a path known at
  // the moment it was written. `mkdirSync` is idempotent with
  // `recursive`, so an existing specs root is left exactly as it is.
  // A creation that FAILS is not a refusal of the add: the readiness
  // check below reads the real state of that path and says so.
  if (req.specsPath) {
    const made = !existsSync(req.specsPath);
    try {
      mkdirSync(join(req.specsPath, "archive"), { recursive: true });
      if (made) specsNote = `made the specs root at ${req.specsPath}, with its archive/`;
    } catch (err) {
      specsNote = `could not make ${req.specsPath}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  // The two keys part company here (spec 184). The specs path names a
  // directory on THIS machine and stays in the personal, gitignored
  // `.aide/config`; the worktree links are true of the project wherever
  // it is checked out, so they go in the manifest, which is committed
  // and arrives with the clone.
  if (req.specsPath) {
    try {
      writeAideConfig(dir, { AIDE_SPECS_PATH: req.specsPath });
      steps.push({ step: "specsConfig", ok: true, ...(specsNote ? { note: specsNote } : {}) });
    } catch (err) {
      return stop("specsConfig", `could not write .aide/config: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (links) {
    try {
      upsertManifestScalar(manifest, "worktreeLinks", links);
      steps.push({ step: "worktreeLinks", ok: true });
    } catch (err) {
      return stop("worktreeLinks", `could not write ${manifest}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Last, and only once every file this add writes is on disk: the
  // `.aide/config` written a moment ago names the specs root the
  // assessment goes looking for, and an assessment taken before it
  // would report a project unable to run over a path this very call
  // had just configured.
  return { ...done(), readiness: await assessProjectReadiness(run, dir) };
}
