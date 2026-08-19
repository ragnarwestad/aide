// Spec 112: what adding a project to this dashboard actually IS, as
// filesystem work. Adding one used to be four hand steps on the serving
// host — clone the repo under the projects root, give it a manifest,
// name it in the queue's allowlist, and point it at its specs root —
// undocumented as a sequence and done by hand for Atlasaurus on
// 2026-08-18.
//
// Three of those four are here. The fourth, the allowlist, belongs to
// the server: it is a live `Set` the routes mutate and persist
// (`serve.ts`, `queue.ts`), and this file has no business knowing where
// it is kept. What it DOES know is reported in the same per-step shape
// the merge route answers in (`RepoMergeResult[]`), so the page's own
// refusal code renders an Add exactly as it renders a merge.
//
// Every step is reported, and the first failure stops the rest: a
// manifest written into a clone that did not happen is worse than no
// manifest at all.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stringify } from "yaml";
import type { GitRunner } from "./branch-status.ts";

/** The steps an add or a remove is made of. `name` is the request
 *  itself: a project name becomes a directory under the projects root
 *  AND an argument to `git clone`, so it is checked before anything
 *  else runs — a refusal that happens after the clone is not a refusal.
 *  `clone` and `register` are the two ways a checkout gets here, and
 *  exactly one of them appears in any one answer. */
export type ProjectStepName =
  | "name"
  | "clone"
  | "register"
  | "manifest"
  | "specsConfig"
  | "allowlist"
  | "confirm";

export interface ProjectStep {
  step: ProjectStepName;
  ok: boolean;
  error?: string;
  /** Something that went RIGHT and the operator still has to know —
   *  today only "a manifest had to be made, so `/aide-manifest` still
   *  has a run to do". A note never makes the step fail. */
  note?: string;
}

export interface ProjectAdminResult {
  ok: boolean;
  steps: ProjectStep[];
}

export interface AddProjectRequest {
  name: string;
  /** Clone it from here. Mutually exclusive with `existingPath`. */
  gitUrl?: string;
  /** It is already on this machine, at this path. */
  existingPath?: string;
  description?: string;
  /** `AIDE_SPECS_PATH` for the project's own `.aide/config`. Omitted
   *  means the config is not written at all — `<project>/specs` is the
   *  fallback both readers already implement. */
  specsPath?: string;
}

/** A directory name, and nothing that could be read as a path. No
 *  separator, no `..`, no leading dot (a project directory the scan
 *  would find but nobody would see), and nothing that needs quoting on
 *  a command line. Deliberately narrower than "what a filesystem
 *  allows": every name that gets past this is one `discoverProjects`
 *  will list under its own basename. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Why this name cannot be a project, or `null`. Exported because the
 *  server validates the same way on both routes and a second copy of
 *  the rule would eventually disagree with this one. */
export function projectNameError(name: unknown): string | null {
  if (typeof name !== "string" || name.trim() === "") return "a project name is required";
  if (name.includes("..")) return `"${name}" is not a usable project name: it would leave the projects root`;
  if (!NAME_RE.test(name)) {
    return (
      `"${name}" is not a usable project name: letters, digits, dot, dash and ` +
      `underscore only, and it may not start with a dot`
    );
  }
  return null;
}

/** The manifest the Add flow writes when a checkout has none: `name`
 *  and `description`, which is the smallest manifest that renders
 *  USEFULLY rather than the smallest that avoids an error
 *  (`render/site.ts` shows a description and nothing else without one).
 *  Everything past those two is `/aide-manifest`'s job, and the form
 *  says so. Serialized by the same `yaml` package that reads it back,
 *  so nobody here has to get quoting right on a description's behalf. */
export function minimalManifest(name: string, description?: string): string {
  return stringify({ name, ...(description ? { description } : {}) });
}

/** `AIDE_SPECS_PATH` into the project's own `.aide/config`, in the
 *  plain `KEY=value` form both readers expect (`discover.ts`'s
 *  `configValue` and the shell's `aide_specs_root`). The file is
 *  personal and may already carry other keys — `AIDE_INSTALL_CMD`,
 *  `AIDE_WORKTREE_LINKS` — so it is rewritten line by line with only
 *  this key replaced. Two lines for one key is a file whose meaning
 *  depends on which reader you ask. */
export function writeSpecsPathConfig(projectDir: string, specsPath: string): void {
  const dir = join(projectDir, ".aide");
  const file = join(dir, "config");
  const kept = existsSync(file)
    ? readFileSync(file, "utf-8")
        .split("\n")
        .filter((line) => line.split("=")[0] !== "AIDE_SPECS_PATH")
    : [];
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  kept.push(`AIDE_SPECS_PATH=${specsPath}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${kept.join("\n")}\n`);
}

const fail = (step: ProjectStepName, error: string): ProjectAdminResult => ({
  ok: false,
  steps: [{ step, ok: false, error }],
});

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
  const nameError = projectNameError(req.name);
  if (nameError) return fail("name", nameError);
  const gitUrl = req.gitUrl?.trim();
  const existingPath = req.existingPath?.trim();
  if (!gitUrl && !existingPath) {
    return fail("name", "say where the project comes from: a git URL, or a path already on this host");
  }
  if (gitUrl && existingPath) {
    return fail("name", "give a git URL or a path already on this host, not both");
  }

  const steps: ProjectStep[] = [{ step: "name", ok: true }];
  const dir = join(projectsRoot, req.name);
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
      return stop("clone", `"${req.name}" is already a directory under the projects root`);
    }
    const cloned = await run(projectsRoot, ["clone", gitUrl, req.name]);
    if (cloned.code !== 0) {
      const said = (cloned.stderr ?? "").trim() || (cloned.stdout ?? "").trim();
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
        `a project is found as a directory under ${projectsRoot}, so "${req.name}" has to be ` +
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
      writeFileSync(manifest, minimalManifest(req.name, req.description));
      steps.push({
        step: "manifest",
        ok: true,
        note: "wrote a minimal .aide/project.yaml — name and description only; run /aide-manifest to fill in the rest",
      });
    }
  } catch (err) {
    return stop("manifest", `could not write ${manifest}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (req.specsPath) {
    try {
      writeSpecsPathConfig(dir, req.specsPath);
      steps.push({ step: "specsConfig", ok: true });
    } catch (err) {
      return stop(
        "specsConfig",
        `could not write .aide/config: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return done();
}

/** Take a project off the allowlist, and do nothing else at all.
 *
 *  Removal must never delete a repo or a specs root — so this function
 *  touches no filesystem, and there is nothing in it that could. The
 *  name has to be typed back exactly: a click alone is not a deliberate
 *  enough act for something that takes a project off the dashboard, and
 *  the browser's own match-check is a convenience over this, not a
 *  substitute for it. Persisting the result is the caller's, for the
 *  same reason `addProject` does not do it: the allowlist lives in the
 *  server's own `Set`, which is the single source of truth every
 *  request is filtered against. */
export function removeProject(
  allowed: Set<string>,
  req: { name: string; confirm: unknown },
): ProjectAdminResult {
  if (typeof req.confirm !== "string" || req.confirm !== req.name) {
    return fail("confirm", `type the project's name exactly — "${req.name}" — to remove it`);
  }
  const steps: ProjectStep[] = [{ step: "confirm", ok: true }];
  if (!allowed.has(req.name)) {
    steps.push({ step: "allowlist", ok: false, error: `"${req.name}" is not on the allowlist` });
    return { ok: false, steps };
  }
  allowed.delete(req.name);
  steps.push({ step: "allowlist", ok: true });
  return { ok: true, steps };
}
