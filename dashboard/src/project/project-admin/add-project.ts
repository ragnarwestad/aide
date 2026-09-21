// Clone or register a project under the projects root, keep its
// settings in the dashboard's own file, and point it at its specs root
// if one was named.

import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { GitRunner } from "../../git/branch-status.ts";
import { dashboardCheckoutRoot, dashboardProjectsRoot, dashboardSettingsFile } from "../../git/dashboard-checkout.ts";
import {
  minimalManifest,
  projectNameError,
  worktreeLinksError,
  writeAideConfig,
} from "./manifest-io.ts";
import { assessProjectReadiness } from "./readiness.ts";
import { applySettingsEdits, manifestTracked, seedSettingsFile } from "./settings-state.ts";
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

/** Where a cloned project's files go. On a host whose projects root is
 *  the dashboard's own directory of links, the clone IS the dashboard's
 *  checkout and the projects root gets a link to it — one copy, read and
 *  written by the same server. Anywhere else the projects root holds the
 *  checkouts people edit, and the clone goes straight into it. */
function cloneDestination(projectsRoot: string, name: string, checkoutBase?: string): string {
  if (checkoutBase && resolve(projectsRoot) === resolve(dashboardProjectsRoot(checkoutBase))) {
    return dashboardCheckoutRoot(checkoutBase, name);
  }
  return join(projectsRoot, name);
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
  checkoutBase?: string,
): Promise<ProjectAdminResult> {
  const gitUrl = req.gitUrl?.trim();
  const name = req.name?.trim() ?? "";
  const nameError = projectNameError(name);
  if (nameError) return fail("name", nameError);
  // The one way in. A project used to be addable by naming a directory
  // already on the host, and the two layouts that left behind are what
  // made a delete in `ensureDashboardCheckout` destroy woodstack on
  // 2026-09-21: for a cloned project the entry under the projects root
  // IS the dashboard's own checkout, for a registered one it was the
  // person's, and one line could not be right about both. One layout
  // now: every project is cloned, and the entry is always the
  // dashboard's own.
  if (!gitUrl) {
    return fail("name", "say where the project comes from: its git address, which the dashboard clones");
  }

  // Asked, never defaulted: whether code is reviewed before it lands is
  // how a team works. Refused here, before anything is cloned.
  const landing = (req.codeLanding ?? "").trim();
  if (!landing) {
    return fail("codeLanding", "choose how code lands: merge into the main branch, or a pull request");
  }

  const steps: ProjectStep[] = [{ step: "name", ok: true }];
  const dir = join(projectsRoot, name);
  const done = (): ProjectAdminResult => ({ ok: steps.every((s) => s.ok), steps });
  const stop = (step: ProjectStepName, error: string): ProjectAdminResult => {
    steps.push({ step, ok: false, error });
    return done();
  };

  {
    // Before the clone, never after: git would refuse a non-empty
    // destination anyway, but not in words anybody wants to read, and
    // an empty one it would happily fill.
    if (existsSync(dir)) {
      return stop("clone", `"${name}" is already a directory under the projects root`);
    }
    const dest = cloneDestination(projectsRoot, name, checkoutBase);
    // A checkout the dashboard already made (install-serve clones its
    // own) is linked, not cloned a second time.
    const alreadyCloned = dest !== dir && existsSync(join(dest, ".git"));
    if (!alreadyCloned) mkdirSync(dirname(dest), { recursive: true });
    // `-c credential.helper=` on THIS call only, never on the runner:
    // the same runner polls, pulls and merges every already-added
    // project, and one holding an HTTPS token needs its helper for all
    // of those. Here there is nobody to ask, so git must fail instead.
    const cloned = alreadyCloned
      ? { code: 0, stdout: "" }
      : await run(dirname(dest), ["-c", "credential.helper=", "clone", gitUrl, basename(dest)]);
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
    if (dest !== dir) {
      try {
        symlinkSync(dest, dir);
      } catch (err) {
        return stop("clone", `could not link ${dir} to ${dest}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    steps.push({ step: "clone", ok: true });
  }

  // A project keeps nothing of Aide's in its repository. What Add would
  // have written into the checkout goes to the dashboard's own settings
  // file instead, and a manifest the checkout already has — tracked or
  // not — is never written to: an untracked one only seeds the settings
  // file, so what somebody drafted with `/aide-manifest` is not lost.
  const own = join(dir, ".aide", "project.yaml");
  const settingsFile = checkoutBase ? dashboardSettingsFile(checkoutBase, name) : null;
  // Only a yes counts as tracked. A git that cannot say (the directory is
  // no repository, which the readiness check reports by name) leaves the
  // settings file as the place to write: nothing here touches the
  // project's own files either way.
  const tracked = (await manifestTracked(run, dir)).tracked === true;
  try {
    if (tracked) {
      steps.push({
        step: "manifest",
        ok: true,
        note: "the project's own manifest (.aide/project.yaml) is used — change its worktree links and code landing there",
      });
    } else if (!settingsFile) {
      steps.push({ step: "manifest", ok: true, note: "no dashboard checkout root is set, so no settings are kept for it" });
    } else {
      const existed = existsSync(settingsFile);
      seedSettingsFile(settingsFile, [own], minimalManifest(name, req.description));
      steps.push({
        step: "manifest",
        ok: true,
        note: existed
          ? "kept the settings the dashboard already holds for it"
          : `the dashboard keeps its settings in ${settingsFile}, not in the project — run /aide-manifest to fill in the rest`,
      });
    }
  } catch (err) {
    return stop("manifest", `could not write ${settingsFile}: ${err instanceof Error ? err.message : String(err)}`);
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
  const settingsEdits = !tracked && settingsFile;
  if (links && settingsEdits) {
    try {
      applySettingsEdits(settingsFile, [{ key: "worktreeLinks", value: links }], [own]);
      steps.push({ step: "worktreeLinks", ok: true });
    } catch (err) {
      return stop("worktreeLinks", `could not write ${settingsFile}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Only `pr` is written: `merge` is what an absent key already means,
  // and the same `wanted` rule the project page's own save follows
  // (`update-settings.ts`). Refused before it is written, for the
  // reason that file gives: a manifest every reader will reject is
  // worse than one never written.
  if (landing !== "merge") {
    if (landing !== "pr") {
      return stop("codeLanding", `code landing must be merge or pr — not "${landing}"`);
    }
    if (settingsEdits) {
      try {
        applySettingsEdits(settingsFile, [{ key: "codeLanding", value: landing }], [own]);
        steps.push({ step: "codeLanding", ok: true });
      } catch (err) {
        return stop("codeLanding", `could not write ${settingsFile}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Last, and only once every file this add writes is on disk: the
  // `.aide/config` written a moment ago names the specs root the
  // assessment goes looking for, and an assessment taken before it
  // would report a project unable to run over a path this very call
  // had just configured.
  return { ...done(), readiness: await assessProjectReadiness(run, dir, undefined, !tracked && settingsFile && existsSync(settingsFile) ? settingsFile : undefined) };
}
