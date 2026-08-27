import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ServerOptions,
} from "../../src/serve/serve.ts";
import { fakeGit as gitFake } from "../helpers/fake-git.ts";
import {
  TOKEN,
  JOB,
  setupQueueRoutesHarness,
} from "./fixtures.ts";

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
  /** Spec 138: whether `aide-run-spec` would START there — a separate
   *  answer from `ok`, which only says the registration completed. */
  readiness?: {
    canRun: boolean;
    note: string;
    checks: { check: string; subject: string; ok: boolean; blocking: boolean; detail: string }[];
  };
}

/** A git that makes the directory a real clone would have made. Every
 *  step after the clone reads that directory, so a fake leaving nothing
 *  behind would exercise only the first one. */
const cloningGit = (): ServerOptions["gitRun"] => async (dir, args) => {
  // Located, not assumed at index 0: since spec 183 the real clone
  // carries a `-c credential.helper=` prefix ahead of the subcommand.
  const clone = args.indexOf("clone");
  if (clone !== -1) {
    mkdirSync(join(dir, args[clone + 2]!), { recursive: true });
    return { code: 0, stdout: "" };
  }
  return { code: 1, stdout: "" };
};

/** A queue config of this suite's own, so a route that persists the
 *  allowlist has somewhere to write it. */
function ownConfig(contents: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-queue-projects-"));
  ownDirs.push(dir);
  const file = join(dir, "queue-config.json");
  writeFileSync(file, JSON.stringify(contents, null, 2));
  return file;
}

const projectsIn = (file: string): string[] =>
  (JSON.parse(readFileSync(file, "utf-8")) as { projects?: string[] }).projects ?? [];


describe("Settings routes (spec 232)", () => {
  const STEPS = ["explore", "create", "analyze", "implement", "archive", "manifest", "reopen"];
  const DEFAULTS = {
    budgetUsd: 3, jobCapUsd: 10, dailyCapUsd: 20,
    timeoutSec: { default: 1200, implement: 5400 }, permissionMode: { default: "acceptEdits" },
    model: { default: "sonnet" },
    modelChoices: { sonnet: { budgetUsd: 3 }, "codex-fast": { budgetUsd: 5, tool: "codex" as const } },
  };
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const validModel = Object.fromEntries(STEPS.map((step) => [step, "sonnet"]));
  const validTimeoutSec = Object.fromEntries(STEPS.map((step) => [step, 30]));
  const validBody = { model: validModel, budgetUsd: 5, jobCapUsd: 15, timeoutSec: validTimeoutSec };

  test("GET is guarded and renders the live defaults", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: DEFAULTS });
    expect((await fetch(`${base}/settings`)).status).toBe(401);
    const res = await fetch(`${base}/settings`, { headers: { "x-aide-token": TOKEN } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('name="model.implement"');
    expect(html).toContain('value="3"');
    expect(html).toContain('value="10"');
    // implement's own 5400s (90 min) differs from every other step's
    // 1200s (20 min) fallback (job-state.ts:145's minutes convention).
    const implementRow = html.match(/<tr[^>]*data-step="implement"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(implementRow).toContain('name="timeoutSec.implement"');
    expect(implementRow).toContain('value="90"');
    const analyzeRow = html.match(/<tr[^>]*data-step="analyze"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(analyzeRow).toContain('value="20"');
  });

  // Spec 252, Criterion 3: Settings is reachable from every page's "…"
  // menu, so "← Back" tracks whichever one the reader opened it from —
  // read off the standard Referer header, never a bare `/`.
  test("← Back tracks a same-origin Referer, criterion 3", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: DEFAULTS });
    const html = await (
      await fetch(`${base}/settings`, { headers: { "x-aide-token": TOKEN, referer: `${base}/projects/aide` } })
    ).text();
    expect(html).toContain('<a class="btn" href="/projects/aide">← Back</a>');
  });

  // Criterion 4: no Referer at all falls back to today's exact default.
  test("← Back falls back to / with no Referer, criterion 4", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: DEFAULTS });
    const html = await (await fetch(`${base}/settings`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain('<a class="btn" href="/">← Back</a>');
  });

  // Criterion 5: a foreign-origin Referer is discarded, not followed.
  test("← Back discards a foreign-origin Referer, criterion 5", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: DEFAULTS });
    const html = await (
      await fetch(`${base}/settings`, { headers: { "x-aide-token": TOKEN, referer: "https://evil.example/" } })
    ).text();
    expect(html).toContain('<a class="btn" href="/">← Back</a>');
  });

  test("a successful save affects later jobs but not an accepted job", async () => {
    const file = ownConfig({ model: { default: "sonnet", future: "keep" } });
    const { base } = start({ queueToken: TOKEN, queueDefaults: DEFAULTS, queueConfigFile: file });
    const accepted = await fetch(`${base}/api/queue`, {
      method: "POST", headers: AUTH, body: JSON.stringify(JOB),
    });
    const first = (await accepted.json()) as { job: { model: Record<string, string> } };
    const model = Object.fromEntries(STEPS.map((step) => [step, "codex-fast"]));
    const saved = await fetch(`${base}/api/queue/settings`, {
      method: "POST", headers: AUTH, body: JSON.stringify({ model, budgetUsd: 6, jobCapUsd: 18, timeoutSec: validTimeoutSec }),
    });
    expect(saved.status).toBe(200);
    expect(first.job.model.analyze).toBe("sonnet");
    const later = await fetch(`${base}/api/queue`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ project: "aide", specFolder: "82-second", steps: ["analyze"] }),
    });
    // The fixture does not discover 82-second, so use create to observe a later accepted job.
    const created = await fetch(`${base}/api/queue/create`, {
      method: "POST", headers: AUTH, body: JSON.stringify({ project: "aide", title: "Later", description: "Later job" }),
    });
    expect(later.status).toBe(400);
    const createdBody = (await created.json()) as { job: { model: Record<string, string>; budgetUsd: number; jobCapUsd: number } };
    expect(createdBody.job.model.create).toBe("codex-fast");
    expect(createdBody.job.budgetUsd).toBe(6);
    expect(createdBody.job.jobCapUsd).toBe(18);
    expect(readFileSync(file, "utf-8")).toContain('"future": "keep"');
  });

  test("a save with jobCapUsd below budgetUsd is refused and changes nothing", async () => {
    const file = ownConfig({ model: { default: "sonnet" } });
    const { base } = start({ queueToken: TOKEN, queueDefaults: DEFAULTS, queueConfigFile: file });
    const res = await fetch(`${base}/api/queue/settings`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...validBody, budgetUsd: 20, jobCapUsd: 10 }),
    });
    expect(res.status).toBe(400);
    expect(readFileSync(file, "utf-8")).not.toContain('"budgetUsd": 20');
  });

  test("invalid input and missing config leave live defaults unchanged", async () => {
    const file = ownConfig({ model: { default: "sonnet" } });
    const { base } = start({ queueToken: TOKEN, queueDefaults: DEFAULTS, queueConfigFile: file });
    for (const model of [
      { analyze: "sonnet" },
      { ...Object.fromEntries(STEPS.map((step) => [step, "sonnet"])), extra: "sonnet" },
      Object.fromEntries(STEPS.map((step) => [step, step === "archive" ? "missing" : "sonnet"])),
    ]) {
      const res = await fetch(`${base}/api/queue/settings`, {
        method: "POST", headers: AUTH, body: JSON.stringify({ ...validBody, model }),
      });
      expect(res.status).toBe(400);
    }
    // Out-of-range / non-numeric budgetUsd, jobCapUsd and per-step timeout.
    for (const overrides of [
      { budgetUsd: 0 },
      { budgetUsd: -1 },
      { budgetUsd: "nope" },
      { budgetUsd: 101 },
      { jobCapUsd: 0 },
      { jobCapUsd: 301 },
      { timeoutSec: { ...validTimeoutSec, analyze: 0 } },
      { timeoutSec: { ...validTimeoutSec, analyze: 361 } },
      { timeoutSec: {} },
    ]) {
      const res = await fetch(`${base}/api/queue/settings`, {
        method: "POST", headers: AUTH, body: JSON.stringify({ ...validBody, ...overrides }),
      });
      expect(res.status).toBe(400);
    }
    expect(readFileSync(file, "utf-8")).toEqual(JSON.stringify({ model: { default: "sonnet" } }, null, 2));

    const without = start({ queueToken: TOKEN, queueDefaults: DEFAULTS });
    const res = await fetch(`${without.base}/api/queue/settings`, {
      method: "POST", headers: AUTH, body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/queue/projects (spec 112)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

  // Criterion 1.
  test("a git URL is cloned, given a manifest, and put on the allowlist", async () => {
    const { base, dir } = start({ queueToken: TOKEN, gitRun: cloningGit() });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "newproj", gitUrl: "https://example.com/newproj.git" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    expect(body.results.map((r) => r.step)).toEqual(["name", "clone", "manifest", "allowlist"]);
    expect(body.results.every((r) => r.ok)).toBe(true);
    expect(existsSync(join(dir, "root", "newproj", ".aide", "project.yaml"))).toBe(true);
    // On the allowlist the MOMENT it is done — no restart, and no
    // waiting for the five-second scan: the New-spec form's project
    // list is the raw allowlist, so it shows a project with no spec yet.
    const html = await (await fetch(`${base}/new`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html.slice(html.indexOf('action="/api/queue/create"'))).toContain('value="newproj"');
  });

  // Criterion 2.
  test("a name already taken under the projects root is refused, and names the collision", async () => {
    const { base, dir } = start({ queueToken: TOKEN, gitRun: cloningGit() });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "aide", gitUrl: "https://example.com/aide.git" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(false);
    expect(body.results.find((r) => r.step === "clone")!.error).toContain("aide");
    expect(existsSync(join(dir, "root", "aide", ".git"))).toBe(false);
  });

  // Criterion 3, at the route level.
  test("an unsafe name is refused before anything is cloned or written", async () => {
    const { base, dir } = start({ queueToken: TOKEN, gitRun: cloningGit() });
    for (const name of ["../escape", "a/b", ".hidden", ""]) {
      const res = await fetch(`${base}/api/queue/projects`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ name, gitUrl: "https://example.com/x.git" }),
      });
      expect([name, res.status]).toEqual([name, 400]);
    }
    expect(existsSync(join(dir, "escape"))).toBe(false);
    expect(existsSync(join(dir, "root", ".hidden"))).toBe(false);
  });

  // Criterion 6: an existing checkout with no manifest gets one, and
  // the answer says so rather than leaving the operator to find out.
  test("a checkout already on the host is registered, and a made manifest is reported", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const path = join(dir, "root", "already-here");
    mkdirSync(path, { recursive: true });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "already-here", existingPath: path, description: "on disk already" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    expect(body.results.map((r) => r.step)).toEqual(["name", "register", "manifest", "allowlist"]);
    expect(body.results.find((r) => r.step === "manifest")!.note).toMatch(/aide-manifest/);
  });

  // Spec 131: the form picks a checkout by its bare directory name and
  // leaves Name blank — so the name the ALLOWLIST gets has to be the one
  // derived from the pick. Posting the raw blank would add "" and the
  // project the manifest was just written for would never be runnable.
  test("a picked checkout with no Name is allowlisted under the picked name", async () => {
    const file = ownConfig({ concurrency: 2 });
    const { base, dir } = start({ queueToken: TOKEN, queueConfigFile: file });
    mkdirSync(join(dir, "root", "picked"), { recursive: true });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "", existingPath: "picked" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    expect(projectsIn(file).sort()).toEqual(["aide", "picked"]);
  });

  // Criterion 9: the change survives a restart, because it is written to
  // the file the server reads on the way up.
  test("the new allowlist is persisted to the queue config", async () => {
    const file = ownConfig({ concurrency: 2 });
    const { base } = start({ queueToken: TOKEN, queueConfigFile: file, gitRun: cloningGit() });
    await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "newproj", gitUrl: "https://example.com/newproj.git" }),
    });
    expect(projectsIn(file).sort()).toEqual(["aide", "newproj"]);
    // The rest of the config is untouched.
    expect(JSON.parse(readFileSync(file, "utf-8")).concurrency).toBe(2);
  });

  // Criterion 15: two requests in immediate succession, neither losing
  // the other's change. Every write is derived from the live allowlist,
  // never from a copy of the file read before the other one landed.
  test("two changes in immediate succession both survive", async () => {
    const file = ownConfig({});
    const { base } = start({ queueToken: TOKEN, queueConfigFile: file, gitRun: cloningGit() });
    const add = (name: string) =>
      fetch(`${base}/api/queue/projects`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ name, gitUrl: `https://example.com/${name}.git` }),
      });
    await Promise.all([add("one"), add("two")]);
    expect(projectsIn(file).sort()).toEqual(["aide", "one", "two"]);
    await Promise.all([
      fetch(`${base}/api/queue/projects/one/remove`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ confirm: "one" }),
      }),
      fetch(`${base}/api/queue/projects/aide/remove`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ confirm: "aide" }),
      }),
    ]);
    expect(projectsIn(file).sort()).toEqual(["two"]);
  });

  // Spec 115: back to the page the form is ON, which is `/projects` now.
  // Every other route here still lands on `/` — the target is a
  // parameter with `/` as its default, not a rewrite.
  test("a form submit lands back on /projects, refusal and success alike", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const FORM = { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN };
    const refused = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ name: "../escape", gitUrl: "https://example.com/x.git" }),
    });
    expect(refused.status).toBe(303);
    // Back to the page the FORM is on (2026-08-19): the Add page.
    expect(refused.headers.get("location")!.startsWith("/projects/new?error=")).toBe(true);

    const path = join(dir, "root", "on-disk");
    mkdirSync(path, { recursive: true });
    const ok = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ name: "on-disk", existingPath: path }),
    });
    expect(ok.status).toBe(303);
    // The list, as it has been since spec 115 — carrying the readiness
    // answer since spec 138, which is that spec's to assert.
    expect(ok.headers.get("location")!.split("?")[0]).toBe("/projects");
  });

  test("a refusal reaches the log", async () => {
    const { base } = start({ queueToken: TOKEN });
    const written: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => void written.push(args.join(" "));
    try {
      await fetch(`${base}/api/queue/projects`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ name: "../escape", gitUrl: "https://example.com/x.git" }),
      });
    } finally {
      console.error = realError;
    }
    expect(written.join("\n")).toContain("add-project refused");
  });
});

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
      pull: { code: 0 },
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
    const page = await (await fetch(`${base}/projects/aide`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(page).toContain("This checkout is level with origin.");
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
    const page = await (await fetch(`${base}/projects/aide`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(page).toContain("This checkout is level with origin.");
  });

  test("refuses when no AIDE_INSTALL_CMD is configured — deploying stays a hand step", async () => {
    const git = onMain(0);
    const { base } = start({ queueToken: TOKEN, gitRun: git.run });
    const res = await fetch(`${base}/api/queue/projects/aide/deploy`, { method: "POST", headers: AUTH });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("AIDE_INSTALL_CMD");
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

  test("a no-script press gets the answer as a redirect carrying deployError", async () => {
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
    expect(decodeURIComponent(location)).toContain("feature-x");
  });

  test("only POST — the button's route takes no other method", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue/projects/aide/deploy`, { headers: AUTH });
    expect(res.status).toBe(405);
  });
});

// --- spec 138: the Add says whether a run can start ---------------------------
//
// Adding a project answered "added" and left the operator to press Run to
// find out the rest. Registration and readiness are two answers now, and
// both reach the caller: `ok` says the registration completed, `readiness`
// says whether `aide-run-spec` would start.
describe("POST /api/queue/projects reports readiness (spec 138)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

  /** A git that answers for a checkout which is its own root, clean, on
   *  its default branch — with `answers` layered over it. */
  const readyGit = (answers: Record<string, { code: number; stdout?: string }> = {}) =>
    async (at: string, args: string[]) => {
      const joined = args.join(" ");
      for (const [prefix, a] of Object.entries(answers)) {
        if (joined.startsWith(prefix)) return { code: a.code, stdout: a.stdout ?? "" };
      }
      const clone = args.indexOf("clone");
      if (clone !== -1) {
        mkdirSync(join(at, args[clone + 2]!), { recursive: true });
        return { code: 0, stdout: "" };
      }
      if (joined.startsWith("rev-parse --show-toplevel")) return { code: 0, stdout: `${at}\n` };
      if (joined.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (joined.startsWith("symbolic-ref --short refs/remotes/origin/HEAD")) {
        return { code: 0, stdout: "origin/main\n" };
      }
      if (joined.startsWith("show-ref --verify --quiet refs/heads/main")) return { code: 0, stdout: "" };
      if (joined.startsWith("rev-parse --abbrev-ref HEAD")) return { code: 0, stdout: "main\n" };
      if (joined.startsWith("worktree list")) return { code: 0, stdout: "" };
      return { code: 1, stdout: "" };
    };

  // Criterion 10: additive. A caller that reads `ok`, `project` and
  // `results` sees exactly what it saw before.
  test("a successful add carries readiness beside the steps it always carried", async () => {
    const { base, dir } = start({ queueToken: TOKEN, gitRun: readyGit() });
    const path = join(dir, "root", "ready-one");
    mkdirSync(join(path, "specs"), { recursive: true });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "ready-one", existingPath: path }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    expect(body.project).toBe("ready-one");
    expect(body.results.map((r) => r.step)).toEqual(["name", "register", "manifest", "allowlist"]);
    expect(body.readiness!.canRun).toBe(true);
    expect(body.readiness!.note).toContain("ready to run");
  });

  // Criterion 10, the other half: the two answers are independent. This
  // is Skjer — added, allowlisted, and unable to run.
  test("registration succeeds while the run is blocked, and the answer says both", async () => {
    const { base, dir } = start({ queueToken: TOKEN, gitRun: readyGit() });
    // No specs root, and none named on the form — one of the four
    // things that refused the real Skjer, and the one still left of
    // them that a bare Add cannot put right itself.
    const path = join(dir, "root", "skjer");
    mkdirSync(path, { recursive: true });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "skjer", existingPath: path }),
    });
    // 200: the registration DID complete, and a 400 would tell an API
    // caller to try it again against a checkout that is already there.
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    expect(body.results.every((r) => r.ok)).toBe(true);
    expect(body.readiness!.canRun).toBe(false);
    expect(body.readiness!.note).toContain("cannot run yet");
    expect(body.readiness!.checks.find((c) => c.blocking)!.detail).toContain(join(path, "specs"));
    // And it is on the allowlist regardless: registration is what puts
    // it there, and the readiness answer is about a later moment.
    const html = await (await fetch(`${base}/new`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html.slice(html.indexOf('action="/api/queue/create"'))).toContain('value="skjer"');
  });

  // Criterion 11, the no-JavaScript half: the result cannot be left in a
  // response body the redirect throws away.
  test("a form POST carries the whole readiness answer to the page it lands on", async () => {
    const { base, dir } = start({ queueToken: TOKEN, gitRun: readyGit() });
    const path = join(dir, "root", "noscript");
    mkdirSync(path, { recursive: true });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      body: new URLSearchParams({ name: "noscript", existingPath: path }),
    });
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location.startsWith("/projects?")).toBe(true);
    const params = new URL(location, base).searchParams;
    // Not a yes: the colour of the banner follows the answer, and this
    // project cannot run.
    expect(params.get("noticeOk")).toBeNull();
    const notice = params.get("notice")!;
    // Two things to say at once — the missing specs root, which blocks,
    // and the unconfigured worktree links, which do not — and BOTH of
    // them are in the answer the reader lands on.
    expect(notice).toContain("cannot run yet");
    expect(notice).toContain(join(path, "specs"));
    expect(notice).toContain("worktree links");
    // And the page renders what it was handed.
    const page = await (await fetch(`${base}${location}`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(page).toContain("cannot run yet");
  });

  // Criterion 7, at the route: the field is new, and an unusable value is
  // a refusal of the add rather than a readiness note.
  // Spec 184 moved this key: it is true of the project on any machine,
  // and `.aide/config` is dropped by a global ignore rule, so a clone
  // arrived on the next machine with the answer gone.
  test("worktree links are written to the project's own committed manifest", async () => {
    const { base, dir } = start({ queueToken: TOKEN, gitRun: readyGit() });
    const path = join(dir, "root", "withlinks");
    mkdirSync(join(path, "node_modules"), { recursive: true });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "withlinks", existingPath: path, worktreeLinks: "node_modules" }),
    });
    expect(res.status).toBe(200);
    expect(readFileSync(join(path, ".aide", "project.yaml"), "utf-8")).toContain(
      "worktreeLinks: node_modules",
    );
    expect(existsSync(join(path, ".aide", "config"))).toBe(false);
  });

  test("a worktree link that would leave the repository is refused", async () => {
    const { base, dir } = start({ queueToken: TOKEN, gitRun: readyGit() });
    const path = join(dir, "root", "badlinks");
    mkdirSync(path, { recursive: true });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "badlinks", existingPath: path, worktreeLinks: "../escape" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(false);
    expect(body.results.find((r) => r.step === "worktreeLinks")!.error).toContain("../escape");
    // Nothing readable is claimed about a project that was not added.
    expect(body.readiness).toBeUndefined();
  });
});

describe("POST /api/queue/projects/<name>/remove (spec 112)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

  // Criterion 7.
  test("the name typed back removes it from the allowlist and touches no file", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue/projects/aide/remove`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ confirm: "aide" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    expect(body.results.map((r) => r.step)).toEqual(["confirm", "allowlist"]);
    // The checkout and its specs are exactly where they were.
    expect(existsSync(join(dir, "root", "aide", ".aide", "project.yaml"))).toBe(true);
    expect(existsSync(join(dir, "root", "aide", "specs", "81-queue-and-runner"))).toBe(true);
    // And the page no longer offers it.
    const html = await (await fetch(`${base}/projects`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).not.toContain('action="/api/queue/projects/aide/remove"');
  });

  // Criterion 8.
  test("a confirmation that does not match is refused and changes nothing", async () => {
    const { base } = start({ queueToken: TOKEN });
    for (const confirm of ["", "Aide", "aide "]) {
      const res = await fetch(`${base}/api/queue/projects/aide/remove`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ confirm }),
      });
      expect([confirm, res.status]).toEqual([confirm, 400]);
      const body = (await res.json()) as StepBody;
      expect(body.results[0]!.step).toBe("confirm");
    }
    const html = await (await fetch(`${base}/projects`, { headers: { "x-aide-token": TOKEN } })).text();
    // The row still stands, its Remove link with it (the form itself
    // lives on the row's own confirm page since 2026-08-19).
    expect(html).toContain('href="/projects/aide/remove"');
  });

  test("a project that was never on the allowlist is refused", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue/projects/nosuch/remove`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ confirm: "nosuch" }),
    });
    expect(res.status).toBe(400);
  });

  // Criterion 4, for the second route.
  test("it is behind the same token, and POST only", async () => {
    const { base } = start({ queueToken: TOKEN });
    const body = JSON.stringify({ confirm: "aide" });
    expect(
      (await fetch(`${base}/api/queue/projects/aide/remove`, { method: "POST", body })).status,
    ).toBe(401);
    expect((await fetch(`${base}/api/queue/projects/aide/remove`, { headers: AUTH })).status).toBe(405);
    const off = start({});
    expect(
      (await fetch(`${off.base}/api/queue/projects/aide/remove`, { method: "POST", body })).status,
    ).toBe(503);
  });
});
