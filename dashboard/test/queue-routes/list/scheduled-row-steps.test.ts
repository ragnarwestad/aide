// GET / draws a running scheduled job's row on the Running tab. The rules are
// proven where they live (`job-marks.test.ts`); this proves the open row is
// wired to them: a line per marked step, and an unfolded step's own log.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupQueueRoutesHarness } from "../fixtures.ts";

const { harness } = setupQueueRoutesHarness();
const tmp: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (tmp.length) rmSync(tmp.pop()!, { recursive: true, force: true });
});

const KEY = "aide/schedule-nightly";
const said = (text: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } });

/** A scheduled step's transcript with two marked steps, and its run log beside it. */
function transcript(): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-scheduled-row-"));
  tmp.push(dir);
  const stream = join(dir, "s1.schedule.stream.jsonl");
  const lines = [
    "--- Step 1 of 2: Read the list — started",
    "read the list line",
    "--- Step 1 of 2: Read the list — done",
    "--- Step 2 of 2: Write the report — started",
    "wrote the report line",
  ];
  writeFileSync(stream, lines.map((l) => `${said(l)}\n`).join(""));
  writeFileSync(
    stream.replace(/\.stream\.jsonl$/, ".run.log"),
    ["--- Step Aide: preparing — started", "--- Step Aide: preparing — done", "model turn started (transcript at byte 0)"]
      .map((l, i) => `aide-run-spec 10:00:0${i} +${i}s ${l}\n`)
      .join(""),
  );
  return stream;
}

const scheduledJob = () => ({
  id: "s1",
  project: "aide",
  specFolder: "schedule-nightly",
  steps: ["schedule"],
  stepIndex: 0,
  state: "running",
  timeoutSec: {},
  permissionMode: {},
  model: {},
  results: [],
  spentUsd: 0,
  createdAt: "2026-10-18T10:00:00Z",
  startedAt: "2026-10-18T10:00:00Z",
  stepStartedAt: "2026-10-18T10:00:00Z",
  streamFile: transcript(),
});

const rows = async (query = ""): Promise<string> => {
  const { base } = harness.start({ extra: { queueProjects: ["aide"] }, queueMirror: JSON.stringify([scheduledJob()]) });
  return await (await fetch(`${base}/?rows=1${query ? `&${query}` : ""}`)).text();
};

const stepKeys = (html: string): string[] => [...html.matchAll(/<tr class="subrow" data-step="([^"]+)"/g)].map((m) => m[1]!);

describe("a running scheduled job's row on the Running tab", () => {
  test("open, it has a line for each step its log has marked (AC-1)", async () => {
    const html = await rows(`open=${KEY}`);
    expect(stepKeys(html)).toEqual(["Step Aide: preparing", "Step 1 of 2", "Step 2 of 2"]);
  });

  test("shut, it has no step line (AC-1)", async () => {
    expect(stepKeys(await rows())).toEqual([]);
  });

  test("an unfolded step shows its own part of the log, a folded one does not (AC-2)", async () => {
    const unfolded = await rows(`open=${KEY}&phases=${KEY}.2`);
    expect(unfolded).toContain("wrote the report line");
    expect(unfolded).not.toContain("read the list line");
    expect(await rows(`open=${KEY}`)).not.toContain("wrote the report line");
  });
});
