// Adding, renaming and removing a Claude account on Settings → AI → Claude
// Code → Accounts. The file is written first and the live accounts changed
// after; a refusal changes neither.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { setupQueueRoutesHarness } from "../fixtures.ts";
import { defaultsOf, ownFiles, post } from "../settings-models/fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-claude-accounts-");
const ownDirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const ADD = "/api/queue/settings/accounts/add";
const RENAME = "/api/queue/settings/accounts/rename";
const REMOVE = "/api/queue/settings/accounts/remove";

const CONFIG = `{
  // the operator's own note
  "model": { "default": "Sonnet" }
}
`;

/** A directory that exists on this host, for an account to point at. */
function accountDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-claude-2-"));
  ownDirs.push(dir);
  return dir;
}

function serve(config = CONFIG) {
  const { file, modelIdsPath } = ownFiles(config, ownDirs);
  const { base } = start({ queueDefaults: defaultsOf(undefined, { default: "Sonnet" }), queueConfigFile: file, modelIdsPath });
  return { base, file };
}

const accountsIn = (file: string): Record<string, { configDir: string }> | undefined =>
  (parse(readFileSync(file, "utf-8")) as { claudeAccounts?: Record<string, { configDir: string }> }).claudeAccounts;
const errorOf = async (res: Response): Promise<string> => ((await res.json()) as { error: string }).error;

describe("adding, renaming and removing an account", () => {
  test("each writes the file and keeps the rest of it (AC-1)", async () => {
    const { base, file } = serve();
    const dir = accountDir();
    expect((await post(base, ADD, { name: "Work", configDir: dir })).status).toBe(200);
    expect(accountsIn(file)).toEqual({ Work: { configDir: dir } });
    expect(readFileSync(file, "utf-8")).toContain("// the operator's own note");

    expect((await post(base, RENAME, { name: "Work", newName: "Spare" })).status).toBe(200);
    expect(accountsIn(file)).toEqual({ Spare: { configDir: dir } });

    expect((await post(base, REMOVE, { name: "Spare" })).status).toBe(200);
    expect(accountsIn(file) ?? {}).toEqual({});
  });

  test("the live accounts follow: the Accounts tab lists what was added (AC-1)", async () => {
    const { base } = serve();
    const dir = accountDir();
    await post(base, ADD, { name: "Work", configDir: dir });
    const html = await (await fetch(`${base}/settings?tab=claude&aitab=accounts`)).text();
    expect(html).toContain("Work");
    expect(html).toContain("Default");
    expect(html).toContain(dir);
  });
});

describe("what each route refuses, leaving the file as it was", () => {
  const cases: [string, string, (dir: string) => Record<string, string>][] = [
    ["Add a bad name", ADD, (dir) => ({ name: "bad name", configDir: dir })],
    ["Add Default, in any case", ADD, (dir) => ({ name: "default", configDir: dir })],
    ["Add a directory not written from / or ~/", ADD, () => ({ name: "Work", configDir: "relative/dir" })],
    ["Add ~/.claude itself", ADD, () => ({ name: "Work", configDir: "~/.claude" })],
    ["Add a directory that is not there", ADD, () => ({ name: "Work", configDir: "/no/such/dir/anywhere" })],
    ["Rename Default", RENAME, () => ({ name: "Default", newName: "Main" })],
    ["Rename to Default", RENAME, () => ({ name: "Work", newName: "Default" })],
    ["Rename an unknown name", RENAME, () => ({ name: "Nobody", newName: "Main" })],
    ["Rename to a bad name", RENAME, () => ({ name: "Work", newName: "no good" })],
    ["Rename to a taken name", RENAME, () => ({ name: "Work", newName: "Spare" })],
    ["Remove Default", REMOVE, () => ({ name: "Default" })],
    ["Remove an unknown name", REMOVE, () => ({ name: "Nobody" })],
  ];

  test.each(cases)("%s (AC-1)", async (_what, route, body) => {
    const first = accountDir();
    const second = accountDir();
    const { base, file } = serve(
      `{ "claudeAccounts": { "Work": { "configDir": ${JSON.stringify(first)} }, "Spare": { "configDir": ${JSON.stringify(second)} } } }\n`,
    );
    // The live accounts are the ones the board booted with, so make them known.
    await post(base, ADD, { name: "Work", configDir: first });
    await post(base, ADD, { name: "Spare", configDir: second });
    const before = readFileSync(file, "utf-8");
    const res = await post(base, route, body(accountDir()));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).length).toBeGreaterThan(10);
    expect(readFileSync(file, "utf-8")).toBe(before);
  });

  test("Add a name already taken, and another account's directory (AC-1)", async () => {
    const { base, file } = serve();
    const dir = accountDir();
    await post(base, ADD, { name: "Work", configDir: dir });
    const before = readFileSync(file, "utf-8");
    expect((await post(base, ADD, { name: "work", configDir: accountDir() })).status).toBe(400);
    expect((await post(base, ADD, { name: "Spare", configDir: dir })).status).toBe(400);
    expect(readFileSync(file, "utf-8")).toBe(before);
  });
});
