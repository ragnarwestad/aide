// Shared test data for the project-detail-route suite, split by theme
// across project-detail-page.test.ts and project-detail-readiness-and-deploy.test.ts
// (split out of project-detail-route.test.ts).
//
// Spec 185: a project's own page, served live.
//
// Everything the description asks for was already computed somewhere —
// `assessProjectReadiness` says why a run cannot start, `configValue`
// reads the file — and the reader could see none of it. Readiness ran
// once, at Add, and travelled to the browser as a query-string notice
// that is gone on the next load; the project's page itself was a
// batch-generated file with no server behind it to ask git anything.
//
// The questions here are the wiring ones: that the page is SERVED (so
// the answer is current at the moment it is read, not at the moment
// some unrelated merge last regenerated the site), that a reason a run
// cannot start is on it with nothing pressed, that a derived command is
// hedged as a default rather than shown as a promise, and that a git
// which cannot answer leaves a page behind rather than a stack trace.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitRunner } from "../../src/git/branch-status.ts";
import { queueHarness } from "../helpers/queue-server.ts";
import { fakeGit } from "../helpers/fake-git.ts";

export const harness = queueHarness("aide-project-detail-");
export const ownDirs: string[] = [];

export const TOKEN = "s3cret-token";
export const AUTH = { "x-aide-token": TOKEN };

/** A projects root this suite owns, so the paths git is asked about are
 *  the paths the test names. Each project is discoverable (a manifest
 *  and one spec) and gets the `.aide/config` it was given — `null` for
 *  a project with no config file at all, which is the state a checkout
 *  on a second machine is in. */
export function projectsRoot(projects: Record<string, string | null>, files: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-detail-root-"));
  ownDirs.push(dir);
  for (const [name, config] of Object.entries(projects)) {
    const project = join(dir, name);
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), `name: ${name}\ndescription: the ${name} project\n`);
    mkdirSync(join(project, "specs", "01-first"), { recursive: true });
    writeFileSync(join(project, "specs", "01-first", "1-description.md"), "# First - Description\n");
    if (config !== null) writeFileSync(join(project, ".aide", "config"), config);
    for (const f of files) writeFileSync(join(project, f), "");
  }
  return dir;
}

/** A checkout that is its own repository, on its default branch, with
 *  every other question answered the boring way. */
export const settled = (root: string, name: string) =>
  fakeGit({
    "rev-parse --show-toplevel": { code: 0, stdout: `${join(root, name)}\n` },
    "symbolic-ref": { code: 0, stdout: "origin/main\n" },
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
    "show-ref": { code: 0 },
  });

/** A checkout stuck on a branch a run cannot move it off: origin/HEAD
 *  names `main`, and no `main` exists here or on origin. */
export const stranded = (root: string, name: string) =>
  fakeGit({
    "rev-parse --show-toplevel": { code: 0, stdout: `${join(root, name)}\n` },
    "symbolic-ref": { code: 0, stdout: "origin/main\n" },
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "feature-x\n" },
    "show-ref": { code: 1 },
  });

export function serve(root: string, git: { run: GitRunner }, driftPollMs?: number): string {
  return harness.start({
    extra: {
      projectRoot: root,
      queueProjectRoot: root,
      gitRun: git.run,
      queueToken: TOKEN,
      ...(driftPollMs !== undefined ? { driftPollMs } : {}),
    },
  }).base;
}

export const get = (base: string, name: string, tab?: string) =>
  fetch(`${base}/projects/${encodeURIComponent(name)}${tab ? `?tab=${tab}` : ""}`, { headers: AUTH });

/** What a checkout on its default branch, `n` commits behind origin,
 *  answers to every call the drift check and the readiness check make —
 *  the two callers ask "which branch is the default" in different
 *  shapes (`--short` for readiness, plain `--quiet` for drift), so both
 *  get their own full-path answer rather than one generic "symbolic-ref"
 *  entry that would only ever suit one of them. */
export const behindBy = (root: string, name: string, n: number) =>
  fakeGit({
    "rev-parse --show-toplevel": { code: 0, stdout: `${join(root, name)}\n` },
    "symbolic-ref --short": { code: 0, stdout: "origin/main\n" },
    "symbolic-ref --quiet": { code: 0, stdout: "refs/remotes/origin/main\n" },
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
    "show-ref": { code: 0 },
    fetch: { code: 0 },
    "rev-list --count": { code: 0, stdout: `${n}\n` },
  });

/** A checkout the drift check asks about and cannot get an answer from
 *  — origin unreachable at the `rev-list` step — the fail-open case:
 *  asked, unanswerable. */
export const unanswerable = (root: string, name: string) =>
  fakeGit({
    "rev-parse --show-toplevel": { code: 0, stdout: `${join(root, name)}\n` },
    "symbolic-ref --short": { code: 0, stdout: "origin/main\n" },
    "symbolic-ref --quiet": { code: 0, stdout: "refs/remotes/origin/main\n" },
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
    "show-ref": { code: 0 },
    fetch: { code: 0 },
    "rev-list --count": { code: 128, stdout: "" },
  });

export const INSTALLS = "AIDE_INSTALL_CMD=deploy/install-after-merge.sh\n";

/** Poll a project's own page until it says `text`, or give up — the
 *  drift check runs on a schedule of its own (spec 203), so the answer
 *  arrives a moment after the server starts rather than during the
 *  first request. The same bounded-loop idiom `projects-route.test.ts`
 *  uses for its own background check. */
export async function loadUntil(
  base: string,
  name: string,
  text: string,
  budgetMs = 2000,
  tab?: string,
): Promise<string> {
  const deadline = Date.now() + budgetMs;
  let html = "";
  while (Date.now() < deadline) {
    html = await (await get(base, name, tab)).text();
    if (html.includes(text)) return html;
    await new Promise((r) => setTimeout(r, 25));
  }
  return html;
}
