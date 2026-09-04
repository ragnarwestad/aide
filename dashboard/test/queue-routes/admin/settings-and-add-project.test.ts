// Split out of project-settings.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ServerOptions } from "../../../src/serve/serve.ts";
import { TOKEN, JOB, setupQueueRoutesHarness } from "../fixtures.ts";

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
    expect(html).toContain('<a class="backlink" href="/projects/aide">← Back</a>');
  });

  // Criterion 4: no Referer at all falls back to today's exact default.
  test("← Back falls back to / with no Referer, criterion 4", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: DEFAULTS });
    const html = await (await fetch(`${base}/settings`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain('<a class="backlink" href="/">← Back</a>');
  });

  // Criterion 5: a foreign-origin Referer is discarded, not followed.
  test("← Back discards a foreign-origin Referer, criterion 5", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: DEFAULTS });
    const html = await (
      await fetch(`${base}/settings`, { headers: { "x-aide-token": TOKEN, referer: "https://evil.example/" } })
    ).text();
    expect(html).toContain('<a class="backlink" href="/">← Back</a>');
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
