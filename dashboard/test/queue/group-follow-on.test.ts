import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore, type Job } from "../../src/queue/queue.ts";
import { stepDoneHandler } from "../../src/serve/runner-setup.ts";

let root: string;
let store: QueueStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aide-group-follow-on-"));
  store = new QueueStore({
    mirrorPath: join(root, "queue.json"),
    defaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" } },
    resolve: () => ({ specFolders: ["1-first", "2-next"] }),
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const member = (folder: string, position: number, archived = false) => {
  const dir = join(root, "specs", ...(archived ? ["archive"] : []), folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "1-description.md"), `# X\n\n## Tracking info\n\n- **Created:** now\n- **Group:** \`Release\`\n- **Group position:** ${position}\n`);
  writeFileSync(join(dir, "4-status.md"), "# Status\n");
};

test("a successful archive landing queues exactly the next group member (A757 AC-2, A757 AC-8, A757 AC-9)", async () => {
  member("1-first", 1, true);
  member("2-next", 2);
  const handle = stepDoneHandler({
    store,
    machinerySpecsRoot: () => join(root, "specs"),
    specDir: () => undefined,
    peekMachinerySpecDir: (_p: string, d: string) => d,
    forgetSpecCaches: () => {},
    rereadSpecCaches: () => {},
    landArchivedSpec: async () => {},
  } as unknown as Parameters<typeof stepDoneHandler>[0]);
  await handle({ project: "aide", specFolder: "1-first" } as Job, "archive", {
    ok: true,
    terminalReason: "completed",
    branchUrls: [{ root: "/specs", url: "https://example.test/specs" }],
  });
  await Promise.resolve();
  expect(store.list().map((job) => [job.specFolder, job.steps])).toEqual([["2-next", ["analyze", "implement", "archive"]]]);
});
