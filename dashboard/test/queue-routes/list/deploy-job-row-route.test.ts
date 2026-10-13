// GET / draws a deploy job as a row of its own on the Running tab. The rules
// are proven where they live (`rows.test.ts`, `job-marks.test.ts`,
// `resting.test.ts`); this proves the page is wired to them, once.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderSentence } from "../../../src/i18n/message.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";

const { harness } = setupQueueRoutesHarness();
const tmp: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (tmp.length) rmSync(tmp.pop()!, { recursive: true, force: true });
});

const KEY = "aide/deploy:deploy";

/** A run log with the marks a deploy writes, beside a transcript that is empty. */
function runLog(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-deploy-row-"));
  tmp.push(dir);
  const stream = join(dir, "d1.deploy.stream.jsonl");
  writeFileSync(stream, "");
  writeFileSync(
    stream.replace(/\.stream\.jsonl$/, ".run.log"),
    lines.map((l, i) => `aide-run-spec 10:00:0${i} +${i}s ${l}\n`).join(""),
  );
  return stream;
}

const deploy = (o: Record<string, unknown> = {}) => ({
  id: "d1",
  project: "aide",
  specFolder: "deploy",
  steps: ["deploy"],
  stepIndex: 0,
  state: "running",
  timeoutSec: {},
  permissionMode: {},
  model: {},
  results: [],
  spentUsd: 0,
  createdAt: "2026-10-13T10:00:00Z",
  startedAt: "2026-10-13T10:00:00Z",
  stepStartedAt: "2026-10-13T10:00:00Z",
  ...o,
});

const board = (jobs: Record<string, unknown>[]) =>
  harness.start({ extra: { queueProjects: ["aide"] }, queueMirror: JSON.stringify(jobs) });

const rows = async (base: string, open = ""): Promise<string> =>
  await (await fetch(`${base}/?rows=1${open ? `&open=${encodeURIComponent(open)}` : ""}`)).text();

/** The sentence as a row writes it: its first letter is a capital. */
const sentence = (s: Parameters<typeof renderSentence>[1]): string => {
  const text = renderSentence("en", s) ?? "";
  return text.charAt(0).toUpperCase() + text.slice(1);
};

describe("a deploy job on the Running tab (AC-2)", () => {
  test("it is one row of its own, keyed and named for the deploy, and no spec row is drawn for it (AC-2)", async () => {
    const { base } = board([deploy()]);
    const html = await rows(base);
    expect(html).toContain(`id="spec-${KEY}"`);
    expect(html).toContain("Deploy aide");
    expect(html).not.toContain('id="spec-aide/deploy"');
    expect(html.match(/id="spec-aide\/deploy[^"]*"/g)).toHaveLength(1);
  });

  test("a queued and a held-back deploy are there too (AC-2)", async () => {
    const queued = await rows(board([deploy({ state: "queued", startedAt: undefined })]).base);
    expect(queued).toContain(`id="spec-${KEY}"`);
    const held = await rows(
      board([deploy({ state: "queued", startedAt: undefined, errorReason: "held-back", error: { key: "runner.landingPause" } })]).base,
    );
    expect(held).toContain(`id="spec-${KEY}"`);
  });
});

describe("its row, open and shut (AC-3)", () => {
  const marked = () =>
    runLog([
      "--- Step 1 of 5: Fetch from origin — started",
      "--- Step 1 of 5: Fetch from origin — done",
      "--- Step 2 of 5: Install — started",
      "--- Step 2 of 5: Install — done",
      "--- Step 3 of 5: Restart the service — started",
    ]);

  test("open, it lists the five steps in order (AC-3)", async () => {
    const { base } = board([deploy({ streamFile: marked() })]);
    const html = await rows(base, KEY);
    expect([...html.matchAll(/<tr class="subrow" data-step="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "Step 1 of 5", "Step 2 of 5", "Step 3 of 5", "Step 4 of 5", "Step 5 of 5",
    ]);
  });

  test("shut, it lists no step lines (AC-3)", async () => {
    const { base } = board([deploy({ streamFile: marked() })]);
    expect(await rows(base)).not.toContain('class="subrow"');
  });
});

describe("what its row says (AC-4, AC-6)", () => {
  test("a hold shows its sentence on the row, shut, and the state reads Held back, also when running (AC-4)", async () => {
    const error = { key: "runner.landingPause" } as const;
    for (const state of ["queued", "running"]) {
      const { base } = board([deploy({ state, errorReason: "held-back", error })]);
      const html = await rows(base);
      expect(html).toContain(sentence(error));
      expect(html).toContain(">Held back<");
    }
  });

  test("a failed deploy keeps its row, with the failure's sentence on it (AC-6)", async () => {
    const error = { key: "landing.deployServiceOlder", values: { served: "9999999", head: "abc1234" } } as const;
    const { base } = board([deploy({ state: "failed", finishedAt: "2026-10-13T10:05:00Z", error })]);
    const html = await rows(base);
    expect(html).toContain(`id="spec-${KEY}"`);
    expect(html).toContain(sentence(error));
  });
});

describe("what its row offers (AC-8)", () => {
  test("a running deploy offers no Stop or Cancel (AC-8)", async () => {
    const { base } = board([deploy()]);
    expect(await rows(base, KEY)).not.toContain("/cancel");
  });

  test("a queued deploy offers Cancel (AC-8)", async () => {
    const { base } = board([deploy({ state: "queued", startedAt: undefined })]);
    expect(await rows(base, KEY)).toContain("/api/queue/d1/cancel");
  });
});
