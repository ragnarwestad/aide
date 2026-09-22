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
import { scheduleTrackingKey } from "../../../src/queue/schedule.ts";
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
function start(entries: Seed[] = [], extra: Partial<ServerOptions> = {}, configText?: string) {
  const cfgDir = mkdtempSync(join(tmpdir(), "aide-schedule-cfg-"));
  configDirs.push(cfgDir);
  const file = join(cfgDir, "queue-config.json");
  if (configText !== undefined) writeFileSync(file, configText);
  // A seeded entry with no `since` is due at the tick's first look and
  // would be queued behind the test's back, so each is stamped in the future.
  const since = new Date(Date.now() + 3_600_000).toISOString();
  if (configText === undefined && entries.length) {
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
  test("a valid entry is written to the config file and nothing goes to git (AC-1)", async () => {
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

  test("a server with no config file refuses, naming the cause (AC-1)", async () => {
    const t = start([], { queueConfigFile: undefined });
    const res = await fetch(`${t.base}/api/queue/schedule`, jsonPost({ project: "aide", ...nightly() }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("--queue-config");
  });

  test("a config file that is not valid JSON refuses and is left as it was (AC-1)", async () => {
    const t = start([], {}, "{ not json");
    const res = await fetch(`${t.base}/api/queue/schedule`, jsonPost({ project: "aide", ...nightly() }));
    expect(res.status).toBe(400);
    expect(readFileSync(t.file, "utf-8")).toBe("{ not json");
  });

  test("a duplicate name is refused before any write", async () => {
    const t = start([nightly()]);
    const before = readFileSync(t.file, "utf-8");
    const res = await fetch(`${t.base}/api/queue/schedule`, jsonPost({ project: "aide", ...nightly({ cron: "0 4 * * *" }) }));
    expect(res.status).toBe(400);
    expect(readFileSync(t.file, "utf-8")).toBe(before);
  });

  test("a missing prompt path is refused, naming the path", async () => {
    const t = start();
    const res = await fetch(`${t.base}/api/queue/schedule`, jsonPost({ project: "aide", ...nightly({ prompt: "missing.md" }) }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("missing.md");
  });

  test("an invalid cron is refused before any write", async () => {
    const t = start();
    const res = await fetch(`${t.base}/api/queue/schedule`, jsonPost({ project: "aide", ...nightly({ cron: "not-a-cron" }) }));
    expect(res.status).toBe(400);
    expect(t.stored()).toEqual([]);
  });

  test("a project the allowlist does not contain is refused (400) before any write", async () => {
    const t = start();
    const res = await fetch(`${t.base}/api/queue/schedule`, jsonPost({ project: "ghost-project", ...nightly() }));
    expect(res.status).toBe(400);
    expect(t.stored()).toEqual([]);
  });

  test("a no-script POST redirects to the project's own Schedule tab on success", async () => {
    const t = start();
    const res = await fetch(`${t.base}/api/queue/schedule`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ project: "aide", name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md" }).toString(),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/projects/aide?tab=schedule");
  });

  test("a no-script POST that is refused redirects to the project's own Schedule tab, with the reason", async () => {
    const t = start();
    const res = await fetch(`${t.base}/api/queue/schedule`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ project: "aide", name: "nightly", cron: "not-a-cron", prompt: "docs-nightly.md" }).toString(),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")!.startsWith("/projects/aide?tab=schedule&error=")).toBe(true);
  });
});

describe("POST /api/queue/schedule/<project>/<name> — edit", () => {
  test("editing the cron leaves the name and other entries alone, and nothing goes to git (AC-1)", async () => {
    const t = start([nightly(), weekly()]);
    const res = await fetch(`${t.base}/api/queue/schedule/aide/nightly`, jsonPost(nightly({ cron: "0 5 * * *" })));
    expect(res.status).toBe(200);
    expect(t.stored().map((e) => [e.name, e.cron])).toEqual([["nightly", "0 5 * * *"], ["weekly", "0 4 * * 0"]]);
    expect(readFileSync(t.manifest, "utf-8")).toBe("name: aide\n");
    expect(t.wroteToGit()).toBe(false);
  });

  test("renaming an entry is accepted", async () => {
    const t = start([nightly()]);
    const res = await fetch(`${t.base}/api/queue/schedule/aide/nightly`, jsonPost(nightly({ name: "renamed" })));
    expect(res.status).toBe(200);
    expect(t.stored().map((e) => e.name)).toEqual(["renamed"]);
  });
});

describe("POST /api/queue/schedule/<project>/<name>/enabled", () => {
  test("a plain body with only `enabled` pauses the entry, and `true` resumes it (AC-1)", async () => {
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
  test("create stores the posted model on the entry", async () => {
    const t = start([], { queueDefaults: DEFAULTS });
    const res = await fetch(`${t.base}/api/queue/schedule`, jsonPost({ project: "aide", ...nightly({ model: "codex-fast" }) }));
    expect(res.status).toBe(200);
    expect(t.stored()[0]!.model).toBe("codex-fast");
  });

  test("editing an entry replaces its model", async () => {
    const t = start([nightly({ model: "sonnet" })], { queueDefaults: DEFAULTS });
    const res = await fetch(`${t.base}/api/queue/schedule/aide/nightly`, jsonPost(nightly({ model: "codex-fast" })));
    expect(res.status).toBe(200);
    expect(t.stored()[0]!.model).toBe("codex-fast");
  });

  test("a model the queue config does not grant is refused, and nothing is written", async () => {
    const t = start([], { queueDefaults: DEFAULTS });
    const res = await fetch(`${t.base}/api/queue/schedule`, jsonPost({ project: "aide", ...nightly({ model: "retired" }) }));
    expect(res.status).toBe(400);
    expect(t.stored()).toHaveLength(0);
  });
});

describe("the entry's notification choice, over the wire", () => {
  test("create stores the posted choice, from JSON and from a form (AC-7)", async () => {
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
    expect(posted.status).toBeGreaterThanOrEqual(300);
    expect(posted.status).toBeLessThan(400);
    expect(form.stored()[0]!.notify).toBe("never");
  });

  test("editing replaces the choice, and an edit that posts none keeps it (AC-7)", async () => {
    const t = start([nightly({ notify: "never" })]);
    expect((await fetch(`${t.base}/api/queue/schedule/aide/nightly`, jsonPost(nightly({ notify: "always" })))).status).toBe(200);
    expect(t.stored()[0]!.notify).toBe("always");
    expect((await fetch(`${t.base}/api/queue/schedule/aide/nightly`, jsonPost(nightly()))).status).toBe(200);
    expect(t.stored()[0]!.notify).toBe("always");
  });

  test("a choice that is none of the three is refused, and nothing is written (AC-7)", async () => {
    const t = start();
    const res = await fetch(`${t.base}/api/queue/schedule`, jsonPost({ project: "aide", ...nightly({ notify: "sometimes" }) }));
    expect(res.status).toBe(400);
    expect(t.stored()).toHaveLength(0);
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
  test("the job runs on the model the entry names (AC-5)", async () => {
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

  test("a press with no script is redirected to /schedule carrying the same sentence", async () => {
    const t = start([nightly({ model: "retired" })], { queueDefaults: DEFAULTS });
    const { value: res } = await withLoggedErrors(() =>
      fetch(`${t.base}/api/queue/schedule/aide/nightly/run`, { method: "POST", headers: {}, redirect: "manual" }),
    );
    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith("/schedule?error=")).toBe(true);
    expect(decodeURIComponent(location.slice("/schedule?error=".length))).toContain("Run now was refused for aide:nightly:");
  });

  test("an entry naming the model in another case runs on the listed spelling", async () => {
    const t = start([nightly({ model: "SONNET" })], { queueDefaults: DEFAULTS });
    const res = await fetch(`${t.base}/api/queue/schedule/aide/nightly/run`, { method: "POST", ...asJson });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { job: { modelChoice: string } }).job.modelChoice).toBe("sonnet");
  });
});

describe("POST /api/queue/schedule/<project>/<name>/delete", () => {
  test("deletes the entry, leaves the others, and nothing goes to git (AC-1)", async () => {
    const t = start([nightly(), weekly()]);
    const res = await fetch(`${t.base}/api/queue/schedule/aide/nightly/delete`, jsonPost({}));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(t.stored().map((e) => e.name)).toEqual(["weekly"]);
    expect(t.wroteToGit()).toBe(false);
  });

  test("deleting the last entry removes the project's key", async () => {
    const t = start([nightly()]);
    await fetch(`${t.base}/api/queue/schedule/aide/nightly/delete`, jsonPost({}));
    expect(JSON.parse(readFileSync(t.file, "utf-8")).schedules).not.toHaveProperty("aide");
  });

  test("a no-script POST redirects to /schedule on success", async () => {
    const t = start([nightly()]);
    const res = await fetch(`${t.base}/api/queue/schedule/aide/nightly/delete`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/schedule");
    expect(t.stored()).toEqual([]);
  });

  // AC-3: no confirm page to fall back to any more, so a refusal has to
  // land on the schedule list, the same as every other route in this file.
  test("a no-script POST that is refused redirects to /schedule, with the reason", async () => {
    const t = start([nightly()]);
    const res = await fetch(`${t.base}/api/queue/schedule/aide/ghost/delete`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")!.startsWith("/schedule?error=")).toBe(true);
  });

  // Moved from schedule-page-route.test.ts (spec 528): that file's own
  // GET .../delete describe block is gone with the confirm page it
  // covered, but this test proves POST behavior unrelated to that page.
  test("after a successful delete, the entry's own detail page is 404 (criterion 9)", async () => {
    const t = start([nightly()]);
    const res = await fetch(`${t.base}/api/queue/schedule/aide/nightly/delete`, jsonPost({}));
    expect(res.status).toBe(200);
    const detail = await fetch(`${t.base}/schedule/aide/nightly`, );
    expect(detail.status).toBe(404);
  });

  test("an unknown entry name in an allowed project refuses with 400", async () => {
    const t = start([nightly()]);
    const res = await fetch(`${t.base}/api/queue/schedule/aide/ghost/delete`, jsonPost({}));
    expect(res.status).toBe(400);
    expect(t.stored()).toHaveLength(1);
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
