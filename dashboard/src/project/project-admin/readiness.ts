// Whether a run could start there (spec 138), read-only.
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
//
// Split out of project-admin.ts (split project-admin.ts by theme).

import { existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { GitRunner } from "../../git/branch-status.ts";
import { configValue, resolveWorktreeLinks } from "../discover.ts";
import { worktreeLinksError } from "./manifest-io.ts";
import type { ProjectReadiness, ReadinessCheck } from "./types.ts";

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

/** The same question `repoChecks` asks, asked of the checkouts the
 *  dashboard owns (spec 205).
 *
 *  Two states, and only one of them is a refusal. A checkout that is
 *  already there answers for itself, exactly as the person's used to.
 *  One that has not been made yet cannot be asked anything — so what is
 *  asked instead is whether it can be MADE: every repository the run
 *  touches has to have an `origin` to clone from. That is the one thing
 *  a lazy clone cannot work around, and it belongs on the page rather
 *  than in a run that refuses with nobody there.
 *
 *  The person's own branch is not asked about at all. A run stopped
 *  moving that checkout, so what it is on decides nothing — the same
 *  reason spec 144 dropped the clean-tree question. */
async function dashboardCheckoutChecks(
  run: GitRunner,
  roots: { root: string; label: string }[],
  machineryDir: string,
): Promise<ReadinessCheck[]> {
  if (existsSync(join(machineryDir, ".git"))) {
    return repoChecks(run, machineryDir, "dashboard's own");
  }
  const checks: ReadinessCheck[] = [];
  for (const { root, label } of roots) {
    const origin = await gitSays(run, root, ["remote", "get-url", "origin"]);
    checks.push({
      check: "dashboardCheckout",
      subject: root,
      ok: origin !== null,
      // Worth SAYING and nothing more, the same shape as a checkout on
      // a feature branch. A project the dashboard cannot clone still
      // runs — it falls back to the checkout it was pointed at, exactly
      // as every project did before spec 205 — so refusing the run here
      // would take away something that works. What the reader needs to
      // know is that this project is the one where a run and their own
      // editing can still meet.
      blocking: false,
      detail:
        origin === null
          ? `the ${label} repository at ${root} has no origin remote, so the dashboard cannot make a checkout of its own — a run works in ${root} itself, where editing it meanwhile can collide`
          : `the dashboard makes its own checkout of the ${label} repository at ${machineryDir} the first time a run needs one`,
    });
  }
  return checks;
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
  machineryDir?: string,
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
  //    touch — and since spec 205 that means the checkouts the DASHBOARD
  //    owns, not the ones a person edits. Whichever checkout a run
  //    actually uses is the one asked; `machineryDir` is what names it,
  //    and a caller that names none is asking about `projectDir` itself,
  //    exactly as every caller did before that spec.
  if (machineryDir && resolve(machineryDir) !== resolve(projectDir)) {
    checks.push(...(await dashboardCheckoutChecks(run, roots, machineryDir)));
  } else {
    for (const { root, label } of roots) {
      checks.push(...(await repoChecks(run, root, label)));
    }
  }

  // 5. And the gitignored paths the project says its own commands need.
  //    A worktree carries tracked files only, so a configured entry with
  //    no source is a test command that will fail for a reason that has
  //    nothing to do with the change — the runner refuses it, and so
  //    does this.
  //    Read from the COMMITTED manifest first and `.aide/config` second
  //    (spec 184), which is the order `aide-run-spec` itself reads them
  //    in — a check that looked at only one of the two would report a
  //    project unconfigured that a run links perfectly well.
  const { links, source } = resolveWorktreeLinks(projectDir);
  const linkError = links
    ? worktreeLinksError(links, source === ".aide/config" ? "AIDE_WORKTREE_LINKS" : "worktreeLinks")
    : null;
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
