// Once an archive lands, the project's wiki is refreshed: the board queues a
// wiki job that rewrites only the pages whose files the change moved.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueWikiRefresh } from "../../../../src/serve/land-branch/steps.ts";
import type { LandContext } from "../../../../src/serve/land-branch/types.ts";

let root = "";
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

function ctxFor(specsRoot: string, enqueue: (raw: unknown) => unknown): LandContext {
  return { machinerySpecsRoot: () => specsRoot, queue: { enqueue } } as unknown as LandContext;
}

describe("a wiki refresh after an archive lands", () => {
  test("a project with a wiki gets one refresh job", () => {
    root = mkdtempSync(join(tmpdir(), "wiki-refresh-"));
    mkdirSync(join(root, "wiki"));
    writeFileSync(join(root, "wiki", "index.md"), "# Wiki index\n");
    const queued: unknown[] = [];
    queueWikiRefresh(ctxFor(root, (raw) => { queued.push(raw); return { ok: true }; }), "aide");
    expect(queued).toEqual([{ project: "aide", specFolder: "wiki-aide", steps: ["wiki"], wikiRefresh: true }]);
  });

  test("a project without one gets none", () => {
    root = mkdtempSync(join(tmpdir(), "wiki-refresh-"));
    const queued: unknown[] = [];
    queueWikiRefresh(ctxFor(root, (raw) => { queued.push(raw); return { ok: true }; }), "aide");
    expect(queued).toEqual([]);
  });

  test("a refresh already queued is the answer, not a fault", () => {
    root = mkdtempSync(join(tmpdir(), "wiki-refresh-"));
    mkdirSync(join(root, "wiki"));
    writeFileSync(join(root, "wiki", "index.md"), "# Wiki index\n");
    expect(() => queueWikiRefresh(ctxFor(root, () => ({ ok: false, error: "already queued" })), "aide")).not.toThrow();
  });
});
