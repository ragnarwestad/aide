// The specs list links to a branch's preview address once the sweep holds
// one. This proves the served list is wired to that answer, once: the
// project's own setting, the cached origin answer and a `gh` that says
// Cloudflare has built the branch. What each step decides is proven where
// it lives (`branch-previews.test.ts`, `branch-preview-sweep.test.ts`,
// `branch-preview.test.ts`).

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ran } from "../../helpers/queue-server.ts";
import { createGitRunner, type GitRunner } from "../../../src/git/branch-status.ts";
import type { GhRunner } from "../../../src/integrations/pull-requests.ts";
import { specControls, phaseDone, listUntil, specPanel, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => harness.cleanup());

const FOLDER = "81-queue-and-runner";
const ADDRESS = "https://aide-81-queue-and-runne.aide.pages.dev";
const CHECK_RUNS = JSON.stringify({
  check_runs: [{
    id: 1, name: "Cloudflare Pages", status: "completed", conclusion: "success",
    app: { slug: "cloudflare-workers-and-pages" },
    output: { summary: `<tr><td><strong>Branch Preview URL:</strong></td><td><a href='${ADDRESS}'>${ADDRESS}</a></td></tr>` },
  }],
});

describe("the specs list links to the branch's preview address", () => {
  /** Real git for the history, a fake origin holding the branch. */
  const originHoldingBranch: GitRunner = (() => {
    const real = createGitRunner();
    return async (dir, args, timeoutMs, env) =>
      args.join(" ") === "ls-remote --heads origin refs/heads/aide/*"
        ? { code: 0, stdout: `deadbeef0000000000000000000000000000000\trefs/heads/aide/${FOLDER}\n` }
        : real(dir, args, timeoutMs, env);
  })();

  async function listFor(previewFrom: string): Promise<{ html: string; asked: number }> {
    let asked = 0;
    const ghRun: GhRunner = async () => {
      asked += 1;
      return { code: 0, stdout: CHECK_RUNS };
    };
    const { base, dir } = start({ gitRun: originHoldingBranch, ghRun, branchPreviewPollMs: 40, testServersAvailable: false });
    writeFileSync(
      join(dir, "root", "aide", ".aide", "project.yaml"),
      `name: aide\ndeployment:\n  previewFrom: ${previewFrom}\n`,
    );
    ran(dir, ["create", "analyze", "implement"]);
    const html = await listUntil(
      base,
      (h) => phaseDone(specControls(h, FOLDER), "implement") && (previewFrom !== "cloudflare-pages" || specPanel(h, FOLDER).includes(ADDRESS)),
      undefined,
      "implement done and the preview link",
    );
    return { html, asked };
  }

  test("a cloudflare-pages project whose branch has been built has the link (AC-1)", async () => {
    const { html } = await listFor("cloudflare-pages");
    expect(specPanel(html, FOLDER)).toContain(`href="${ADDRESS}"`);
  });

  test("a project set to none has no link and GitHub is never asked (AC-4)", async () => {
    const { html, asked } = await listFor("none");
    await new Promise((r) => setTimeout(r, 200));
    expect(specPanel(html, FOLDER)).not.toContain(ADDRESS);
    expect(asked).toBe(0);
  });
});
