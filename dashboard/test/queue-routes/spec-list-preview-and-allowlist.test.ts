// Split out of spec-list-rendering.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOKEN, JOB, setupQueueRoutesHarness } from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

// --- spec 95: the preview link is read from the project's own manifest -------

// The pure render functions are tested next to the markup they produce.
// What only the server can answer is which repo a preview belongs to:
// the manifest lives in the project's checkout, and the specs repo
// beside it carries a plan with nothing to try.
describe("GET /queue and /specs/<id>: the preview link (criteria 1-4)", () => {
  const AUTH = { "x-aide-token": TOKEN };
  const TEMPLATE = "https://{branch}.example.pages.dev";
  const EXPECTED = "https://aide-81-queue-and-runner.example.pages.dev";

  /** A project root holding the project's own checkout and a specs repo
   *  beside it — the shape an `aide` spec actually pushes to. Only the
   *  project's checkout gets a manifest; the specs repo has none, which
   *  is what makes it a plan repo rather than deployable code. */
  function roots(preview?: string): { root: string; repo: string; specsRepo: string } {
    const root = mkdtempSync(join(tmpdir(), "aide-preview-"));
    ownDirs.push(root);
    const repo = join(root, "aide");
    mkdirSync(join(repo, ".aide"), { recursive: true });
    writeFileSync(
      join(repo, ".aide", "project.yaml"),
      `name: aide\ndeployment:\n  host: somewhere\n` + (preview ? `  preview: "${preview}"\n` : ""),
    );
    const specsRepo = join(root, "aide-specs");
    mkdirSync(specsRepo, { recursive: true });
    return { root, repo, specsRepo };
  }

  const gitQuiet = async (_dir: string, args: string[]) => {
    const a = args.join(" ");
    if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
    if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
    return { code: 0, stdout: "" };
  };

  async function seed(branchUrls: { root: string; url: string }[]): Promise<{ mirror: string; id: string }> {
    const { base, dir } = start({ queueToken: TOKEN });
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...AUTH },
        body: JSON.stringify(JOB),
      })
    ).json()) as { job: { id: string } };
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === made.job.id)!;
    job.state = "done";
    job.branchUrls = branchUrls;
    writeFileSync(mirror, JSON.stringify(jobs));
    return { mirror, id: made.job.id };
  }

  const startWith = (root: string, mirror: string) =>
    start({ queueToken: TOKEN, queueMirrorPath: mirror, queueProjectRoot: root, gitRun: gitQuiet }).base;

  test("the row carries the manifest's preview link for the project's own repo (criterion 1)", async () => {
    const { root, repo, specsRepo } = roots(TEMPLATE);
    const { mirror, id } = await seed([
      { root: repo, url: "https://example.test/aide" },
      { root: specsRepo, url: "https://example.test/aide-specs" },
    ]);
    const html = await (await fetch(`${startWith(root, mirror)}/queue?rows=1`, { headers: AUTH })).text();
    expect(html).toContain(`href="${EXPECTED}"`);
    // One link, not two: the specs repo pushed a branch of the same
    // name, and there is nothing to try in a plan (criterion 4).
    expect(html.match(/>preview<\/a>/g)).toHaveLength(1);
    expect(id).toBeTruthy();
  });

  // Spec 150: the Work row left the job page, and the preview link went
  // with it — both are on the row this page is opened from, and the
  // Overview is now what is said nowhere else.
  test("the job page carries neither link — the row has both (spec 150)", async () => {
    const { root, repo } = roots(TEMPLATE);
    const { mirror, id } = await seed([{ root: repo, url: "https://example.test/aide" }]);
    const html = await (await fetch(`${startWith(root, mirror)}/specs/${id}`, { headers: AUTH })).text();
    expect(html).not.toContain(`href="${EXPECTED}"`);
    expect(html).not.toContain('href="https://example.test/aide"');
  });

  test("a manifest without the key adds nothing at all (criterion 3)", async () => {
    const { root, repo } = roots();
    const { mirror } = await seed([{ root: repo, url: "https://example.test/aide" }]);
    const html = await (await fetch(`${startWith(root, mirror)}/queue?rows=1`, { headers: AUTH })).text();
    expect(html).not.toContain(">preview</a>");
    expect(html).toContain('href="https://example.test/aide"');
  });

  // The manifest is read per render, not once at startup: adding the key
  // must show up on the next page load, not the next deploy.
  test("a manifest edited while the server runs is picked up on the next render", async () => {
    const { root, repo } = roots();
    const { mirror } = await seed([{ root: repo, url: "https://example.test/aide" }]);
    const base = startWith(root, mirror);
    expect(await (await fetch(`${base}/queue?rows=1`, { headers: AUTH })).text()).not.toContain(">preview</a>");
    writeFileSync(join(repo, ".aide", "project.yaml"), `name: aide\ndeployment:\n  preview: "${TEMPLATE}"\n`);
    expect(await (await fetch(`${base}/queue?rows=1`, { headers: AUTH })).text()).toContain(`href="${EXPECTED}"`);
  });
});

// A project taken out of the queue's allowlist (aide-dashboard, folded
// into aide by spec 85) still has its jobs in the 200-job history, and
// the page kept them as rows: three specs of a project that no longer
// exists, with a Run button that could only be refused. The row list is
// what the queue may run; a dead project's history is not on it.
describe("jobs of a project no longer in the allowlist are not rows", () => {
  const AUTH = { headers: { "x-aide-token": TOKEN } };

  test("a mirror carrying a retired project's jobs renders none of them", async () => {
    const dead = { ...JOB, project: "aide-dashboard", specFolder: "01-first" };
    // Enqueued while the project was still allowed and had a spec, then
    // served by a queue that no longer lists it — the shape of a
    // project retired after the fact.
    const first = start({ queueToken: TOKEN, queueProjects: ["aide", "aide-dashboard"] }, ["aide-dashboard"]);
    await fetch(`${first.base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...AUTH.headers },
      body: JSON.stringify(dead),
    });
    const mirror = join(first.dir, "queue.json");
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror, queueProjects: ["aide"] });
    const html = await (await fetch(`${base}/?rows=1`, AUTH)).text();
    expect(html).not.toContain("01-first");
    expect(html).not.toContain("aide-dashboard");
    // The API keeps the history: this is a page rule, not a deletion.
    const api = (await (await fetch(`${base}/api/queue`, AUTH)).json()) as { jobs: { project: string }[] };
    expect(api.jobs.some((j) => j.project === "aide-dashboard")).toBe(true);
  });
});
