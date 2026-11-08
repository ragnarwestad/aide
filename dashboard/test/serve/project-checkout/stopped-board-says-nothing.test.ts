// A git answer that lands after the board was stopped puts no checkout
// fault at the top of pages: the faults live in the process, and another
// board drawing pages in the same process would carry it.

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupProjectResolution } from "../../../src/serve/setup/project-resolution.ts";
import { createServerState } from "../../../src/serve/state.ts";
import { checkoutFaults, clearCheckoutFaults } from "../../../src/render/ui/checkout-faults.ts";
import type { GitRunner } from "../../../src/git/branch-status.ts";
import type { ScheduleStore } from "../../../src/queue/schedule-store.ts";

const dirs: string[] = [];
afterEach(() => {
  clearCheckoutFaults();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A checkout directory git cannot answer for: the board's own fault. */
async function ensureBroken(stopped: boolean) {
  const base = mkdtempSync(join(tmpdir(), "aide-stopped-board-"));
  dirs.push(base);
  mkdirSync(join(base, "aide", "code"), { recursive: true });
  const refuse: GitRunner = async () => ({ code: 128, stdout: "", stderr: "fatal: not a git repository" });
  const state = createServerState();
  const resolution = setupProjectResolution(
    { dashboardCheckoutRoot: base, queueProjectRoot: base, gitRun: refuse },
    new Set(["aide"]),
    state,
    {} as ScheduleStore,
  );
  state.stopped = stopped;
  await resolution.ensureCheckout("aide", { fresh: true });
}

test("a running board reports a checkout git cannot answer for", async () => {
  await ensureBroken(false);
  expect(checkoutFaults().map((f) => f.project)).toEqual(["aide"]);
});

test("a stopped board does not", async () => {
  await ensureBroken(true);
  expect(checkoutFaults()).toEqual([]);
});
