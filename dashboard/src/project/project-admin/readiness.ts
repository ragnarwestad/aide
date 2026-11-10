// Whether a run could start there, read-only.
//
// Adding a project said "added" and nothing more, and the things that
// decide whether `aide-run-spec` will START were invisible until Run was
// pressed and the run refused. Skjer, 2026-08-20: on the allowlist,
// checkout where the form said, minimal manifest written — and refused,
// because the checkout stood on a feature branch whose upstream was
// gone, no specs root had been named, and no worktree links were set.
// (Its untracked `.aide/` refused it a fourth time that day. The runner
// no longer refuses for that, so this file no longer asks
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

import { realPathOrAbsolute as real } from "../../git/real-path.ts";
import { existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { GitRunner } from "../../git/process/index.ts";
import { configValue, resolveWorktreeLinks } from "../discover";
import { formatMessage, type BoardMessage } from "../../messages/format.ts";
import { worktreeLinksError } from "./manifest-io.ts";
import type { ProjectReadiness, ReadinessCheck } from "./types.ts";

/** One answer: its flags, and its sentence as a message, with the English
 *  `detail` every caller reads rendered from that same message. */
function answer(
  check: ReadinessCheck["check"], subject: string, ok: boolean, blocking: boolean, message: BoardMessage,
): ReadinessCheck {
  return { check, subject, ok, blocking, detail: formatMessage("en", message), message };
}

/** What a repository is called inside a sentence, as a message of its own,
 *  since a sentence is written in the reader's language after this is built. */
const labelOf = (label: string): BoardMessage => ({
  key: label === "project" ? "readiness.label.project" : label === "specs" ? "readiness.label.specs" : "readiness.label.dashboard",
});

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
 *  its default branch. Whether the tree is CLEAN is not asked at
 *  all — a run reads
 *  origin's default branch into a worktree of its own, so what sits
 *  uncommitted here decides nothing. */
async function repoChecks(run: GitRunner, root: string, label: string): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];
  const base = await defaultBranchOf(run, root);
  const current = (await gitSays(run, root, ["rev-parse", "--abbrev-ref", "HEAD"])) ?? "";
  if (!base) {
    checks.push(answer("defaultBranch", root, false, true, {
      key: "readiness.branch.unknown", values: { root }, inner: labelOf(label),
    }));
    return checks;
  }
  if (current === base) {
    checks.push(answer("defaultBranch", root, true, false, {
      key: "readiness.branch.on", values: { base }, inner: labelOf(label),
    }));
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
    checks.push(answer("defaultBranch", root, false, true, {
      key: "readiness.branch.missing", values: { current, base }, inner: labelOf(label),
    }));
    return checks;
  }
  const held = await branchHeldElsewhere(run, root, base);
  checks.push(
    held
      ? answer("defaultBranch", root, false, true, {
          key: "readiness.branch.held", values: { current, base, held }, inner: labelOf(label),
        })
      // Worth saying and nothing more: the runner puts a clean
      // checkout on its default branch itself, and leaves it there.
      : answer("defaultBranch", root, false, false, {
          key: "readiness.branch.moves", values: { current, base }, inner: labelOf(label),
        }),
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
 *  dashboard owns.
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
 *  reason the clean-tree question is not asked. */
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
    checks.push(answer("dashboardCheckout", root, origin !== null,
      // Worth SAYING and nothing more, the same shape as a checkout on
      // a feature branch. A project the dashboard cannot clone still
      // runs — it falls back to the checkout it was pointed at, exactly
      // as it always did — so refusing the run here
      // would take away something that works. What the reader needs to
      // know is that this project is the one where a run and their own
      // editing can still meet.
      false,
      origin === null
        ? { key: "readiness.checkout.noOrigin", values: { root }, inner: labelOf(label) }
        : { key: "readiness.checkout.willMake", values: { dir: machineryDir }, inner: labelOf(label) },
    ));
  }
  return checks;
}

/** Whether `aide-run-spec` would start in `projectDir`, read-only.
 *
 *  `run` is injected for the same reason every other git call in this
 *  file injects it: a test spawns no subprocess, and a failure is a
 *  value rather than an exception to be guessed at.
 *
 *  Nothing here asks about a dirty tree, so it takes no list of the
 *  paths the caller has just written. */
export async function assessProjectReadiness(
  run: GitRunner,
  projectDir: string,
  machineryDir?: string,
  /** The manifest to read the manifest-backed rows from, when it is not
   *  the project's own `.aide/project.yaml`: the dashboard's
   *  settings file, right after an Add. Without it the dashboard's own
   *  clone is asked, since that is the file a run reads. */
  manifestFile?: string,
): Promise<ProjectReadiness> {
  const checks: ReadinessCheck[] = [];

  // 1. The project is its own repository. A directory INSIDE one
  //    resolves to the outer root, and a run would branch, commit and
  //    push that one — which is not the project anybody added.
  const top = await gitSays(run, projectDir, ["rev-parse", "--show-toplevel"]);
  // Real paths on both sides: the projects root on the serving host is a
  // directory of symlinks to the dashboard's own checkouts, and git
  // answers with the real path.

  const isRoot = top !== null && real(top) === real(projectDir);
  checks.push(answer("gitRoot", projectDir, isRoot, !isRoot,
    top === null
      ? { key: "readiness.gitRoot.notRepo", values: { dir: projectDir } }
      : isRoot
        ? { key: "readiness.gitRoot.ok", values: { dir: projectDir } }
        : { key: "readiness.gitRoot.inside", values: { dir: projectDir, top } },
  ));
  const projectRoot = isRoot ? projectDir : top || projectDir;

  // 2. The specs root, configured or fallen back to, has to EXIST: the
  //    runner refuses "no specs root at …" before anything else.
  const configured = configValue(projectDir, "AIDE_SPECS_PATH");
  const specsRoot = configured ?? join(projectDir, "specs");
  const specsThere = existsSync(specsRoot) && statSync(specsRoot).isDirectory();
  checks.push(answer("specsRoot", specsRoot, specsThere, !specsThere,
    specsThere
      ? { key: configured ? "readiness.specsRoot.ok" : "readiness.specsRoot.okOwn", values: { root: specsRoot } }
      : { key: configured ? "readiness.specsRoot.missingConfigured" : "readiness.specsRoot.missingFallback", values: { root: specsRoot } },
  ));

  const roots: { root: string; label: string }[] = [{ root: projectRoot, label: "project" }];
  if (specsThere) {
    // 3. And it has to be IN a repository: a run commits and pushes the
    //    spec it writes, and a specs root outside git is a run whose
    //    analysis nothing keeps.
    const specsTop = await gitSays(run, specsRoot, ["rev-parse", "--show-toplevel"]);
    checks.push(answer("specsRepo", specsRoot, specsTop !== null, specsTop === null,
      specsTop === null
        ? { key: "readiness.specsRepo.none", values: { root: specsRoot } }
        : resolve(specsTop) === resolve(projectRoot)
          ? { key: "readiness.specsRepo.own" }
          : { key: "readiness.specsRepo.other", values: { top: specsTop } },
    ));
    if (specsTop !== null && resolve(specsTop) !== resolve(projectRoot)) {
      roots.push({ root: specsTop, label: "specs" });
    }
  }

  // 4. A reachable default branch, for every repository the run would
  //    touch — and that means the checkouts the DASHBOARD
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
  //    Read from the COMMITTED manifest alone, the same file
  //    `aide-run-spec` itself reads.
  const machineryManifest = machineryDir ? join(machineryDir, ".aide", "project.yaml") : undefined;
  const { links } = resolveWorktreeLinks(
    projectDir,
    manifestFile ?? (machineryManifest && existsSync(machineryManifest) ? machineryManifest : undefined),
  );
  const linkError = links ? worktreeLinksError(links, "worktreeLinks") : null;
  const missing = links
    ? links.split(/\s+/).filter(Boolean).filter((e) => !existsSync(join(projectRoot, e)))
    : [];
  checks.push(
    !links
      // Not a failure: most projects need none, and the dashboard
      // cannot infer which gitignored paths a test command wants.
      // Said all the same, because it is silent otherwise. Names the
      // destination, not only the gap: this is the one readiness answer
      // a person closes out themselves.
      ? answer("worktreeLinks", projectDir, false, false, { key: "readiness.links.none" })
      : linkError
        ? answer("worktreeLinks", projectDir, false, true, { key: "readiness.links.invalid", values: { error: linkError } })
        : missing.length
          ? answer("worktreeLinks", projectDir, false, true,
            missing.length === 1
              ? { key: "readiness.links.missingOne", values: { entry: missing[0]!, root: projectRoot } }
              : { key: "readiness.links.missingMany", values: { entries: missing, root: projectRoot } })
          : answer("worktreeLinks", projectDir, true, false, { key: "readiness.links.ok", values: { links: links.split(/\s+/).filter(Boolean) } }),
  );

  const canRun = checks.every((c) => !c.blocking);
  return { canRun, checks, note: readinessNote(basename(projectDir), canRun, checks) };
}
