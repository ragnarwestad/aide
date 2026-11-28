// The schedule entry API routes: create, edit, the Enabled toggle, Run-now,
// delete and the cron-next preview — the HTTP-level proof that
// `schedule-admin.ts`'s rules are reachable over the wire. A save writes the
// `schedules` key of the server's queue config file and commits nothing;
// `test/project/admin/schedule-admin.test.ts` proves the same rules at the
// unit level.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueHarness } from "../../helpers/queue-server.ts";
import { scheduleTrackingKey } from "../../../src/project/spec-names.ts";
import type { ServerOptions } from "../../../src/serve/serve.ts";

const harness = queueHarness("aide-schedule-admin-routes-");
const configDirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (configDirs.length) rmSync(configDirs.pop()!, { recursive: true, force: true });
});

const asJson = { headers: { accept: "application/json" } };
const jsonPost = (body: unknown) => ({
  method: "POST",
  headers: { accept: "application/json", "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** A queue config with two models to choose between, for the tests about
 *  an entry's own model pick. */
const DEFAULTS = {
  timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
  modelChoices: { sonnet: {}, "codex-fast": { tool: "codex" as const } },
};

type Seed = Record<string, unknown>;

/** A server whose queue config file is `queue-config.json` in a directory of
 *  its own, seeded with `entries` under `aide`; the project's checkout has
 *  the prompt file and a manifest, and `gitRun` records every git command. */
function start(entries: Seed[] = [], extra: Partial<ServerOptions> = {}) {
  const cfgDir = mkdtempSync(join(tmpdir(), "aide-schedule-cfg-"));
  configDirs.push(cfgDir);
  const file = join(cfgDir, "queue-config.json");
  // A seeded entry with no `since` is due at the tick's first look and
  // would be queued behind the test's back, so each is stamped in the future.
  const since = new Date(Date.now() + 3_600_000).toISOString();
  if (entries.length) {
    writeFileSync(file, JSON.stringify({ schedules: { aide: entries.map((e) => ({ since, ...e })) } }));
  }
  const gitCalls: string[][] = [];
  const started = harness.start({
    extra: {
      queueConfigFile: file,
      gitRun: async (_dir: string, args: string[]) => {
        gitCalls.push(args);
        return { code: 0, stdout: "", stderr: "" };
      },
      ...extra,
    },
  });
  const project = join(started.dir, "root", "aide");
  writeFileSync(join(project, "docs-nightly.md"), "# nightly\n");
  mkdirSync(join(project, ".aide"), { recursive: true });
  const manifest = join(project, ".aide", "project.yaml");
  writeFileSync(manifest, "name: aide\n");
  return {
    ...started,
    file,
    manifest,
    gitCalls,
    stored: (): Seed[] => {
      try {
        return (JSON.parse(readFileSync(file, "utf-8")).schedules?.aide ?? []) as Seed[];
      } catch {
        return [];
      }
    },
    wroteToGit: () => gitCalls.some((a) => ["commit", "push", "add"].includes(a[0]!)),
  };
}

const nightly = (over: Seed = {}): Seed => ({ name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md", ...over });
const weekly = (): Seed => ({ name: "weekly", cron: "0 4 * * 0", prompt: "docs-nightly.md" });

describe("POST /api/queue/schedule — create, project read from the body", () => {
  test("a valid entry is written to the config file and nothing goes to git", async () => {
    const t = start();
    const before = Date.now();
    const res = await fetch(`${t.base}/api/queue/schedule`, jsonPost({ project: "aide", ...nightly() }));
    const after = Date.now();
    expect(res.status).toBe(200);
    const [entry] = t.stored();
    expect(entry).toMatchObject(nightly());
    expect(Date.parse(String(entry!.since))).toBeGreaterThanOrEqual(before);
    expect(Date.parse(String(entry!.since))).toBeLessThanOrEqual(after);
    expect(readFileSync(t.manifest, "utf-8")).toBe("name: aide\n");
    expect(t.wroteToGit()).toBe(false);
  });

  test("a project the allowlist does not contain is refused (400) before any write", async () => {
    const t = start();
    const res = await fetch(`${t.base}/api/queue/schedule`, jsonPost({ project: "ghost-project", ...nightly() }));
    expect(res.status).toBe(400);
    expect(t.stored()).toEqual([]);
  });

  const formPost = (fields: Record<string, string>) => ({
    method: "POST",
    redirect: "manual" as const,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });

  test("a form save answers where to go back to: the page the form was opened from, or the project's Schedule tab", async () => {
    const t = start();
    const fields = { project: "aide", name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md" };
    const res = await fetch(`${t.base}/api/queue/schedule`, formPost({ ...fields, back: "/schedule?q=night" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, location: "/schedule?q=night" });
    const bare = await fetch(`${t.base}/api/queue/schedule`, formPost({ ...fields, name: "other" }));
    expect(await bare.json()).toEqual({ ok: true, location: "/projects/aide?tab=schedule" });
  });
});

describe("POST /api/queue/schedule/<project>/<name> — edit", () => {
  test("saves Enabled together with the other edited settings (AC-3)", async () => {
    const t = start([nightly()]);
    const res = await fetch(`${t.base}/api/queue/schedule/aide/nightly`, jsonPost(nightly({ cron: "0 5 * * *", enabled: "no" })));
    expect(res.status).toBe(200);
    expect(t.stored()[0]!.cron).toBe("0 5 * * *");
    expect(t.stored()[0]!.enabled).toBe(false);
  });

  test("saves Enabled under the trimmed name when the posted name has spaces around it (AC-3)", async () => {
    const t = start([nightly()]);
    const res = await fetch(`${t.base}/api/queue/schedule/aide/nightly`, jsonPost(nightly({ name: " nightly ", enabled: "no" })));
    expect(res.status).toBe(200);
    expect(t.stored()[0]!.name).toBe("nightly");
    expect(t.stored()[0]!.enabled).toBe(false);
  });

  test("a rename sends a save opened from the entry's own page to its new page, and a back off the board is not followed", async () => {
    const t = start([nightly()]);
    const renamed = await fetch(`${t.base}/api/queue/schedule/aide/nightly`,
      jsonPost(nightly({ name: "renamed", back: "/schedule/aide/nightly?tab=settings" })));
    expect(await renamed.json()).toEqual({ ok: true, location: "/schedule/aide/renamed?tab=settings" });
    const away = await fetch(`${t.base}/api/queue/schedule/aide/renamed`, jsonPost(nightly({ name: "renamed", back: "//evil.example/" })));
    expect(await away.json()).toEqual({ ok: true, location: "/projects/aide?tab=schedule" });
  });
});

describe("POST /api/queue/schedule/<project>/<name>/enabled", () => {
  test("a plain body with only `enabled` pauses the entry, and `true` resumes it", async () => {
    const t = start([nightly()]);
    const off = await fetch(`${t.base}/api/queue/schedule/aide/nightly/enabled`, jsonPost({ enabled: false }));
    expect(off.status).toBe(200);
    expect(t.stored()[0]!.enabled).toBe(false);
    const on = await fetch(`${t.base}/api/queue/schedule/aide/nightly/enabled`, jsonPost({ enabled: true }));
    expect(on.status).toBe(200);
    expect(t.stored()[0]).not.toHaveProperty("enabled");
    expect(t.wroteToGit()).toBe(false);
  });
});

describe("the entry's model, over the wire", () => {
  test("sandbox off is refused unless the run is on Claude, the posted model's or the default's", async () => {
    const t = start([nightly({ model: "codex-fast" })], { queueDefaults: DEFAULTS });
    const created = await fetch(`${t.base}/api/queue/schedule`, jsonPost({ project: "aide", ...weekly(), model: "codex-fast", sandbox: "off" }));
    expect(created.status).toBe(400);
    const edited = await fetch(`${t.base}/api/queue/schedule/aide/nightly`, jsonPost(nightly({ model: "codex-fast", sandbox: "off" })));
    expect(edited.status).toBe(400);
    expect(t.stored()).toHaveLength(1);
    expect(t.stored()[0]!.sandbox).toBeUndefined();
    const onDefault = await fetch(`${t.base}/api/queue/schedule/aide/nightly`, jsonPost(nightly({ model: "", sandbox: "off" })));
    expect(onDefault.status).toBe(200);
    expect(t.stored()[0]!.sandbox).toBe(false);
  });

  test("create stores the posted model on the entry", async () => {
    const t = start([], { queueDefaults: DEFAULTS });
    const res = await fetch(`${t.base}/api/queue/schedule`, jsonPost({ project: "aide", ...nightly({ model: "codex-fast" }) }));
    expect(res.status).toBe(200);
    expect(t.stored()[0]!.model).toBe("codex-fast");
  });
});

describe("the entry's notification choice, over the wire", () => {
  test("create stores the posted choice, from JSON and from a form", async () => {
    const t = start();
    const res = await fetch(`${t.base}/api/queue/schedule`, jsonPost({ project: "aide", ...nightly({ notify: "always" }) }));
    expect(res.status).toBe(200);
    expect(t.stored()[0]!.notify).toBe("always");

    const form = start();
    const posted = await fetch(`${form.base}/api/queue/schedule`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ project: "aide", name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md", notify: "never" }),
    });
    expect(posted.status).toBe(200);
    expect(form.stored()[0]!.notify).toBe("never");
  });

  test("the browser choice the form posts reaches the stored entry", async () => {
    const form = start();
    const posted = await fetch(`${form.base}/api/queue/schedule`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ project: "aide", name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md", chrome: "yes", sandbox: "off" }),
    });
    expect(posted.status).toBe(200);
    expect(form.stored()[0]!.chrome).toBe(true);
    expect(form.stored()[0]!.sandbox).toBe(false);
  });
});

describe("POST /api/queue/schedule/<project>/<name>/run", () => {
  test("enqueues the schedule job under the entry's tracking key", async () => {
    const t = start([nightly()]);
    const res = await fetch(`${t.base}/api/queue/schedule/aide/nightly/run`, { method: "POST", ...asJson });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job.project).toBe("aide");
    expect(body.job.specFolder).toBe("schedule-nightly");
    expect(body.job.steps).toEqual(["schedule"]);
  });

  // Run now is this entry firing early, not a different job: it has to
  // run on the model the entry names.
  test("the job runs on the model the entry names", async () => {
    const t = start([nightly({ model: "codex-fast" })], { queueDefaults: DEFAULTS });
    const res = await fetch(`${t.base}/api/queue/schedule/aide/nightly/run`, { method: "POST", ...asJson });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job.modelChoice).toBe("codex-fast");
    expect(body.job.model.schedule).toBe("codex-fast");
  });

  test("an entry naming no model is enqueued without one — the configuration decides", async () => {
    const t = start([nightly()], { queueDefaults: DEFAULTS });
    const res = await fetch(`${t.base}/api/queue/schedule/aide/nightly/run`, { method: "POST", ...asJson });
    expect(res.status).toBe(200);
    expect((await res.json()).job.modelChoice).toBeUndefined();
  });
});

describe("Run now on an entry the queue refuses", () => {
  /** `console.error` swapped for the length of one case. */
  async function withLoggedErrors<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
    const original = console.error;
    const lines: string[] = [];
    console.error = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
      return { value: await run(), lines };
    } finally {
      console.error = original;
    }
  }

  test("a JSON press names the entry and gives the queue's reason, and is logged once", async () => {
    const t = start([nightly({ model: "retired" })], { queueDefaults: DEFAULTS });
    const { value: res, lines } = await withLoggedErrors(() =>
      fetch(`${t.base}/api/queue/schedule/aide/nightly/run`, { method: "POST", ...asJson }),
    );
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error.startsWith("Run now was refused for aide:nightly:")).toBe(true);
    expect(error).toContain("unknown or not-allowed model: retired");
    const logged = lines.filter((l) => l.includes("run now refused for aide/nightly"));
    expect(logged).toHaveLength(1);
  });
});

describe("POST /api/queue/schedule/<project>/<name>/delete", () => {
  test("deletes the entry, leaves the others, and nothing goes to git", async () => {
    const t = start([nightly(), weekly()]);
    const res = await fetch(`${t.base}/api/queue/schedule/aide/nightly/delete`, jsonPost({}));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(t.stored().map((e) => e.name)).toEqual(["weekly"]);
    expect(t.wroteToGit()).toBe(false);
  });

  test("an unallowed project refuses with 400", async () => {
    const t = start();
    const res = await fetch(`${t.base}/api/queue/schedule/ghost-project/nightly/delete`, jsonPost({}));
    expect(res.status).toBe(400);
  });

  test("a job enqueued under the entry's tracking key survives the entry's deletion", async () => {
    const t = start([nightly()]);
    expect((await fetch(`${t.base}/api/queue/schedule/aide/nightly/run`, { method: "POST", ...asJson })).status).toBe(200);
    expect((await fetch(`${t.base}/api/queue/schedule/aide/nightly/delete`, jsonPost({}))).status).toBe(200);
    const { jobs } = await (await fetch(`${t.base}/api/queue`, asJson)).json();
    expect(
      jobs.some((j: { project: string; specFolder: string }) => j.project === "aide" && j.specFolder === scheduleTrackingKey("nightly")),
    ).toBe(true);
  });
});

describe("GET /api/queue/schedule/cron-next", () => {
  test("a valid cron returns the same timestamp nextFireTime would compute", async () => {
    const t = start();
    const res = await fetch(`${t.base}/api/queue/schedule/cron-next?${new URLSearchParams({ cron: "0 3 * * *" })}`, asJson);
    expect(res.status).toBe(200);
    expect((await res.json()).next).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("an invalid cron returns an error and no timestamp", async () => {
    const t = start();
    const res = await fetch(`${t.base}/api/queue/schedule/cron-next?${new URLSearchParams({ cron: "not-a-cron" })}`, asJson);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.next).toBeUndefined();
    expect(body.error).toBeTruthy();
  });
});

const retryDefaults = { ...DEFAULTS, providers: { Claude: { name: "Claude", tool: "claude" as const }, Codex: { name: "Codex", tool: "codex" as const } } };
const oldAttempt = { id: "old-report", project: "aide", specFolder: "schedule-nightly", steps: ["schedule"], stepIndex: 0,
  state: "failed", stopReason: "timeout", createdAt: "2026-11-01T00:00:00Z", timeoutSec: {}, permissionMode: {}, model: {}, results: [] };

test("retry stores transient choices once and keeps schedule settings and history (AC-4, AC-5, AC-6)", async () => {
  const seedDir = mkdtempSync(join(tmpdir(), "aide-schedule-seed-"));
  configDirs.push(seedDir);
  const mirror = join(seedDir, "retry.json");
  // Seed the server with a settled attempt.
  writeFileSync(mirror, JSON.stringify([oldAttempt]));
  const r = start([nightly({ model: "sonnet", provider: "Claude", notify: "always", chrome: true, sandbox: false })],
    { queueDefaults: retryDefaults, queueMirrorPath: mirror });
  const before = readFileSync(r.file, "utf8");
  const url = `${r.base}/api/queue/schedule/aide/nightly/run`;
  const picked = { sourceJobId: oldAttempt.id, provider: "Codex", model: "codex-fast" };
  const response = await fetch(url, jsonPost(picked));
  expect(response.status).toBe(200);
  const fresh = (await response.json()).job;
  expect(fresh.id).not.toBe(oldAttempt.id);
  expect(fresh.model.schedule).toBe("codex-fast");
  expect(fresh.provider.schedule).toBe("Codex");
  expect((await fetch(url, jsonPost(picked))).status).toBe(400);
  expect(readFileSync(r.file, "utf8")).toBe(before);
  const listed = (await (await fetch(`${r.base}/api/queue`)).json()).jobs;
  expect(listed.find((j: { id: string }) => j.id === oldAttempt.id).state).toBe("failed");
  expect(listed).toHaveLength(2);
  expect((await fetch(`${r.base}/api/queue/${fresh.id}/cancel`, jsonPost({}))).status).toBe(200);
  expect(readFileSync(r.file, "utf8")).toBe(before);
  const ordinary = await fetch(url, jsonPost({}));
  expect((await ordinary.json()).job.model.schedule).toBe("sonnet");
});

test("retry refuses unknown sources, missing entries and invalid choices (AC-4, AC-5)", async () => {
  const t = start([nightly()], { queueDefaults: retryDefaults });
  for (const body of [null, [], "invalid", { model: 7 }, { provider: "" }, { sourceJobId: "missing" }, { model: "retired" }, { provider: "Claude", model: "codex-fast" }]) {
    expect((await fetch(`${t.base}/api/queue/schedule/aide/nightly/run`, jsonPost(body))).status).toBe(400);
  }
  expect((await fetch(`${t.base}/api/queue/schedule/aide/missing/run`, jsonPost({}))).status).toBe(400);
  expect((await (await fetch(`${t.base}/api/queue`)).json()).jobs).toHaveLength(0);
});

test("retry checks the source identity and settled state before insertion (AC-5)", async () => {
  for (const over of [{ state: "done" },
    { project: "other" }, { specFolder: "schedule-other" }, { steps: ["analyze"] },
    { state: "waiting", stopReason: "provider-limit", usageLimitWait: { until: "2027-01-01T00:00:00Z", resetKnown: true } }]) {
    const seedDir = mkdtempSync(join(tmpdir(), "aide-schedule-seed-"));
    configDirs.push(seedDir);
    const mirror = join(seedDir, "seed.json");
    writeFileSync(mirror, JSON.stringify([{ ...oldAttempt, ...over }]));
    const r = start([nightly()], { queueMirrorPath: mirror });
    const res = await fetch(`${r.base}/api/queue/schedule/aide/nightly/run`, jsonPost({ sourceJobId: oldAttempt.id }));
    expect(res.status).toBe(400);
    expect((await (await fetch(`${r.base}/api/queue`)).json()).jobs).toHaveLength(1);
    harness.cleanup();
  }
});
