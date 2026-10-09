// Split out of settings-and-add-project.test.ts: the Add project route.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ServerOptions } from "../../../../src/serve/serve.ts";
import { createGitRunner } from "../../../../src/git/branch-status.ts";
import { parseManifest } from "../../../../src/project/parse-manifest.ts";
import { git, projectWithOrigin } from "../../../project/admin/git-fixture.ts";
import { latestWikiBuild } from "../../../../src/serve/routes/page-routes/project-pages.ts";
import type { Job } from "../../../../src/queue/types.ts";
import { setupQueueRoutesHarness } from "../../fixtures.ts";

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

  test("the Add answers and queues one wiki build, the one the Wiki tab reads (AC-1) (AC-2)", async () => {
    const { base } = start({ gitRun: cloningGit() });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "newproj", gitUrl: "https://example.com/newproj.git", codeLanding: "merge" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.results.map((r) => r.step)).toEqual(["name", "clone", "manifest", "allowlist"]);
    const queued = ((await (await fetch(`${base}/api/queue`)).json()) as { jobs: Job[] }).jobs;
    const forNew = queued.filter((j) => j.project === "newproj");
    expect(forNew).toHaveLength(1);
    expect(forNew[0]).toMatchObject({ specFolder: "wiki-newproj", steps: ["wiki"], state: "queued" });
    expect(latestWikiBuild(queued, "newproj", "en")?.id).toBe(forNew[0]!.id);
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
    const queued = ((await (await fetch(`${base}/api/queue`)).json()) as { jobs: Job[] }).jobs;
    expect(queued.filter((j) => j.specFolder === "wiki-aide")).toHaveLength(0);
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

  test("a form post with no Code landing is refused with the same sentence (AC-4)", async () => {
    const { base, dir } = start({ gitRun: cloningGit() });
    const FORM = { "content-type": "application/x-www-form-urlencoded" };
    const post = async (fields: Record<string, string>) => {
      const res = await fetch(`${base}/api/queue/projects`, { method: "POST", redirect: "manual", headers: FORM, body: new URLSearchParams(fields) });
      return { status: res.status, body: (await res.json()) as StepBody };
    };
    const noLanding = await post({ name: "nochoice", gitUrl: "https://example.com/nochoice.git" });
    const noAddress = await post({ name: "noaddress", codeLanding: "merge" });
    expect(noLanding.status).toBe(400);
    expect(noLanding.body.results[0]!.error).toMatch(/^choose/);
    expect(noAddress.status).toBe(400);
    expect(noAddress.body.results[0]!.error).toMatch(/^say/);
    expect(existsSync(join(dir, "root", "nochoice"))).toBe(false);
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

  const previewFromIn = (text: string) => {
    const parsed = parseManifest(text);
    return parsed.ok ? parsed.data.deployment?.previewFrom : undefined;
  };

  test("a previewFrom chosen on a project that tracks no manifest is saved to settings.yaml (AC-2, AC-4)", async () => {
    const { base, dir } = start({ gitRun: cloningGit() });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({
        name: "chosen",
        gitUrl: "https://example.com/chosen.git",
        codeLanding: "merge",
        previewFrom: "cloudflare-pages",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    expect(body.results.find((r) => r.step === "previewFrom")?.ok).toBe(true);
    const settings = readFileSync(join(dir, "owned", "chosen", "settings.yaml"), "utf-8");
    expect(previewFromIn(settings)).toBe("cloudflare-pages");
  });

  test("none, no previewFrom and empty commands write no key and add no step (AC-1, AC-2)", async () => {
    const { base, dir } = start({ gitRun: cloningGit() });
    for (const [name, extra] of [
      ["picked-none", { previewFrom: "none" }],
      ["picked-nothing", {}],
      ["picked-empty-commands", { testCmd: "", installCmd: "", previewCmd: "" }],
    ] as const) {
      const res = await fetch(`${base}/api/queue/projects`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ name, gitUrl: `https://example.com/${name}.git`, codeLanding: "merge", ...extra }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as StepBody;
      expect(body.results.map((r) => r.step)).toEqual(["name", "clone", "manifest", "allowlist"]);
      const settings = readFileSync(join(dir, "owned", name, "settings.yaml"), "utf-8");
      expect(settings).not.toContain("deployment");
      expect(settings).not.toMatch(/AIDE_TEST_CMD|previewCmd/);
      expect(existsSync(join(dir, "root", name, ".aide", "config"))).toBe(false);
    }
  });

  test("an unknown previewFrom is refused through the route, and nothing is cloned (AC-2)", async () => {
    const { base, dir } = start({ gitRun: cloningGit() });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "odd", gitUrl: "https://example.com/odd.git", codeLanding: "merge", previewFrom: "vercel" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as StepBody).results[0]).toMatchObject({ step: "previewFrom", ok: false });
    expect(existsSync(join(dir, "root", "odd"))).toBe(false);
  });

  test("a choice on a project that tracks its manifest is committed to it, and the rest of the file stays (AC-2)", async () => {
    const manifest = "name: demo\ndeployment:\n  host: Cloudflare Pages\nlogging:\n  where: Cloudflare dashboard\n";
    const f = projectWithOrigin({ ".aide/project.yaml": manifest }, { clone: false });
    try {
      const real = createGitRunner(30_000);
      const committer = { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" };
      const { base } = start({ gitRun: (cwd, args, timeout, env) => real(cwd, args, timeout, { ...committer, ...env }) });
      const res = await fetch(`${base}/api/queue/projects`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ name: "demo", gitUrl: f.origin, codeLanding: "merge", previewFrom: "command" }),
      });
      const body = (await res.json()) as StepBody;
      expect(body.results.find((r) => r.step === "previewFrom")).toEqual({ step: "previewFrom", ok: true });
      const onOrigin = git(f.origin, "show", "main:.aide/project.yaml");
      expect(previewFromIn(onOrigin)).toBe("command");
      expect(onOrigin).toBe(manifest.replace("  host: Cloudflare Pages\n", "  host: Cloudflare Pages\n  previewFrom: command\n"));
    } finally {
      f.cleanup();
    }
  });

  test("the three commands typed on Add are saved where the Config tab saves them (AC-1)", async () => {
    const { base, dir } = start({ gitRun: cloningGit() });
    const res = await fetch(`${base}/api/queue/projects`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({
        name: "commands",
        gitUrl: "https://example.com/commands.git",
        codeLanding: "merge",
        testCmd: "make test",
        installCmd: "make install",
        previewCmd: "make serve",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as StepBody;
    expect(body.ok).toBe(true);
    for (const step of ["testCmd", "installCmd", "previewCmd"]) {
      expect(body.results.find((r) => r.step === step)?.ok).toBe(true);
    }
    const settings = parseManifest(readFileSync(join(dir, "owned", "commands", "settings.yaml"), "utf-8"));
    expect(settings.ok && settings.data.AIDE_TEST_CMD).toBe("make test");
    expect(settings.ok && settings.data.previewCmd).toBe("make serve");
    expect(readFileSync(join(dir, "root", "commands", ".aide", "config"), "utf-8")).toContain("AIDE_INSTALL_CMD=make install\n");
  });

  test("every setting typed on Add is committed to a tracked manifest, and the rest of the file stays (AC-1, AC-3)", async () => {
    const manifest = "name: demo\nlogging:\n  where: Cloudflare dashboard\n";
    const f = projectWithOrigin({ ".aide/project.yaml": manifest }, { clone: false });
    try {
      const real = createGitRunner(30_000);
      const committer = { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" };
      const { base } = start({ gitRun: (cwd, args, timeout, env) => real(cwd, args, timeout, { ...committer, ...env }) });
      const res = await fetch(`${base}/api/queue/projects`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({
          name: "demo",
          gitUrl: f.origin,
          codeLanding: "pr",
          previewFrom: "command",
          testCmd: "make test",
          worktreeLinks: "node_modules",
          description: "Aide: the board",
        }),
      });
      expect(((await res.json()) as StepBody).ok).toBe(true);
      const onOrigin = git(f.origin, "show", "main:.aide/project.yaml");
      const parsed = parseManifest(onOrigin);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.data).toMatchObject({
        name: "demo",
        AIDE_TEST_CMD: "make test",
        worktreeLinks: "node_modules",
        codeLanding: "pr",
        description: "Aide: the board",
        deployment: { previewFrom: "command" },
      });
      for (const line of manifest.split("\n").filter(Boolean)) expect(onOrigin.split("\n")).toContain(line);
    } finally {
      f.cleanup();
    }
  });

  test("the test-command route answers what a git address's root files point at, and refuses a GET (AC-1)", async () => {
    const f = projectWithOrigin({ "package-lock.json": "{}" }, { clone: false });
    try {
      git(f.origin, "config", "uploadpack.allowFilter", "true");
      const { base } = start({ gitRun: createGitRunner(30_000) });
      const res = await fetch(`${base}/api/queue/projects/test-command`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ gitUrl: `file://${f.origin}` }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, testCmd: "npm test" });
      expect((await fetch(`${base}/api/queue/projects/test-command`)).status).toBe(405);
    } finally {
      f.cleanup();
    }
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
