// Split out of project-settings.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

// Spec 408, REQ-1/REQ-4: the Projects list and the Remove confirmation
// page read and remember the language the same way `/` already does.
describe("GET /projects and GET /projects/<name>/remove (spec 408)", () => {
  test("GET /projects: ?lang=nb sets the cookie and renders a Norwegian frame", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/projects?lang=nb`, { headers: { "x-aide-token": TOKEN } });
    expect(res.headers.getSetCookie().find((c) => c.startsWith("aide_lang=nb"))).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('<html lang="nb">');
  });

  test("GET /projects/<name>/remove: ?lang=nb sets the cookie and renders a Norwegian frame", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/projects/aide/remove?lang=nb`, { headers: { "x-aide-token": TOKEN } });
    expect(res.headers.getSetCookie().find((c) => c.startsWith("aide_lang=nb"))).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('<html lang="nb">');
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
