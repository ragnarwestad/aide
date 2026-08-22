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
import { basename, join, resolve } from "node:path";
import { stringify } from "yaml";
import type { GitRunner } from "./branch-status.ts";
import { configValue } from "./discover.ts";

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
  | "worktreeLinks"
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

/** What a readiness check is ABOUT (spec 138). Each one mirrors a
 *  prerequisite `aide-run-spec` tests before it starts, and nothing
 *  else: a check the runner does not make would refuse a project that
 *  runs perfectly well. */
export type ReadinessCheckName =
  | "gitRoot"
  | "specsRoot"
  | "specsRepo"
  | "defaultBranch"
  | "worktreeLinks";

export interface ReadinessCheck {
  check: ReadinessCheckName;
  /** Which path this answer is about. `defaultBranch` is asked of
   *  EVERY participating repository — the project's and, when the specs
   *  live elsewhere, the specs repo's — so the name alone would not say
   *  which repo answered. */
  subject: string;
  /** Whether the check passed. */
  ok: boolean;
  /** Whether this answer stops a run. Only ever true where `ok` is
   *  false, and false for the answers that are worth SAYING without
   *  being wrong: a checkout on a feature branch (the run moves it),
   *  or no worktree links configured (most projects need none). */
  blocking: boolean;
  detail: string;
}

export interface ProjectReadiness {
  canRun: boolean;
  checks: ReadinessCheck[];
  /** The whole answer in one line, for the two places it is shown: the
   *  form's own slot with script, and the query string a no-JS redirect
   *  carries to `/projects`. Built here so both modes say the same
   *  words — a second copy in the browser code would be a second copy
   *  of the wording. */
  note: string;
}

export interface ProjectAdminResult {
  ok: boolean;
  steps: ProjectStep[];
  /** Whether a run could START in the project just added — a separate
   *  answer from `ok`, which says only that the registration completed
   *  (spec 138). Absent when there was no successful registration to
   *  assess, and on a removal, which registers nothing. */
  readiness?: ProjectReadiness;
}

export interface AddProjectRequest {
  name: string;
  /** Clone it from here. Mutually exclusive with `existingPath`. */
  gitUrl?: string;
  /** It is already on this machine: an absolute path, or — what the
   *  Add form's picker sends — the bare name of a directory directly
   *  under the projects root, which names the project too when `name`
   *  is left blank. Mutually exclusive with `gitUrl`. */
  existingPath?: string;
  description?: string;
  /** `AIDE_SPECS_PATH` for the project's own `.aide/config`. Omitted
   *  means the config is not written at all — `<project>/specs` is the
   *  fallback both readers already implement. */
  specsPath?: string;
  /** `AIDE_WORKTREE_LINKS`: the space-separated, repo-relative paths a
   *  run has to link into its worktree because git does not carry them
   *  — `node_modules`, `.venv`. Omitted means the key is not written:
   *  the dashboard cannot infer which gitignored paths a project's own
   *  test command needs, so it never invents one. */
  worktreeLinks?: string;
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

/** What an add is actually AIMED at, once the Add form's picker is
 *  allowed to settle it (spec 131): the project's name, and the path of
 *  the checkout to register.
 *
 *  A bare `existingPath` — no separator — is what the picker sends:
 *  shorthand for the checkout of that name directly under the projects
 *  root, and the project's NAME, whatever was typed into Name beside it
 *  (spec 140). A project's name is its directory name and can be
 *  nothing else: `discoverProjects` reads it off the entry under the
 *  projects root and never out of a manifest, so a project registered
 *  under a differing typed name could never be discovered again.
 *  Typing `Skjer` for the directory `skjer` used to be refused, in a
 *  message naming `<root>/Skjer` — a path that does not exist either.
 *  A typed Name settles the name where there is nothing picked: the
 *  git-clone path, where it is the directory about to be made. A full
 *  path, typed by hand or posted straight at the route, is used exactly
 *  as before, mismatch refusal and all — that is not the picker.
 *
 *  Exported for the same reason `projectNameError` is: the route needs
 *  the DERIVED name — it is what goes on the allowlist — and a second
 *  copy of this rule in `serve.ts` would eventually disagree with this
 *  one. */
export function addProjectTarget(
  projectsRoot: string,
  req: Pick<AddProjectRequest, "name" | "existingPath">,
): { name: string; existingPath?: string } {
  const raw = req.existingPath?.trim();
  const bare = raw && !raw.includes("/") ? raw : undefined;
  return {
    name: bare || req.name?.trim() || "",
    existingPath: raw ? (bare ? join(projectsRoot, bare) : raw) : undefined,
  };
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

/** Keys into the project's own `.aide/config`, in the plain `KEY=value`
 *  form every reader expects (`discover.ts`'s `configValue` and the
 *  shell's `aide_specs_root` and `aide_config_get`). The file is
 *  personal and may already carry other keys — `AIDE_INSTALL_CMD` — and
 *  comments, so it is rewritten line by line with only the named keys
 *  replaced. Two lines for one key is a file whose meaning depends on
 *  which reader you ask.
 *
 *  One writer for every key rather than one per key (spec 138): the
 *  specs root and the worktree links land in the same file, and a
 *  second copy of this rule would eventually preserve a comment the
 *  first one dropped. */
export function writeAideConfig(projectDir: string, values: Record<string, string>): void {
  const dir = join(projectDir, ".aide");
  const file = join(dir, "config");
  const keys = Object.keys(values);
  const kept = existsSync(file)
    ? readFileSync(file, "utf-8")
        .split("\n")
        .filter((line) => !keys.includes(line.split("=")[0]!))
    : [];
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  for (const key of keys) kept.push(`${key}=${values[key]}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${kept.join("\n")}\n`);
}

/** Directory names a build WRITES into, or that a tool locks a cache in
 *  — never a dependency cache a build only reads (spec 186). A link is
 *  one symlink into the main checkout that every concurrent run shares,
 *  so two runs building through it overwrite each other's output, and a
 *  tool that locks its own cache directory blocks or corrupts it. Kept
 *  as a plain array for the same reason WORKFLOW_STEPS and
 *  DEPENDENCY_GATED_STEPS are: `aide-run-spec` holds a second copy
 *  (WORKTREE_LINK_DENYLIST, a bash string) with no shared source
 *  between them, and
 *  test_the_two_copies_of_the_worktree_link_denylist_agree pins the two. */
export const WORKTREE_LINK_DENYLIST = ["build", "target", "dist", ".gradle"] as const;

/** Why this `AIDE_WORKTREE_LINKS` value cannot be used, or `null`.
 *
 *  The same rule `aide-run-spec` refuses on, in the same words: a
 *  worktree carries TRACKED files only, so each entry is a path
 *  RELATIVE to the repository root that the run symlinks in from the
 *  main checkout. An absolute path or one containing `..` names
 *  something outside the repo, which the run refuses by name rather
 *  than link. Exported because the readiness check and the write path
 *  ask the same question. */
export function worktreeLinksError(value: string): string | null {
  for (const entry of value.split(/\s+/).filter(Boolean)) {
    if (entry.startsWith("/")) {
      return `AIDE_WORKTREE_LINKS must name repo-relative paths: ${entry}`;
    }
    if (entry.includes("..")) {
      return `AIDE_WORKTREE_LINKS must not escape the root: ${entry}`;
    }
    // The BASENAME, so a nested module's output (`backend/build`) is the
    // same answer as a top-level one — and asked before existence, since
    // a denied directory usually does exist: anyone who has run the
    // build locally has one.
    if ((WORKTREE_LINK_DENYLIST as readonly string[]).includes(entry.split("/").pop()!)) {
      return (
        `AIDE_WORKTREE_LINKS names a build output, not a dependency cache: ${entry} — ` +
        `such a directory is generated per worktree and wants no link at all`
      );
    }
  }
  return null;
}

// --- whether a run could start there (spec 138) -------------------------------
//
// Adding a project said "added" and nothing more, and the things that
// decide whether `aide-run-spec` will START were invisible until Run was
// pressed and the run refused. Skjer, 2026-08-20: on the allowlist,
// checkout where the form said, minimal manifest written — and refused,
// because the checkout stood on a feature branch whose upstream was
// gone, no specs root had been named, and no worktree links were set.
// (Its untracked `.aide/` refused it a fourth time that day. Spec 144
// took that refusal out of the runner, so this file no longer asks
// about it either — see the `ReadinessCheckName` union.)
//
// So the same prerequisites are read HERE, and only those: every check
// below mirrors a refusal in `core/scripts/aide-run-spec`, in its order
// and by its rule. Nothing here mutates anything — no branch is
// switched, no directory made, no file committed — which is also why
// the answer can go stale: a repository resolvable at Add is one
// someone can leave mid-rebase before Run. That is true of any
// preflight check and is said in the README rather than defended
// against here.

/** `git -C dir <args>`, trimmed, or `null` when git refused. */
async function gitSays(run: GitRunner, dir: string, args: string[]): Promise<string | null> {
  const r = await run(dir, args);
  return r.code === 0 ? (r.stdout ?? "").trim() : null;
}

/** The runner's own resolution order (`default_branch()`): origin/HEAD,
 *  then a local `main`, then a local `master`, and failing all three the
 *  branch that is checked out — which makes the switch a no-op. */
async function defaultBranchOf(run: GitRunner, root: string): Promise<string> {
  const head = await gitSays(run, root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head) return head.replace(/^origin\//, "");
  for (const candidate of ["main", "master"]) {
    const r = await run(root, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]);
    if (r.code === 0) return candidate;
  }
  return (await gitSays(run, root, ["rev-parse", "--abbrev-ref", "HEAD"])) ?? "";
}

/** Which OTHER worktree has `branch` checked out, if any. `git switch`
 *  refuses a branch a second worktree holds ("fatal: '…' is already
 *  used by worktree at …"), and that refusal is the runner's. */
async function branchHeldElsewhere(
  run: GitRunner,
  root: string,
  branch: string,
): Promise<string | null> {
  const listed = await gitSays(run, root, ["worktree", "list", "--porcelain"]);
  if (!listed) return null;
  let at = "";
  for (const line of listed.split("\n")) {
    if (line.startsWith("worktree ")) at = line.slice("worktree ".length).trim();
    else if (line.trim() === `branch refs/heads/${branch}` && resolve(at) !== resolve(root)) return at;
  }
  return null;
}

/** The question asked of EVERY participating repository, because the
 *  runner asks it of every root it touches: can the checkout be put on
 *  its default branch. Whether the tree is CLEAN was the second such
 *  question until spec 144, and is asked nowhere now — a run reads
 *  origin's default branch into a worktree of its own, so what sits
 *  uncommitted here decides nothing. */
async function repoChecks(run: GitRunner, root: string, label: string): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];
  const base = await defaultBranchOf(run, root);
  const current = (await gitSays(run, root, ["rev-parse", "--abbrev-ref", "HEAD"])) ?? "";
  if (!base) {
    checks.push({
      check: "defaultBranch",
      subject: root,
      ok: false,
      blocking: true,
      detail: `the default branch of the ${label} repository at ${root} cannot be worked out`,
    });
    return checks;
  }
  if (current === base) {
    checks.push({
      check: "defaultBranch",
      subject: root,
      ok: true,
      blocking: false,
      detail: `the ${label} checkout is on ${base}`,
    });
    return checks;
  }
  // A branch git can reach is one it can switch to: either it is there
  // as a local branch, or `git switch` creates it from the identically
  // named remote-tracking ref, which is what the runner relies on. Both
  // missing is the case that refuses — a dangling origin/HEAD, the
  // state Skjer's checkout was in.
  const local = (await run(root, ["show-ref", "--verify", "--quiet", `refs/heads/${base}`])).code === 0;
  const remote =
    (await run(root, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${base}`])).code === 0;
  if (!local && !remote) {
    checks.push({
      check: "defaultBranch",
      subject: root,
      ok: false,
      blocking: true,
      detail: `the ${label} checkout is on ${current}, and a run cannot move it to ${base}: there is no such branch, here or on origin`,
    });
    return checks;
  }
  const held = await branchHeldElsewhere(run, root, base);
  checks.push(
    held
      ? {
          check: "defaultBranch",
          subject: root,
          ok: false,
          blocking: true,
          detail: `the ${label} checkout is on ${current}, and a run cannot move it to ${base}: another worktree has ${base} checked out at ${held}`,
        }
      : {
          // Worth saying and nothing more: the runner puts a clean
          // checkout on its default branch itself, and leaves it there.
          check: "defaultBranch",
          subject: root,
          ok: false,
          blocking: false,
          detail: `the ${label} checkout is on ${current}, not ${base} — a run moves it to ${base} first`,
        },
  );
  return checks;
}

/** The one-line answer both browser modes show. */
function readinessNote(project: string, canRun: boolean, checks: ReadinessCheck[]): string {
  const head = canRun ? `${project} added — ready to run` : `${project} added — cannot run yet`;
  const said = [
    ...checks.filter((c) => c.blocking).map((c) => c.detail),
    // The non-blocking answers that still deviate from "nothing to
    // report": the feature branch, the unset worktree links. A check
    // that passed says nothing.
    ...checks.filter((c) => !c.blocking && !c.ok).map((c) => c.detail),
  ];
  return said.length ? `${head}: ${said.join("; ")}` : head;
}

/** Whether `aide-run-spec` would start in `projectDir`, read-only.
 *
 *  `run` is injected for the same reason every other git call in this
 *  file injects it: a test spawns no subprocess, and a failure is a
 *  value rather than an exception to be guessed at.
 *
 *  It took a `justWritten` list until spec 144 — the paths the caller
 *  had written a moment earlier, so the dirty-tree answer could say
 *  what to do about dirt the Add itself made. Nothing here asks about a
 *  dirty tree any more, so nothing here needs to know. */
export async function assessProjectReadiness(
  run: GitRunner,
  projectDir: string,
): Promise<ProjectReadiness> {
  const checks: ReadinessCheck[] = [];

  // 1. The project is its own repository. A directory INSIDE one
  //    resolves to the outer root, and a run would branch, commit and
  //    push that one — which is not the project anybody added.
  const top = await gitSays(run, projectDir, ["rev-parse", "--show-toplevel"]);
  const isRoot = top !== null && resolve(top) === resolve(projectDir);
  checks.push({
    check: "gitRoot",
    subject: projectDir,
    ok: isRoot,
    blocking: !isRoot,
    detail:
      top === null
        ? `${projectDir} is not a git repository, and every step of a run branches one`
        : isRoot
          ? `${projectDir} is its own git repository`
          : `${projectDir} is not a repository of its own — it is inside the one at ${top}, which is what a run would branch`,
  });
  const projectRoot = isRoot ? projectDir : top || projectDir;

  // 2. The specs root, configured or fallen back to, has to EXIST: the
  //    runner refuses "no specs root at …" before anything else.
  const configured = configValue(projectDir, "AIDE_SPECS_PATH");
  const specsRoot = configured ?? join(projectDir, "specs");
  const specsThere = existsSync(specsRoot) && statSync(specsRoot).isDirectory();
  checks.push({
    check: "specsRoot",
    subject: specsRoot,
    ok: specsThere,
    blocking: !specsThere,
    detail: specsThere
      ? `the specs live at ${specsRoot}${configured ? "" : " (its own specs/, because no specs root was given)"}`
      : configured
        ? `there is no specs root at ${specsRoot}, and a run refuses without one`
        : `no specs root was given, so a run looks for ${specsRoot} — and there is no such directory`,
  });

  const roots: { root: string; label: string }[] = [{ root: projectRoot, label: "project" }];
  if (specsThere) {
    // 3. And it has to be IN a repository: a run commits and pushes the
    //    spec it writes, and a specs root outside git is a run whose
    //    analysis nothing keeps.
    const specsTop = await gitSays(run, specsRoot, ["rev-parse", "--show-toplevel"]);
    checks.push({
      check: "specsRepo",
      subject: specsRoot,
      ok: specsTop !== null,
      blocking: specsTop === null,
      detail:
        specsTop === null
          ? `${specsRoot} is in no git repository, so nothing would commit the spec a run writes there`
          : resolve(specsTop) === resolve(projectRoot)
            ? `the specs are in the project's own repository`
            : `the specs are in the repository at ${specsTop}, which a run branches too`,
    });
    if (specsTop !== null && resolve(specsTop) !== resolve(projectRoot)) {
      roots.push({ root: specsTop, label: "specs" });
    }
  }

  // 4. A reachable default branch, for every repository the run would
  //    touch.
  for (const { root, label } of roots) {
    checks.push(...(await repoChecks(run, root, label)));
  }

  // 5. And the gitignored paths the project says its own commands need.
  //    A worktree carries tracked files only, so a configured entry with
  //    no source is a test command that will fail for a reason that has
  //    nothing to do with the change — the runner refuses it, and so
  //    does this.
  const links = configValue(projectDir, "AIDE_WORKTREE_LINKS") ?? "";
  const linkError = links ? worktreeLinksError(links) : null;
  const missing = links
    ? links.split(/\s+/).filter(Boolean).filter((e) => !existsSync(join(projectRoot, e)))
    : [];
  checks.push(
    !links
      ? {
          check: "worktreeLinks",
          subject: projectDir,
          // Not a failure: most projects need none, and the dashboard
          // cannot infer which gitignored paths a test command wants.
          // Said all the same, because it is silent otherwise.
          ok: false,
          blocking: false,
          detail:
            "no worktree links are configured — a run's worktree carries tracked files only, so name any gitignored path the project's own commands need (node_modules, .venv)",
        }
      : linkError
        ? { check: "worktreeLinks", subject: projectDir, ok: false, blocking: true, detail: linkError }
        : missing.length
          ? {
              check: "worktreeLinks",
              subject: projectDir,
              ok: false,
              blocking: true,
              detail: `a run refuses a worktree link with nothing to link: ${missing.map((e) => `${e} is not in ${projectRoot}`).join(", ")}`,
            }
          : {
              check: "worktreeLinks",
              subject: projectDir,
              ok: true,
              blocking: false,
              detail: `the worktree links are all there: ${links}`,
            },
  );

  const canRun = checks.every((c) => !c.blocking);
  return { canRun, checks, note: readinessNote(basename(projectDir), canRun, checks) };
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
    const cloned = await run(projectsRoot, ["clone", gitUrl, name]);
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
  if (req.specsPath || links) {
    try {
      writeAideConfig(dir, {
        ...(req.specsPath ? { AIDE_SPECS_PATH: req.specsPath } : {}),
        ...(links ? { AIDE_WORKTREE_LINKS: links } : {}),
      });
      if (req.specsPath) steps.push({ step: "specsConfig", ok: true, ...(specsNote ? { note: specsNote } : {}) });
      if (links) steps.push({ step: "worktreeLinks", ok: true });
    } catch (err) {
      return stop(
        req.specsPath ? "specsConfig" : "worktreeLinks",
        `could not write .aide/config: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Last, and only once every file this add writes is on disk: the
  // `.aide/config` written a moment ago names the specs root the
  // assessment goes looking for, and an assessment taken before it
  // would report a project unable to run over a path this very call
  // had just configured.
  return { ...done(), readiness: await assessProjectReadiness(run, dir) };
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
