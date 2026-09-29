// Split out of project-settings.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ServerOptions } from "../../../src/serve/serve.ts";
import { SETTINGS_STEPS } from "../../../src/render";
import { JOB, setupQueueRoutesHarness } from "../fixtures.ts";

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
  const DEFAULTS = {
    timeoutSec: { default: 1200, implement: 5400 }, permissionMode: { default: "acceptEdits" },
    model: { default: "sonnet" },
    modelChoices: { sonnet: {}, "codex-fast": { tool: "codex" as const } },
  };
  const AUTH = { "content-type": "application/json", accept: "application/json" };
  const validModel = Object.fromEntries(SETTINGS_STEPS.map((step) => [step, "sonnet"]));
  const validTimeoutSec = Object.fromEntries(SETTINGS_STEPS.map((step) => [step, 30]));
  const validBody = { model: validModel, timeoutSec: validTimeoutSec };

  // The check spawns a CLI and reaches the network, so a GET of the page
  // must never start one: it happens when the button is pressed.
  test("opening an AI tab runs no check", async () => {
    const { base } = start({ queueDefaults: DEFAULTS });
    const html = await (
      await fetch(`${base}/settings?tab=opencode`, )
    ).text();
    expect(html).toContain('data-tool="opencode"');
    expect(html).toContain("Not checked yet.");
  });

  test("the old Phases link still serves the models form (AC-4)", async () => {
    const { base } = start({ queueDefaults: DEFAULTS });
    const html = await (await fetch(`${base}/settings?tab=phases`)).text();
    expect(html).toContain("data-settings-form");
  });

  test("the check route refuses a tool it does not know", async () => {
    const { base } = start({ queueDefaults: DEFAULTS });
    const res = await fetch(`${base}/api/queue/settings/check`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Ask for JSON, or the refusal comes back as the no-script
        // redirect and `fetch` follows it to a 200 page.
        accept: "application/json",
      },
      body: JSON.stringify({ tool: "../../bin/sh" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("unknown tool") });
  });

  test("a refusal with no script lands back on Settings, saying why", async () => {
    const { base } = start({ queueDefaults: DEFAULTS });
    const res = await fetch(`${base}/api/queue/settings/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "nope" }),
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/settings?error=");
  });

  test("the check route answers GET with method not allowed", async () => {
    const { base } = start({ queueDefaults: DEFAULTS });
    const res = await fetch(`${base}/api/queue/settings/check`, );
    expect(res.status).toBe(405);
  });

  test("a successful save affects later jobs but not an accepted job (AC-4)", async () => {
    const file = ownConfig({ model: { default: "sonnet", future: "keep" } });
    const { base } = start({ queueDefaults: DEFAULTS, queueConfigFile: file });
    const accepted = await fetch(`${base}/api/queue`, {
      method: "POST", headers: AUTH, body: JSON.stringify(JOB),
    });
    const first = (await accepted.json()) as { job: { model: Record<string, string> } };
    const model = Object.fromEntries(SETTINGS_STEPS.map((step) => [step, "codex-fast"]));
    const saved = await fetch(`${base}/api/queue/settings`, {
      method: "POST", headers: AUTH, body: JSON.stringify({ model, timeoutSec: validTimeoutSec }),
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
    const createdBody = (await created.json()) as { job: { model: Record<string, string> } };
    expect(createdBody.job.model.create).toBe("codex-fast");
    expect(readFileSync(file, "utf-8")).toContain('"future": "keep"');
  });

  // Settings has no Fallback row, so the route saves the step rows only:
  // a `default` posted beside them is an unknown step, and nothing on
  // disk changes; the step rows alone save.
  test("a save naming model.default is refused and changes nothing (AC-2)", async () => {
    const file = ownConfig({ model: { default: "sonnet" } });
    const { base } = start({ queueDefaults: DEFAULTS, queueConfigFile: file });
    const refused = await fetch(`${base}/api/queue/settings`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...validBody, model: { ...validModel, default: "codex-fast" } }),
    });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toContain("unknown workflow step: default");
    expect(readFileSync(file, "utf-8")).toEqual(JSON.stringify({ model: { default: "sonnet" } }, null, 2));
    const saved = await fetch(`${base}/api/queue/settings`, {
      method: "POST", headers: AUTH, body: JSON.stringify(validBody),
    });
    expect(saved.status).toBe(200);
  });

  // Spec 494: a model typed in a different case is stored as listed.
  test("a differently-cased model is saved under the listed spelling", async () => {
    const file = ownConfig({ model: { default: "sonnet" } });
    const { base } = start({ queueDefaults: DEFAULTS, queueConfigFile: file });
    const res = await fetch(`${base}/api/queue/settings`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...validBody, model: { ...validModel, analyze: "CODEX-FAST" } }),
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(file, "utf-8")) as { model: Record<string, string> };
    expect(saved.model.analyze).toBe("codex-fast");
  });

  test("several case-only matches are refused, naming both, and nothing is written", async () => {
    const file = ownConfig({ model: { default: "sonnet" } });
    const defaults = { ...DEFAULTS, modelChoices: { Sonnet: {}, SONNET: {} } };
    const { base } = start({ queueDefaults: defaults, queueConfigFile: file });
    const res = await fetch(`${base}/api/queue/settings`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ ...validBody, model: { ...validModel, analyze: "sonnet" } }),
    });
    expect(res.status).toBe(400);
    const error = ((await res.json()) as { error: string }).error;
    expect(error).toContain("Sonnet");
    expect(error).toContain("SONNET");
    expect(readFileSync(file, "utf-8")).toEqual(JSON.stringify({ model: { default: "sonnet" } }, null, 2));
  });

  test("invalid input and missing config leave live defaults unchanged", async () => {
    const file = ownConfig({ model: { default: "sonnet" } });
    const { base } = start({ queueDefaults: DEFAULTS, queueConfigFile: file });
    for (const model of [
      { analyze: "sonnet" },
      { ...Object.fromEntries(SETTINGS_STEPS.map((step) => [step, "sonnet"])), extra: "sonnet" },
      Object.fromEntries(SETTINGS_STEPS.map((step) => [step, step === "archive" ? "missing" : "sonnet"])),
    ]) {
      const res = await fetch(`${base}/api/queue/settings`, {
        method: "POST", headers: AUTH, body: JSON.stringify({ ...validBody, model }),
      });
      expect(res.status).toBe(400);
    }
    // Out-of-range / non-numeric per-step timeout.
    for (const overrides of [
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

    const without = start({ queueDefaults: DEFAULTS });
    const res = await fetch(`${without.base}/api/queue/settings`, {
      method: "POST", headers: AUTH, body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/queue/projects (spec 112)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json" };

  // Criterion 1.
  test("a git URL is cloned, given a manifest, and put on the allowlist", async () => {
    const { base, dir } = start({ gitRun: cloningGit() });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "newproj", gitUrl: "https://example.com/newproj.git", codeLanding: "merge" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    expect(body.results.map((r) => r.step)).toEqual(["name", "clone", "manifest", "allowlist"]);
    expect(body.results.every((r) => r.ok)).toBe(true);
    // Spec 512: nothing of Aide's is written into the clone; the
    // dashboard keeps the settings beside its own checkouts.
    expect(existsSync(join(dir, "root", "newproj", ".aide", "project.yaml"))).toBe(false);
    expect(existsSync(join(dir, "owned", "newproj", "settings.yaml"))).toBe(true);
    // On the allowlist the MOMENT it is done — no restart, and no
    // waiting for the five-second scan: the New-spec form's project
    // list is the raw allowlist, so it shows a project with no spec yet.
    const html = await (await fetch(`${base}/new`, )).text();
    expect(html.slice(html.indexOf('action="/api/queue/create"'))).toContain('value="newproj"');
  });

  // Criterion 2.
  test("a name already taken under the projects root is refused, and names the collision", async () => {
    const { base, dir } = start({ gitRun: cloningGit() });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "aide", gitUrl: "https://example.com/aide.git", codeLanding: "merge" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(false);
    expect(body.results.find((r) => r.step === "clone")!.error).toContain("aide");
    expect(existsSync(join(dir, "root", "aide", ".git"))).toBe(false);
  });

  // Criterion 3, at the route level.
  test("an unsafe name is refused before anything is cloned or written", async () => {
    const { base, dir } = start({ gitRun: cloningGit() });
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

  test("an Add with no Code landing is refused, and nothing is cloned or put on the allowlist (AC-3)", async () => {
    const { base, dir } = start({ gitRun: cloningGit() });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "nochoice", gitUrl: "https://example.com/nochoice.git" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(false);
    expect(existsSync(join(dir, "root", "nochoice"))).toBe(false);
    expect(existsSync(join(dir, "owned", "nochoice"))).toBe(false);
    const html = await (await fetch(`${base}/new`)).text();
    expect(html.slice(html.indexOf('action="/api/queue/create"'))).not.toContain('value="nochoice"');
  });

  test("the Code landing refusal has the shape of the git-address refusal (AC-4)", async () => {
    const { base } = start({ gitRun: cloningGit() });
    const post = async (payload: object) => {
      const res = await fetch(`${base}/api/queue/projects`, { method: "POST", headers: AUTH, body: JSON.stringify(payload) });
      return { status: res.status, body: (await res.json()) as StepBody };
    };
    const noLanding = await post({ name: "nochoice", gitUrl: "https://example.com/nochoice.git" });
    const noAddress = await post({ name: "noaddress", codeLanding: "merge" });
    expect(noLanding.status).toBe(400);
    expect(noAddress.status).toBe(400);
    expect(Object.keys(noLanding.body).sort()).toEqual(Object.keys(noAddress.body).sort());
    for (const { body } of [noLanding, noAddress]) {
      expect(Object.keys(body.results[0]!).sort()).toEqual(["error", "ok", "step"]);
      expect(body.results[0]!.ok).toBe(false);
      const error = body.results[0]!.error!;
      expect(error).not.toContain("\n");
      expect(error[0]).toBe(error[0]!.toLowerCase());
    }
    expect(noLanding.body.results[0]!.error).toMatch(/^choose/);
    expect(noAddress.body.results[0]!.error).toMatch(/^say/);
  });

  test("a form post with no Code landing goes back to the Add page with the sentence (AC-4)", async () => {
    const { base } = start({ gitRun: cloningGit() });
    const FORM = { "content-type": "application/x-www-form-urlencoded" };
    const post = (fields: Record<string, string>) =>
      fetch(`${base}/api/queue/projects`, { method: "POST", redirect: "manual", headers: FORM, body: new URLSearchParams(fields) });
    const noLanding = await post({ name: "nochoice", gitUrl: "https://example.com/nochoice.git" });
    const noAddress = await post({ name: "noaddress", codeLanding: "merge" });
    expect(noLanding.status).toBe(303);
    const location = noLanding.headers.get("location")!;
    expect(location.startsWith("/projects/new?error=")).toBe(true);
    expect(decodeURIComponent(location)).toMatch(/choose/i);
    expect(noAddress.headers.get("location")!.startsWith("/projects/new?error=")).toBe(true);
  });

  // Criterion 6: a clone with no manifest gets one, and the answer says
  // so rather than leaving the operator to find out.
  test("a clone with no manifest is added, and the made manifest is reported", async () => {
    const { base } = start({ gitRun: cloningGit() });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({
        name: "already-here",
        gitUrl: "https://example.com/already-here.git",
        codeLanding: "merge",
        description: "on disk already",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    expect(body.results.map((r) => r.step)).toEqual(["name", "clone", "manifest", "allowlist"]);
    expect(body.results.find((r) => r.step === "manifest")!.note).toMatch(/aide-manifest/);
  });

  // The name the ALLOWLIST gets is the name the directory gets, trimmed:
  // posting it with spaces around it used to allowlist a name no
  // directory has, and the project would never be runnable.
  test("the name is allowlisted as the directory is named, trimmed", async () => {
    const file = ownConfig({ concurrency: 2 });
    const { base } = start({ queueConfigFile: file, gitRun: cloningGit() });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "  picked  ", gitUrl: "https://example.com/picked.git", codeLanding: "merge" }),
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
    const { base } = start({ queueConfigFile: file, gitRun: cloningGit() });
    await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "newproj", gitUrl: "https://example.com/newproj.git", codeLanding: "merge" }),
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
    const { base } = start({ queueConfigFile: file, gitRun: cloningGit() });
    const add = (name: string) =>
      fetch(`${base}/api/queue/projects`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ name, gitUrl: `https://example.com/${name}.git`, codeLanding: "merge" }),
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
    const { base } = start({ gitRun: cloningGit() });
    const FORM = { "content-type": "application/x-www-form-urlencoded" };
    const refused = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ name: "../escape", gitUrl: "https://example.com/x.git" }),
    });
    expect(refused.status).toBe(303);
    // Back to the page the FORM is on (2026-08-19): the Add page.
    expect(refused.headers.get("location")!.startsWith("/projects/new?error=")).toBe(true);

    const ok = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      redirect: "manual",
      headers: FORM,
      body: new URLSearchParams({ name: "on-disk", gitUrl: "https://example.com/on-disk.git", codeLanding: "merge" }),
    });
    expect(ok.status).toBe(303);
    // The list, as it has been since spec 115 — carrying the readiness
    // answer since spec 138, which is that spec's to assert.
    expect(ok.headers.get("location")!.split("?")[0]).toBe("/projects");
  });

  test("a refusal reaches the log", async () => {
    const { base } = start();
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
