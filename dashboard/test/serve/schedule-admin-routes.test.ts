// The schedule entry API routes (spec 276): create, edit, the Enabled
// toggle, Run-now, and the cron-next preview — the HTTP-level proof
// that `schedule-admin.ts`'s rules are reachable over the wire.
// Acceptance criteria 5-11, 17 — route level (`test/project/admin/
// schedule-admin.test.ts` proves the same rules at the unit level).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { queueHarness } from "../helpers/queue-server.ts";
import { parseManifest } from "../../src/project/parse-manifest.ts";
import { scheduleTrackingKey } from "../../src/queue/schedule.ts";

const harness = queueHarness("aide-schedule-admin-routes-");
afterEach(() => harness.cleanup());

function manifestPath(dir: string, project: string): string {
  return join(dir, "root", project, ".aide", "project.yaml");
}

function writeManifest(dir: string, project: string, text: string): void {
  mkdirSync(join(dir, "root", project, ".aide"), { recursive: true });
  writeFileSync(manifestPath(dir, project), text);
}

function readSchedule(dir: string, project: string) {
  const result = parseManifest(readFileSync(manifestPath(dir, project), "utf-8"));
  if (!result.ok) throw new Error(result.error);
  return result.data.schedule ?? [];
}

const TOKEN = "s3cret-token";
const asJson = { headers: { accept: "application/json", "x-aide-token": TOKEN } };

describe("POST /api/queue/schedule/<project> — create (criteria 5, 6, 7)", () => {
  test("a valid entry is created", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeFileSync(join(dir, "root", "aide", "docs-nightly.md"), "# nightly\n");
    writeManifest(dir, "aide", "name: aide\n");
    const res = await fetch(`${base}/api/queue/schedule/aide`, {
      method: "POST",
      ...asJson,
      headers: { ...asJson.headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md" }),
    });
    expect(res.status).toBe(200);
    expect(readSchedule(dir, "aide")).toEqual([
      { name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md", enabled: true },
    ]);
  });

  // Every route in this file used to write to `displayProjectDir` (the
  // PERSON's own checkout) while `/schedule`'s own GET route reads off
  // `machineryProjectDir` (the dashboard's own checkout) — two
  // different directories that agree only when the harness has no
  // `owned/<project>/code/.git` for `machineryProjectDir` to prefer, so
  // this bug shipped invisibly through every other test in this file.
  // Setting that `.git` up here is what makes the two diverge, the way
  // production genuinely does.
  test("writes to the dashboard's own checkout, not the reader's, when the two differ", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    const owned = join(dir, "owned", "aide", "code");
    mkdirSync(join(owned, ".git"), { recursive: true });
    writeFileSync(join(owned, "docs-nightly.md"), "# nightly\n");
    mkdirSync(join(owned, ".aide"), { recursive: true });
    writeFileSync(join(owned, ".aide", "project.yaml"), "name: aide\n");
    // The reader's own checkout carries no such file at all — proving
    // the write did not fall back to it.
    writeManifest(dir, "aide", "name: aide\n");
    const res = await fetch(`${base}/api/queue/schedule/aide`, {
      method: "POST",
      ...asJson,
      headers: { ...asJson.headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md" }),
    });
    expect(res.status).toBe(200);
    const ownedManifest = parseManifest(readFileSync(join(owned, ".aide", "project.yaml"), "utf-8"));
    if (!ownedManifest.ok) throw new Error(ownedManifest.error);
    expect(ownedManifest.data.schedule).toEqual([
      { name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md", enabled: true },
    ]);
    expect(readSchedule(dir, "aide")).toEqual([]);
  });

  test("a duplicate name is refused before any write (criterion 5)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeFileSync(join(dir, "root", "aide", "docs-nightly.md"), "# nightly\n");
    writeManifest(dir, "aide", "name: aide\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n");
    const before = readFileSync(manifestPath(dir, "aide"), "utf-8");
    const res = await fetch(`${base}/api/queue/schedule/aide`, {
      method: "POST",
      ...asJson,
      headers: { ...asJson.headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "nightly", cron: "0 4 * * *", prompt: "docs-nightly.md" }),
    });
    expect(res.status).toBe(400);
    expect(readFileSync(manifestPath(dir, "aide"), "utf-8")).toBe(before);
  });

  test("a missing prompt path is refused, naming the path (criterion 6)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeManifest(dir, "aide", "name: aide\n");
    const res = await fetch(`${base}/api/queue/schedule/aide`, {
      method: "POST",
      ...asJson,
      headers: { ...asJson.headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "nightly", cron: "0 3 * * *", prompt: "missing.md" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("missing.md");
  });

  test("an invalid cron is refused before any write (criterion 7)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeFileSync(join(dir, "root", "aide", "docs-nightly.md"), "# nightly\n");
    writeManifest(dir, "aide", "name: aide\n");
    const res = await fetch(`${base}/api/queue/schedule/aide`, {
      method: "POST",
      ...asJson,
      headers: { ...asJson.headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "nightly", cron: "not-a-cron", prompt: "docs-nightly.md" }),
    });
    expect(res.status).toBe(400);
    expect(readSchedule(dir, "aide")).toEqual([]);
  });

  test("an unknown project is refused", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/api/queue/schedule/ghost-project`, {
      method: "POST",
      ...asJson,
      headers: { ...asJson.headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/queue/schedule/<project>/<name> — edit (criterion 17)", () => {
  test("editing the cron leaves the name and other entries alone", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeFileSync(join(dir, "root", "aide", "docs-nightly.md"), "# nightly\n");
    writeManifest(
      dir, "aide",
      "name: aide\nschedule:\n" +
        "  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n" +
        "  - name: weekly\n    cron: \"0 4 * * 0\"\n    prompt: docs-nightly.md\n",
    );
    const res = await fetch(`${base}/api/queue/schedule/aide/nightly`, {
      method: "POST",
      ...asJson,
      headers: { ...asJson.headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "nightly", cron: "0 5 * * *", prompt: "docs-nightly.md" }),
    });
    expect(res.status).toBe(200);
    expect(readSchedule(dir, "aide")).toEqual([
      { name: "nightly", cron: "0 5 * * *", prompt: "docs-nightly.md", enabled: true },
      { name: "weekly", cron: "0 4 * * 0", prompt: "docs-nightly.md", enabled: true },
    ]);
  });

  test("renaming an entry is accepted (criterion 17)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeFileSync(join(dir, "root", "aide", "docs-nightly.md"), "# nightly\n");
    writeManifest(dir, "aide", "name: aide\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n");
    const res = await fetch(`${base}/api/queue/schedule/aide/nightly`, {
      method: "POST",
      ...asJson,
      headers: { ...asJson.headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "nightly-2", cron: "0 3 * * *", prompt: "docs-nightly.md" }),
    });
    expect(res.status).toBe(200);
    expect(readSchedule(dir, "aide")).toEqual([
      { name: "nightly-2", cron: "0 3 * * *", prompt: "docs-nightly.md", enabled: true },
    ]);
  });
});

describe("POST /api/queue/schedule/<project>/<name>/enabled (criterion 8)", () => {
  test("a plain body with only `enabled` is never refused for missing confirmation", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeManifest(dir, "aide", "name: aide\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n");
    const res = await fetch(`${base}/api/queue/schedule/aide/nightly/enabled`, {
      method: "POST",
      ...asJson,
      headers: { ...asJson.headers, "content-type": "application/json" },
      body: JSON.stringify({ enabled: "0" }),
    });
    expect(res.status).toBe(200);
    expect(readSchedule(dir, "aide")[0]!.enabled).toBe(false);
  });

  test("flips back to true", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeManifest(
      dir, "aide",
      "name: aide\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n    enabled: false\n",
    );
    const res = await fetch(`${base}/api/queue/schedule/aide/nightly/enabled`, {
      method: "POST",
      ...asJson,
      headers: { ...asJson.headers, "content-type": "application/json" },
      body: JSON.stringify({ enabled: "1" }),
    });
    expect(res.status).toBe(200);
    expect(readSchedule(dir, "aide")[0]!.enabled).toBe(true);
  });
});

describe("POST /api/queue/schedule/<project>/<name>/run (criterion 9)", () => {
  test("enqueues the schedule job under the entry's tracking key", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeManifest(dir, "aide", "name: aide\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n");
    const res = await fetch(`${base}/api/queue/schedule/aide/nightly/run`, { method: "POST", ...asJson });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job.project).toBe("aide");
    expect(body.job.specFolder).toBe("schedule-nightly");
    expect(body.job.steps).toEqual(["schedule"]);
  });
});

describe("POST /api/queue/schedule/<project>/<name>/delete (spec 277)", () => {
  test("a matching confirm deletes the entry and answers {ok: true} (criterion 1)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeManifest(
      dir, "aide",
      "name: aide\nschedule:\n" +
        "  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n" +
        "  - name: weekly\n    cron: \"0 4 * * 0\"\n    prompt: docs-nightly.md\n",
    );
    const res = await fetch(`${base}/api/queue/schedule/aide/nightly/delete`, {
      method: "POST",
      ...asJson,
      headers: { ...asJson.headers, "content-type": "application/json" },
      body: JSON.stringify({ confirm: "nightly" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(readSchedule(dir, "aide")).toEqual([
      { name: "weekly", cron: "0 4 * * 0", prompt: "docs-nightly.md", enabled: true },
    ]);
  });

  test("deleting the last entry removes the schedule key entirely (criterion 3)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeManifest(dir, "aide", "name: aide\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n");
    const res = await fetch(`${base}/api/queue/schedule/aide/nightly/delete`, {
      method: "POST",
      ...asJson,
      headers: { ...asJson.headers, "content-type": "application/json" },
      body: JSON.stringify({ confirm: "nightly" }),
    });
    expect(res.status).toBe(200);
    expect(readFileSync(manifestPath(dir, "aide"), "utf-8")).not.toContain("schedule:");
  });

  test("a no-script POST redirects to /schedule?project=<project> on success, never /projects or / (criterion 10)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeManifest(dir, "aide", "name: aide\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n");
    const res = await fetch(`${base}/api/queue/schedule/aide/nightly/delete?token=${TOKEN}`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ confirm: "nightly" }).toString(),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/schedule?project=aide");
    expect(readSchedule(dir, "aide")).toEqual([]);
  });

  test("a missing confirm refuses with 400 and leaves the manifest byte-for-byte unchanged (criterion 2)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeManifest(dir, "aide", "name: aide\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n");
    const before = readFileSync(manifestPath(dir, "aide"), "utf-8");
    const res = await fetch(`${base}/api/queue/schedule/aide/nightly/delete`, {
      method: "POST",
      ...asJson,
      headers: { ...asJson.headers, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(readFileSync(manifestPath(dir, "aide"), "utf-8")).toBe(before);
  });

  test("a mismatched confirm refuses with 400 and leaves the manifest byte-for-byte unchanged (criterion 2)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeManifest(dir, "aide", "name: aide\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n");
    const before = readFileSync(manifestPath(dir, "aide"), "utf-8");
    const res = await fetch(`${base}/api/queue/schedule/aide/nightly/delete`, {
      method: "POST",
      ...asJson,
      headers: { ...asJson.headers, "content-type": "application/json" },
      body: JSON.stringify({ confirm: "wrong-name" }),
    });
    expect(res.status).toBe(400);
    expect(readFileSync(manifestPath(dir, "aide"), "utf-8")).toBe(before);
  });

  test("an unknown entry name in an allowed project refuses with 400 (criterion 5)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeManifest(dir, "aide", "name: aide\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n");
    const res = await fetch(`${base}/api/queue/schedule/aide/ghost/delete`, {
      method: "POST",
      ...asJson,
      headers: { ...asJson.headers, "content-type": "application/json" },
      body: JSON.stringify({ confirm: "ghost" }),
    });
    expect(res.status).toBe(400);
    expect(readSchedule(dir, "aide")).toHaveLength(1);
  });

  test("an unallowed project refuses with 400 (criterion 6)", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/api/queue/schedule/ghost-project/nightly/delete`, {
      method: "POST",
      ...asJson,
      headers: { ...asJson.headers, "content-type": "application/json" },
      body: JSON.stringify({ confirm: "nightly" }),
    });
    expect(res.status).toBe(400);
  });

  // The same regression shape as create's own test above: this route
  // must write through `machineryProjectDir` (the dashboard's own
  // checkout), never `displayProjectDir` (the reader's).
  test("writes to the dashboard's own checkout, not the reader's, when the two differ (criterion 4)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    const owned = join(dir, "owned", "aide", "code");
    mkdirSync(join(owned, ".git"), { recursive: true });
    mkdirSync(join(owned, ".aide"), { recursive: true });
    writeFileSync(
      join(owned, ".aide", "project.yaml"),
      "name: aide\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n",
    );
    writeManifest(dir, "aide", "name: aide\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n");
    const res = await fetch(`${base}/api/queue/schedule/aide/nightly/delete`, {
      method: "POST",
      ...asJson,
      headers: { ...asJson.headers, "content-type": "application/json" },
      body: JSON.stringify({ confirm: "nightly" }),
    });
    expect(res.status).toBe(200);
    const ownedManifest = parseManifest(readFileSync(join(owned, ".aide", "project.yaml"), "utf-8"));
    if (!ownedManifest.ok) throw new Error(ownedManifest.error);
    expect(ownedManifest.data.schedule ?? []).toEqual([]);
    // The reader's own checkout is untouched — proving the write went
    // to the OWNED checkout and not here.
    expect(readSchedule(dir, "aide")).toEqual([
      { name: "nightly", cron: "0 3 * * *", prompt: "docs-nightly.md", enabled: true },
    ]);
  });

  test("a job enqueued under the entry's tracking key survives the entry's deletion (criterion 11)", async () => {
    const { base, dir } = harness.start({ extra: { queueToken: TOKEN } });
    writeManifest(dir, "aide", "name: aide\nschedule:\n  - name: nightly\n    cron: \"0 3 * * *\"\n    prompt: docs-nightly.md\n");
    const runRes = await fetch(`${base}/api/queue/schedule/aide/nightly/run`, { method: "POST", ...asJson });
    expect(runRes.status).toBe(200);
    const key = scheduleTrackingKey("nightly");
    const deleteRes = await fetch(`${base}/api/queue/schedule/aide/nightly/delete`, {
      method: "POST",
      ...asJson,
      headers: { ...asJson.headers, "content-type": "application/json" },
      body: JSON.stringify({ confirm: "nightly" }),
    });
    expect(deleteRes.status).toBe(200);
    const listRes = await fetch(`${base}/api/queue`, asJson);
    const { jobs } = await listRes.json();
    expect(jobs.some((j: { project: string; specFolder: string }) => j.project === "aide" && j.specFolder === key)).toBe(true);
  });
});

describe("GET /api/queue/schedule/cron-next (criteria 10, 11)", () => {
  test("a valid cron returns the same timestamp nextFireTime would compute", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/api/queue/schedule/cron-next?${new URLSearchParams({ cron: "0 3 * * *" })}`, asJson);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.next).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("an invalid cron returns an error and no timestamp", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    const res = await fetch(`${base}/api/queue/schedule/cron-next?${new URLSearchParams({ cron: "not-a-cron" })}`, asJson);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.next).toBeUndefined();
    expect(body.error).toBeTruthy();
  });
});
