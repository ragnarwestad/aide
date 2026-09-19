// `promptFileFor`: the file a `schedule` step's prompt is read from, asked of
// the schedule store (the queue config file) at spawn time.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScheduleStore } from "../../../src/queue/schedule-store.ts";
import type { Job } from "../../../src/queue/queue.ts";
import { promptFileFor, type ProjectCheckoutContext } from "../../../src/serve/project-checkout.ts";

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

test("a job in the config gives its prompt path, read fresh (AC-2)", () => {
  writeFileSync(file, JSON.stringify({ schedules: { aide: [{ name: "nightly", cron: "0 3 * * *", prompt: "docs/a.md" }] } }));
  const c = ctx();
  expect(promptFileFor(c, job("schedule-nightly"), "schedule")).toBe("docs/a.md");
  writeFileSync(file, JSON.stringify({ schedules: { aide: [{ name: "nightly", cron: "0 3 * * *", prompt: "docs/b.md" }] } }));
  expect(promptFileFor(c, job("schedule-nightly"), "schedule")).toBe("docs/b.md");
});

test("a name only a manifest lists, an unknown name and a step other than schedule give nothing (AC-2)", () => {
  writeFileSync(file, JSON.stringify({ schedules: { aide: [{ name: "nightly", cron: "0 3 * * *", prompt: "docs/a.md" }] } }));
  const c = ctx();
  expect(promptFileFor(c, job("schedule-from-manifest"), "schedule")).toBeUndefined();
  expect(promptFileFor(c, job("schedule-nightly"), "implement")).toBeUndefined();
  expect(promptFileFor(c, job("81-some-spec"), "schedule")).toBeUndefined();
});

test("a job of another project's config is not found (AC-2)", () => {
  writeFileSync(file, JSON.stringify({ schedules: { paceup: [{ name: "nightly", cron: "0 3 * * *", prompt: "docs/a.md" }] } }));
  expect(promptFileFor(ctx(), job("schedule-nightly"), "schedule")).toBeUndefined();
});
