import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

const { renderQueueRows } = await import(
  "/Users/ragnarwestad/aide-worktrees/code/419-en-avkryssing-du-endrer-blir-staaende/code/dashboard/src/render.ts"
);
const { swapRows } = await import(
  "/Users/ragnarwestad/aide-worktrees/code/419-en-avkryssing-du-endrer-blir-staaende/code/dashboard/src/queue-client/row-swap.ts"
);
const { chosenSteps, checkboxKey } = await import(
  "/Users/ragnarwestad/aide-worktrees/code/419-en-avkryssing-du-endrer-blir-staaende/code/dashboard/src/queue-client/state.ts"
);

const row = (extra: any = {}) => ({
  id: "job-1234",
  project: "aide",
  specFolder: "81-queue-and-runner",
  steps: ["analyze"],
  stepIndex: 0,
  state: "done",
  spentUsd: 0,
  timeoutSec: 1200,
  createdAt: "2026-08-16T00:00:00Z",
  ...extra,
});

describe("repro 419 REQ-2: does a hand override expire once the press it was for is done?", () => {
  test("archive is offered again on a LATER run, after the reader had unticked it for an earlier one", async () => {
    const opts = {
      runnerAvailable: true,
      targets: [],
      filter: { open: "aide/81-queue-and-runner" },
    };

    // Round 1: spec has only "create" behind it. The reader unticks
    // "archive" before pressing Run (wants analyze+implement only).
    const list1 = [row({ id: "job-1", steps: ["create"], stepIndex: 0, state: "done" })];
    const html1 = renderQueueRows(list1, opts as any, Date.parse("2026-09-08T12:00:00Z"));
    document.body.innerHTML = `<div id="jobrows">${html1}</div>`;
    const jobrows = document.getElementById("jobrows")!;
    const boxes1 = Array.from(jobrows.querySelectorAll('input[name="steps"]')) as HTMLInputElement[];
    const archiveBox = boxes1.find((b) => b.value === "archive")!;
    expect(archiveBox.checked).toBe(true); // server's own default suggestion
    archiveBox.checked = false;
    chosenSteps.set(checkboxKey(archiveBox), false);

    // The press happens (Run), and some time later analyze+implement
    // have both finished and committed - a brand NEW job, unrelated to
    // the first, is what the row is now showing history for.
    const list2 = [row({ id: "job-2", steps: ["create", "analyze", "implement"], stepIndex: 2, state: "done" })];
    const html2 = renderQueueRows(list2, opts as any, Date.parse("2026-09-08T12:05:00Z"));

    (globalThis as any).fetch = async () => ({ ok: true, text: async () => html2 });
    (globalThis as any).location = { search: "" } as any;
    await swapRows();

    const boxes2 = Array.from(jobrows.querySelectorAll('input[name="steps"]')) as HTMLInputElement[];
    const archiveBox2 = boxes2.find((b) => b.value === "archive")!;
    console.log("archive box after later, unrelated run:", archiveBox2.checked);
    // REQ-2: the earlier hand-made "off" must not outlive the press it
    // was made for - a later run should see the server's own fresh
    // suggestion again.
    expect(archiveBox2.checked).toBe(true);
  });
});
