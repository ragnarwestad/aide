// The specs an analyze stopped on shared files names, read from the spec's own
// 2-analysis.md when the row and the spec page are drawn — with the stopped job
// in the queue the board restarted from, and with no job at all.

import { afterEach, describe, expect, test } from "bun:test";
import { ran } from "../../helpers/queue-server.ts";
import { listUntil, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness } = setupQueueRoutesHarness();
afterEach(() => harness.cleanup());

const SPEC = "81-queue-and-runner";
const OTHER = "82-other";
const JOBS_SENTENCE = "Analyze stopped: other open specs change the same files — 99-the-jobs-own: z.ts.";
const ANALYSIS = [
  "# Analysis",
  "",
  "## Round 1",
  "",
  "### Overlapping specs",
  "",
  `- \`${OTHER}\` — \`src/shared.ts\``,
  "- `83-archived-since` — `src/other.ts`",
  "",
].join("\n");

const stoppedJob = {
  id: "stopped-1", project: "aide", specFolder: SPEC, steps: ["analyze"], stepIndex: 0,
  state: "stopped", stopReason: "shared-files", error: JOBS_SENTENCE,
  model: {}, timeoutSec: {}, permissionMode: {}, effort: {},
  createdAt: "2026-10-05T08:00:00.000Z", spentUsd: 0, results: [],
};

const text = (html: string): string => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const pageOf = async (base: string): Promise<string> => text(await (await fetch(`${base}/specs/aide/${SPEC}`)).text());

describe("a stop on shared files names the specs its analysis recorded", () => {
  test("the row and the spec page name the open spec with its file, and not the job's own sentence (AC-1, AC-2)", async () => {
    const { base, dir } = harness.start({
      alsoSpecs: [OTHER],
      analysis: ANALYSIS,
      queueMirror: JSON.stringify([stoppedJob]),
    });
    ran(dir, ["create", "analyze"], SPEC, { stopped: "shared-files" });
    const list = text(await listUntil(base, (h) => h.includes("src/shared.ts"), 4_000, "the open spec's file"));
    expect(list).toContain(`${OTHER}: src/shared.ts`);
    expect(list).not.toContain("99-the-jobs-own");
    expect(list).not.toContain("83-archived-since");
    const page = await pageOf(base);
    expect(page).toContain(`${OTHER}: src/shared.ts`);
    expect(page).not.toContain("99-the-jobs-own");
  }, 8_000);

  test("the spec page says the same with no job in the queue (AC-2)", async () => {
    const { base, dir } = harness.start({ alsoSpecs: [OTHER], analysis: ANALYSIS });
    ran(dir, ["create", "analyze"], SPEC, { stopped: "shared-files" });
    const deadline = Date.now() + 4_000;
    let page = await pageOf(base);
    while (!page.includes("src/shared.ts") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
      page = await pageOf(base);
    }
    expect(page).toContain(`${OTHER}: src/shared.ts`);
    expect(page).toContain("Add them to Depends on to wait until they are archived");
  }, 8_000);
});
