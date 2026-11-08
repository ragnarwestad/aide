// `promptFileFor`: the file a `schedule` step's prompt is read from, asked of
// the schedule store (the queue config file) at spawn time.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScheduleStore } from "../../../src/queue/schedule-store.ts";
import type { Job } from "../../../src/queue/queue.ts";
import { chromeFor, noSandboxFor, promptFileFor, type ProjectCheckoutContext } from "../../../src/serve/project-checkout.ts";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-prompt-file-"));
  file = join(dir, "queue-config.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ctx = () =>
  ({ scheduleStore: createScheduleStore(file), queueProjectRoot: dir, checkoutBase: dir }) as unknown as ProjectCheckoutContext;
const job = (specFolder: string) => ({ project: "aide", specFolder }) as unknown as Job;

test("a job in the config gives its prompt path, read fresh", () => {
  writeFileSync(file, JSON.stringify({ schedules: { aide: [{ name: "nightly", cron: "0 3 * * *", prompt: "docs/a.md" }] } }));
  const c = ctx();
  expect(promptFileFor(c, job("schedule-nightly"), "schedule")).toBe("docs/a.md");
  writeFileSync(file, JSON.stringify({ schedules: { aide: [{ name: "nightly", cron: "0 3 * * *", prompt: "docs/b.md" }] } }));
  expect(promptFileFor(c, job("schedule-nightly"), "schedule")).toBe("docs/b.md");
});

test("a name only a manifest lists, an unknown name and a step other than schedule give nothing", () => {
  writeFileSync(file, JSON.stringify({ schedules: { aide: [{ name: "nightly", cron: "0 3 * * *", prompt: "docs/a.md" }] } }));
  const c = ctx();
  expect(promptFileFor(c, job("schedule-from-manifest"), "schedule")).toBeUndefined();
  expect(promptFileFor(c, job("schedule-nightly"), "implement")).toBeUndefined();
  expect(promptFileFor(c, job("81-some-spec"), "schedule")).toBeUndefined();
});

test("a job of another project's config is not found", () => {
  writeFileSync(file, JSON.stringify({ schedules: { paceup: [{ name: "nightly", cron: "0 3 * * *", prompt: "docs/a.md" }] } }));
  expect(promptFileFor(ctx(), job("schedule-nightly"), "schedule")).toBeUndefined();
});

test("a scheduled job gets Chrome only when its own entry asks, read fresh at spawn time", () => {
  const entries = (chrome?: boolean) =>
    JSON.stringify({ schedules: { aide: [{ name: "nightly", cron: "0 3 * * *", prompt: "docs/a.md", ...(chrome ? { chrome } : {}) }] } });
  writeFileSync(file, entries(true));
  const c = ctx();
  expect(chromeFor(c, job("schedule-nightly"), "schedule")).toBe(true);
  expect(chromeFor(c, job("schedule-nightly"), "implement")).toBe(false);
  expect(chromeFor(c, job("schedule-other"), "schedule")).toBe(false);
  writeFileSync(file, entries());
  expect(chromeFor(c, job("schedule-nightly"), "schedule")).toBe(false);
});

test("a scheduled job runs without the sandbox only when its own entry says so, read fresh at spawn time", () => {
  const entries = (sandbox?: false) =>
    JSON.stringify({ schedules: { aide: [{ name: "nightly", cron: "0 3 * * *", prompt: "docs/a.md", ...(sandbox === false ? { sandbox } : {}) }] } });
  writeFileSync(file, entries(false));
  const c = ctx();
  expect(noSandboxFor(c, job("schedule-nightly"), "schedule")).toBe(true);
  expect(noSandboxFor(c, job("schedule-nightly"), "implement")).toBe(false);
  expect(noSandboxFor(c, job("schedule-other"), "schedule")).toBe(false);
  writeFileSync(file, entries());
  expect(noSandboxFor(c, job("schedule-nightly"), "schedule")).toBe(false);
});
