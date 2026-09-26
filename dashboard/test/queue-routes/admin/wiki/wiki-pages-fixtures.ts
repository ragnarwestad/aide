// A board on a real project: a bare origin, a person's clone and the
// dashboard's own clone, with a wiki pushed to origin's default branch.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitRunner } from "../../../../src/git/branch-status.ts";
import { ensureDashboardCheckout } from "../../../../src/git/dashboard-checkout.ts";
import { createServer } from "../../../../src/serve/serve.ts";
import { checkoutSafetyHelpers } from "../../checkouts/checkout-safety-fixtures.ts";

export const INDEX = [
  "---", "wiki: generated", "commit: abc1234", "files: []", "---", "",
  "# Wiki index", "", "One line per page of the wiki.", "",
  "- [Landing](landing.md) — How a branch lands.",
  "- [Skills](skills.md) — The slash commands.",
  "",
].join("\n");

export const LANDING = "---\nwiki: generated\ncommit: deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\nfiles:\n  - a.ts\n---\n\n# Landing\n\nHow a branch lands. See [Skills](skills.md).\n";
export const SKILLS = "# Skills\n\nThe slash commands.\n";

export const ownDirs: string[] = [];
const helpers = checkoutSafetyHelpers(ownDirs);

/** A project with a real origin, and — when `pages` is given — a `wiki/`
 *  pushed to origin's default branch and pulled into the dashboard's clone. */
export async function wikiBoard(pages?: Record<string, string>) {
  const { projectsRoot, person, site, owned } = helpers.realProject();
  const made = await ensureDashboardCheckout(createGitRunner(), { base: owned, project: "aide", personDir: person });
  if (!made.ok) throw new Error(made.error);
  if (pages) {
    const scratch = mkdtempSync(join(tmpdir(), "aide-wiki-push-"));
    ownDirs.push(scratch);
    const clone = join(scratch, "aide");
    Bun.spawnSync({ cmd: ["git", "clone", "-q", join(projectsRoot, "..", "aide.git"), clone] });
    helpers.git(clone, "config", "user.name", "Test");
    helpers.git(clone, "config", "user.email", "test@example.com");
    mkdirSync(join(clone, "specs", "wiki"), { recursive: true });
    for (const [name, text] of Object.entries(pages)) writeFileSync(join(clone, "specs", "wiki", name), text);
    helpers.git(clone, "add", "-A");
    helpers.git(clone, "commit", "-qm", "add wiki");
    helpers.git(clone, "push", "-q", "origin", "main");
    helpers.git(join(owned, "aide", "code"), "pull", "-q", "--ff-only", "origin", "main");
  }
  const server = createServer({
    port: 0,
    mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
    projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], dashboardCheckoutRoot: owned, driftPollMs: 0,
  });
  return { base: `http://127.0.0.1:${server.port}`, stop: () => server.stop() };
}

/** The tab's HTML once the board has resolved its own clone and the page
 *  says what is expected. */
export async function untilTab(
  base: string,
  path: string,
  says: (html: string) => boolean,
  budgetMs = 15000,
): Promise<string> {
  const deadline = Date.now() + budgetMs;
  let last = "";
  while (Date.now() < deadline) {
    last = await (await fetch(`${base}${path}`)).text();
    if (says(last)) return last;
    await new Promise((r) => setTimeout(r, 50));
  }
  return last;
}

export function cleanupBoards(): void {
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
}
