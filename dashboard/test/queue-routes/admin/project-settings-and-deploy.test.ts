// Split out of project-settings.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeGit as gitFake } from "../../helpers/fake-git.ts";
import { TOKEN, setupQueueRoutesHarness } from "../fixtures.ts";

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
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

  const settled = async (
    extra: Record<string, unknown> = {},
  ): Promise<{ base: string; dir: string; project: string }> => {
    const { base, dir } = start({ queueToken: TOKEN, ...extra });
    return { base, dir, project: join(dir, "root", "aide") };
  };

  test("the legacy form URL redirects to the project detail page", async () => {
    const { base, project } = await settled();
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\nworktreeLinks: node_modules\n");
    writeFileSync(join(project, ".aide", "config"), "AIDE_SPECS_PATH=/repos/aide-specs/aide\n");
    const res = await fetch(`${base}/projects/aide/settings`, {
      redirect: "manual",
      headers: { "x-aide-token": TOKEN },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/projects/aide");
  });

  test("a project the allowlist does not know is a mistyped address", async () => {
    const { base } = await settled();
    const res = await fetch(`${base}/projects/nosuch/settings`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(404);
  });

  // Criterion 4: the whole point — a project brought to runnable without
  // leaving the dashboard.
  test("a save writes the links to the manifest and answers with the new readiness", async () => {
    const { base, project } = await settled();
    mkdirSync(join(project, "node_modules"), { recursive: true });
    const res = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ worktreeLinks: "node_modules", specsPath: "" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    expect(readFileSync(join(project, ".aide", "project.yaml"), "utf-8")).toContain(
      "worktreeLinks: node_modules",
    );
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

  // A browser with no script gets its answer the only way a redirect
  // can carry one — the same handover the Add form has had since spec
  // 138, back to the page the form is ON when it was refused.
  test("a no-script save and refusal return to the inline editor", async () => {
    const { base, project } = await settled();
    mkdirSync(join(project, "node_modules"), { recursive: true });
    const FORM = { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN };
    const ok = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ worktreeLinks: "node_modules", specsPath: "" }),
    });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")!.split("?")[0]).toBe("/projects/aide");
    // Criterion 3: the page the save lands on is the page the new value
    // is on. A redirect to the right address that then renders what the
    // project used to be would satisfy the line above and nothing else.
    const saved = readFileSync(join(project, ".aide", "project.yaml"), "utf-8");
    expect(saved).toContain("worktreeLinks: node_modules");
    // Spec 255: the redirect lands on the read-only view — the value is
    // plain text in the table now, not an editable input.
    const afterSave = await (await fetch(`${base}${ok.headers.get("location")}`, {
      headers: { "x-aide-token": TOKEN },
    })).text();
    expect(afterSave).toContain("<td>node_modules</td>");
    const refused = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ worktreeLinks: "/etc" }),
    });
    expect(refused.status).toBe(303);
    // Spec 255: `?edit=1` carries the reader back into edit mode, so the
    // refusal is shown on the form it was submitted from — not on the
    // read-only view, where nothing could show it.
    expect(refused.headers.get("location")!.startsWith("/projects/aide?edit=1")).toBe(true);
    const refusalPage = await fetch(`${base}${refused.headers.get("location")}`, {
      headers: { "x-aide-token": TOKEN },
    });
    const refusalHtml = await refusalPage.text();
    expect(refusalHtml).toContain(">Save<");
    expect(refusalHtml).toContain("/etc");
    // Criterion 5: the refusal wrote nothing — the manifest is still what
    // the save before it left behind.
    expect(readFileSync(join(project, ".aide", "project.yaml"), "utf-8")).toBe(saved);
  });

  // Spec 220, acceptance criterion 5. A third field on the same form,
  // written to the same committed file the links go to — never to
  // `.aide/config`, which no clone on a second machine ever sees.
  test("the code-landing choice is on the form and saved to the manifest", async () => {
    const { base, project } = await settled();
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\ncodeLanding: pr\n");
    // Spec 255: Code landing's `<select>` only exists in edit mode now.
    const form = await (await fetch(`${base}/projects/aide?edit=1`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(form).toContain('name="codeLanding"');
    expect(form).toMatch(/value="pr"[^>]*selected|selected[^>]*value="pr"/);

    const res = await fetch(`${base}/api/queue/projects/aide/settings`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ codeLanding: "merge", worktreeLinks: "", specsPath: "" }),
    });
    expect(res.status).toBe(200);
    expect(readFileSync(join(project, ".aide", "project.yaml"), "utf-8")).not.toContain("codeLanding");
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
});

// --- spec 258: the button behind the drift note --------------------------
//
// Everything below it already exists: the fast-forward is
// `fastForwardToOrigin`, the install is `installAfterMerge`, and the lock
// is `mergeLock`. This route is the wiring that puts a button on top of
// them — see `deploySection` in `site.ts` for the markup it answers to.
describe("POST /api/queue/projects/<name>/deploy (spec 258)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

  /** A checkout that answers `main` for both `defaultBranch`'s own
   *  `symbolic-ref` and `fastForwardToOrigin`'s `rev-parse` check, then
   *  the fast-forward and (unless told otherwise) reports level with
   *  origin afterwards — the state criterion 6 asks the next page load
   *  to show. */
  const onMain = (behindAfter = 0) =>
    gitFake({
      "symbolic-ref": { code: 0, stdout: "refs/remotes/origin/main\n" },
      "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
      fetch: { code: 0 },
      "merge -q --ff-only origin/": { code: 0 },
      "rev-list --count": { code: 0, stdout: `${behindAfter}\n` },
    });

  const movedOffMain = () =>
    gitFake({
      "symbolic-ref": { code: 0, stdout: "refs/remotes/origin/main\n" },
      "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "feature-x\n" },
    });

  const projectDir = (dir: string): string => join(dir, "root", "aide");

  /** The install the project runs once its checkout is current — a
   *  `touch`, so the test can ask whether it ran by asking the
   *  filesystem, exactly the pattern `installs()` uses elsewhere in
   *  this file. */
  function installsOk(project: string): string {
    const marker = join(project, "installed");
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "config"), `AIDE_INSTALL_CMD=/usr/bin/touch ${marker}\n`);
    return marker;
  }

  function installFails(project: string): void {
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "config"), "AIDE_INSTALL_CMD=/bin/false\n");
  }

  test("success: the checkout moves, the install runs, and the very next load shows level (criterion 6)", async () => {
    const git = onMain(0);
    const { base, dir } = start({ queueToken: TOKEN, gitRun: git.run });
    const project = projectDir(dir);
    const marker = installsOk(project);
    const res = await fetch(`${base}/api/queue/projects/aide/deploy`, { method: "POST", headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; installError?: string };
    expect(body.ok).toBe(true);
    expect(body.installError).toBeUndefined();
    expect(existsSync(marker)).toBe(true);
    const page = await (
      await fetch(`${base}/projects/aide?tab=deploy`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    expect(page).toContain("This checkout matches origin.");
  });

  test("refuses, naming both branches, when the checkout moved off its default branch (criterion 7)", async () => {
    const git = movedOffMain();
    const { base, dir } = start({ queueToken: TOKEN, gitRun: git.run });
    const project = projectDir(dir);
    const marker = installsOk(project);
    const res = await fetch(`${base}/api/queue/projects/aide/deploy`, { method: "POST", headers: AUTH });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("feature-x");
    expect(body.error).toContain("main");
    expect(existsSync(marker)).toBe(false);
    for (const forbidden of ["fetch", "pull"]) {
      expect(git.calls.some((c) => c.args[0] === forbidden)).toBe(false);
    }
  });

  test("an install failure is reported as installError, distinct from a pull refusal (criterion 8)", async () => {
    const git = onMain(0);
    const { base, dir } = start({ queueToken: TOKEN, gitRun: git.run });
    const project = projectDir(dir);
    installFails(project);
    const res = await fetch(`${base}/api/queue/projects/aide/deploy`, { method: "POST", headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error?: string; installError?: string };
    expect(body.ok).toBe(true);
    expect(body.error).toBeUndefined();
    expect(body.installError).toBeDefined();
    // The checkout DID move, so the drift count is refreshed either way.
    const page = await (
      await fetch(`${base}/projects/aide?tab=deploy`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    expect(page).toContain("This checkout matches origin.");
  });

  test("refuses when no AIDE_INSTALL_CMD is configured — deploying stays a hand step", async () => {
    const git = onMain(0);
    const { base } = start({ queueToken: TOKEN, gitRun: git.run });
    const res = await fetch(`${base}/api/queue/projects/aide/deploy`, { method: "POST", headers: AUTH });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    // Spec 318 (REQ-1): the refusal names the setting in plain words,
    // not the raw env-var key.
    expect(body.error).toContain("install command");
    expect(body.error).not.toContain("AIDE_INSTALL_CMD");
    for (const forbidden of ["fetch", "pull"]) {
      expect(git.calls.some((c) => c.args[0] === forbidden)).toBe(false);
    }
  });

  test("refuses for a project this dashboard does not know", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue/projects/nosuch/deploy`, { method: "POST", headers: AUTH });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
  });

  // AC8: `deployError=` stays first — `&tab=deploy` is appended after
  // it — so the resulting page opens on the Deploy tab and the message
  // it carries is visible, instead of landing on the new default
  // (Config) tab where it would go unseen without an extra click.
  test("a no-script press gets the answer as a redirect carrying deployError, opening the Deploy tab (AC8)", async () => {
    const git = movedOffMain();
    const { base, dir } = start({ queueToken: TOKEN, gitRun: git.run });
    installsOk(projectDir(dir));
    const res = await fetch(`${base}/api/queue/projects/aide/deploy`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      body: "",
    });
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location.startsWith("/projects/aide?deployError=")).toBe(true);
    expect(location.endsWith("&tab=deploy")).toBe(true);
    expect(decodeURIComponent(location)).toContain("feature-x");
  });

  // AC9: a successful no-script deploy redirects to the Deploy tab too,
  // so the refreshed drift state is what the browser lands on.
  test("a successful no-script press redirects to the Deploy tab (AC9)", async () => {
    const git = onMain(0);
    const { base, dir } = start({ queueToken: TOKEN, gitRun: git.run });
    installsOk(projectDir(dir));
    const res = await fetch(`${base}/api/queue/projects/aide/deploy`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      body: "",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/projects/aide?tab=deploy");
  });

  test("only POST — the button's route takes no other method", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue/projects/aide/deploy`, { headers: AUTH });
    expect(res.status).toBe(405);
  });
});
