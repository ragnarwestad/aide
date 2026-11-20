// A scheduled job is saved only with a model its AI can run: the pair a
// scheduled fire would refuse is refused at the save, and the file is left
// as it was.

import { afterEach, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import type { QueueDefaults } from "../../../src/queue/types.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";
import { defaultsOf, ownFiles, post } from "../settings-models/fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-schedule-pair-");
const ownDirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const CONFIG = `{
  "schedules": { "aide": [{ "name": "Untangle", "cron": "0 6 * * *", "prompt": "p.md", "model": "gpt-6", "provider": "Codex" }] }
}
`;

function serve(config = CONFIG) {
  const { file, modelIdsPath } = ownFiles(config, ownDirs);
  const queueDefaults = {
    ...defaultsOf({ Opus: {}, "gpt-6": { tool: "codex" } }, { default: "Opus" }),
    providers: { Claude: { name: "Claude", tool: "claude" }, Codex: { name: "Codex", tool: "codex" } },
  } as QueueDefaults;
  const { base } = start({ queueDefaults, queueConfigFile: file, modelIdsPath });
  return { base, file };
}

const errorOf = async (res: Response): Promise<string> => ((await res.json()) as { error: string }).error;

test("an edit that puts a Codex model under Claude is refused and nothing is written", async () => {
  const { base, file } = serve();
  const res = await post(base, "/api/queue/schedule/aide/Untangle", { name: "Untangle", cron: "0 6 * * *", prompt: "p.md", model: "gpt-6", provider: "Claude" });
  expect(res.status).toBe(400);
  expect(await errorOf(res)).toContain("gpt-6 is a Codex model");
  expect(readFileSync(file, "utf-8")).toBe(CONFIG);
});

test("an edit that posts no AI is checked against the AI the entry already has", async () => {
  const { base } = serve();
  const res = await post(base, "/api/queue/schedule/aide/Untangle", { name: "Untangle", cron: "0 6 * * *", prompt: "p.md", model: "Opus" });
  expect(await errorOf(res)).toContain("Opus is a Claude Code model");
});

test("a new scheduled job with a mismatched pair is refused", async () => {
  const { base, file } = serve();
  const res = await post(base, "/api/queue/schedule", { project: "aide", name: "Nightly", cron: "0 3 * * *", prompt: "p.md", model: "Opus", provider: "Codex" });
  expect(res.status).toBe(400);
  expect(await errorOf(res)).toContain("Opus is a Claude Code model");
  expect(readFileSync(file, "utf-8")).toBe(CONFIG);
});

test("a scheduled job the board cannot start is named at the top of every page until it is fixed", async () => {
  const { base } = serve(CONFIG.replace('"provider": "Codex"', '"provider": "Claude"'));
  const page = await (await fetch(`${base}/specs`)).text();
  expect(page).toContain("aide:Untangle does not start: gpt-6 is a Codex model");
  expect(page).toContain('href="/schedule/aide/Untangle?tab=settings"');
  const fixed = serve();
  expect(await (await fetch(`${fixed.base}/specs`)).text()).not.toContain("does not start");
});
