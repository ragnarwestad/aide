// Split out of project-settings.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

interface StepBody {
  ok: boolean;
  project?: string;
  results: { step: string; ok: boolean; error?: string; note?: string }[];
  readiness?: {
    canRun: boolean;
    note: string;
    checks: { check: string; subject: string; ok: boolean; blocking: boolean; detail: string }[];
  };
}

// --- spec 184: settings that can be changed after Add -------------------------
//
// The two fields lived on the Add form and nowhere else, so a project
// added without them could only be fixed by removing and re-adding it,
// or by editing a file on the serving host.
describe("a project's settings route (spec 184)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json" };

  const settled = async (
    extra: Record<string, unknown> = {},
  ): Promise<{ base: string; dir: string; project: string }> => {
    const { base, dir } = start({ ...extra });
    const project = join(dir, "root", "aide");
    onItsOwnOrigin(project, join(dir, "aide-origin.git"));
    return { base, dir, project };
  };

  /** The manifest as origin holds it: where a Settings save's manifest
   *  keys land, committed and pushed from the dashboard's own checkout. */
  const onOrigin = (dir: string): string =>
    Bun.spawnSync(["git", "--git-dir", join(dir, "aide-origin.git"), "show", "main:.aide/project.yaml"]).stdout.toString();

  /** A Settings save commits and pushes the manifest keys it changes, so
   *  the project is a repository with an origin to push to — as every
   *  project the dashboard serves is. */
  const onItsOwnOrigin = (project: string, origin: string): void => {
    const git = (cwd: string, ...args: string[]) => {
      const res = Bun.spawnSync(["git", ...args], { cwd });
      if (res.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr.toString()}`);
    };
    git(join(project, ".."), "init", "-q", "--bare", "-b", "main", origin);
    git(project, "init", "-q", "-b", "main");
    // `.aide/config` is personal and never committed — a global ignore
    // rule keeps it out on every real machine, and the dashboard writes
    // one into its own checkout of the project.
    writeFileSync(join(project, ".gitignore"), ".aide/config\n");
    git(project, "config", "user.email", "t@example.com");
    git(project, "config", "user.name", "T");
    git(project, "add", "-A");
    git(project, "commit", "-qm", "first", "--allow-empty");
    git(project, "remote", "add", "origin", origin);
    git(project, "push", "-q", "-u", "origin", "main");
  };

  test("the legacy form URL redirects to the project page's Config tab", async () => {
    const { base, project } = await settled();
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\nworktreeLinks: node_modules\n");
    writeFileSync(join(project, ".aide", "config"), "AIDE_SPECS_PATH=/repos/aide-specs/aide\n");
    const res = await fetch(`${base}/projects/aide/settings`, {
      redirect: "manual",
      headers: {},
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/projects/aide?tab=config");
  });

  test("a project the allowlist does not know is a mistyped address", async () => {
    const { base } = await settled();
    const res = await fetch(`${base}/projects/nosuch/settings`, );
    expect(res.status).toBe(404);
  });

  // Criterion 4: the whole point — a project brought to runnable without
  // leaving the dashboard.
  test("a save writes the links to the manifest and answers with the new readiness", async () => {
    const { base, dir, project } = await settled();
    mkdirSync(join(project, "node_modules"), { recursive: true });
    const res = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ worktreeLinks: "node_modules", specsPath: "" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    expect(onOrigin(dir)).toContain("worktreeLinks: node_modules");
    expect(body.readiness!.checks.find((c) => c.check === "worktreeLinks")!.ok).toBe(true);
  });

  test("an unusable value is refused, and nothing is written", async () => {
    const { base, project } = await settled();
    const before = readFileSync(join(project, ".aide", "project.yaml"), "utf-8");
    const res = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ worktreeLinks: "../escape" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(false);
    expect(body.results.find((r) => r.step === "worktreeLinks")!.error).toContain("../escape");
    expect(readFileSync(join(project, ".aide", "project.yaml"), "utf-8")).toBe(before);
  });

  test("posting at a project nobody added is refused", async () => {
    const { base } = await settled();
    const res = await fetch(`${base}/api/queue/projects/nosuch/settings`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ worktreeLinks: "node_modules" }),
    });
    expect(res.status).toBe(400);
  });

  // A form post with no Accept header gets the same JSON a script's
  // press gets: a save lands on origin, a refusal writes nothing.
  test("a form-encoded save and refusal answer JSON whatever the Accept header says", async () => {
    const { base, dir, project } = await settled();
    mkdirSync(join(project, "node_modules"), { recursive: true });
    const FORM = { "content-type": "application/x-www-form-urlencoded" };
    const ok = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ worktreeLinks: "node_modules", specsPath: "" }),
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as StepBody).ok).toBe(true);
    const saved = onOrigin(dir);
    expect(saved).toContain("worktreeLinks: node_modules");
    const refused = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ worktreeLinks: "/etc" }),
    });
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as StepBody;
    expect(body.ok).toBe(false);
    expect(body.results.find((r) => r.step === "worktreeLinks")!.error).toContain("/etc");
    expect(onOrigin(dir)).toBe(saved);
  });

  // Spec 220, acceptance criterion 5. A third field on the same form,
  // written to the same committed file the links go to — never to
  // `.aide/config`, which no clone on a second machine ever sees.
  test("the code-landing choice is on the form and saved to the manifest", async () => {
    const { base, dir, project } = await settled();
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\ncodeLanding: pr\n");
    // The stored choice is a committed one, as a manifest is.
    for (const args of [["add", "-A"], ["commit", "-qm", "codeLanding"], ["push", "-q"]]) {
      Bun.spawnSync(["git", ...args], { cwd: project });
    }
    // The page reads the manifest a run reads — the dashboard's own
    // checkout's (spec 512), once it has one — so that has the commit too.
    const owned = join(dir, "owned", "aide", "code");
    if (existsSync(join(owned, ".git"))) Bun.spawnSync(["git", "pull", "-q", "--ff-only"], { cwd: owned });
    // Spec 255: Code landing's `<select>` only exists in edit mode now.
    // It lives in the manifest table (spec 552).
    const form = await (await fetch(`${base}/projects/aide?edit=manifest`, )).text();
    expect(form).toContain('name="codeLanding"');
    expect(form).toMatch(/value="pr"[^>]*selected|selected[^>]*value="pr"/);

    const res = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ codeLanding: "merge", worktreeLinks: "", specsPath: "" }),
    });
    expect(res.status).toBe(200);
    expect(onOrigin(dir)).not.toContain("codeLanding");
    expect(existsSync(join(project, ".aide", "config"))).toBe(false);
  });

  test("a code-landing value neither side knows is refused, and nothing is written", async () => {
    const { base, project } = await settled();
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\n");
    const res = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ codeLanding: "rebase" }),
    });
    expect(res.status).toBe(400);
    expect(readFileSync(join(project, ".aide", "project.yaml"), "utf-8")).not.toContain("codeLanding");
  });

  test("the criteria checks level is saved to the manifest (AC-1)", async () => {
    const { base, dir, project } = await settled();
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\n");
    for (const args of [["add", "-A"], ["commit", "-qm", "manifest"], ["push", "-q"]]) {
      Bun.spawnSync(["git", ...args], { cwd: project });
    }
    const res = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ criteriaChecks: "stop" }),
    });
    expect(res.status).toBe(200);
    expect(onOrigin(dir)).toContain("criteriaChecks: stop");
  });
});
