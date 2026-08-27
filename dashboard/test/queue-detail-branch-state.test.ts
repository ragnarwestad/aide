// Split out of queue-detail.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerOptions } from "../src/serve/serve.ts";
import { queueHarness } from "./helpers/queue-server.ts";

const TOKEN = "s3cret-token";

const DESCRIPTION =
  "# A running job is a black box - Description\n\n" +
  "## Table of contents\n\n- [Description](#description)\n\n---\n\n" +
  "## Description\n\nThe queue shows state, step and cost. It shows nothing about " +
  "what the job IS, and nothing about what it is doing.\n\n---\n\n" +
  "## Related documents\n\n- [2-analysis.md](./2-analysis.md)\n";

const harness = queueHarness("aide-queue-detail-");

const start = (extra: Partial<ServerOptions> = {}) =>
  harness.start({ description: DESCRIPTION, extra: { queueToken: TOKEN, ...extra } });

afterEach(() => harness.cleanup());

const auth = { headers: { "x-aide-token": TOKEN } };

async function enqueue(base: string, steps: string[] = ["analyze"]): Promise<string> {
  const res = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
    body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps }),
  });
  const body = (await res.json()) as { job: { id: string } };
  return body.job.id;
}

// --- spec 89: one line per repo, each with its own merge state ---------------

// A job that touches two repositories creates a branch of the SAME NAME
// in both, with different contents and two separate compare pages. One
// link and one boolean cannot say that the project's branch landed and
// the specs repo's did not — which is exactly the state that went
// unnoticed three times on 2026-08-17.
describe("every branch a spec made, with its own merge state (criteria 1, 2, 9)", () => {
  const PROJECT_REPO = "/repos/aide";
  const SPECS_REPO = "/repos/aide-specs";
  const PROJECT_URL = "https://example.test/aide/compare";
  const SPECS_URL = "https://example.test/aide-specs/compare";

  async function seededWith(branchUrls: { root: string; url: string }[]): Promise<{ mirror: string; id: string }> {
    const { base, dir } = start();
    const id = await enqueue(base);
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(await Bun.file(mirror).text()) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === id)!;
    job.state = "done";
    job.branchUrls = branchUrls;
    job.branchUrl = branchUrls[0]?.url;
    writeFileSync(mirror, JSON.stringify(jobs));
    return { mirror, id };
  }

  /** Merged in the repos named, unmerged everywhere else. */
  const gitMergedIn = (roots: string[]) => async (dir: string, args: string[]) => {
    if (args[0] === "symbolic-ref") return { code: 0, stdout: "refs/remotes/origin/master\n" };
    if (args[0] === "merge-base") return { code: roots.includes(dir) ? 0 : 1, stdout: "" };
    return { code: 0, stdout: "" };
  };

  const count = (html: string, needle: string): number => html.split(needle).length - 1;

  test("both repos' branches are shown, not one standing in for both (criterion 1)", async () => {
    const { mirror, id } = await seededWith([
      { root: PROJECT_REPO, url: PROJECT_URL },
      { root: SPECS_REPO, url: SPECS_URL },
    ]);
    const { base } = start({ queueMirrorPath: mirror, gitRun: gitMergedIn([]) });
    // The row, and the row alone, since spec 150 took the branch list
    // off the job page.
    const html = await (await fetch(`${base}/`, auth)).text();
    expect(html).toContain(PROJECT_URL);
    expect(html).toContain(SPECS_URL);
    // Each repo is named, so a reader knows WHICH branch is which.
    expect(html).toContain("aide-specs");
    expect(html).not.toContain("waiting for archive");
    const job = await (await fetch(`${base}/specs/${id}`, auth)).text();
    expect(job).not.toContain(PROJECT_URL);
    expect(job).not.toContain(SPECS_URL);
  });

  // Criterion 2 was the per-repo merge caveat — one repo landed, the
  // other not, said separately. The row does not carry merge state at
  // all now, so what remains to protect is the link per repo, which the
  // test above asserts.

  // `paceup` and `atlasaurus` keep their specs inside the project repo,
  // so a job there touches one repo and makes one branch. That is the
  // NORMAL shape, and it must render through the same code — a list of
  // length one, not a separate single-branch template.
  test("one repo renders as a list of one, through the same markup (criterion 9)", async () => {
    const { mirror } = await seededWith([{ root: PROJECT_REPO, url: PROJECT_URL }]);
    const { base } = start({ queueMirrorPath: mirror, gitRun: gitMergedIn([]) });
    const one = await (await fetch(`${base}/`, auth)).text();

    const two = await seededWith([
      { root: PROJECT_REPO, url: PROJECT_URL },
      { root: SPECS_REPO, url: SPECS_URL },
    ]);
    const { base: base2 } = start({ queueMirrorPath: two.mirror, gitRun: gitMergedIn([]) });
    const many = await (await fetch(`${base2}/`, auth)).text();

    expect(count(one, `class="branch"`)).toBe(1);
    expect(count(many, `class="branch"`)).toBe(2);
    expect(count(one, "branchlist")).toBe(count(many, "branchlist"));
  });

  // A job written before this spec shipped has `branchUrl` and no
  // `branchUrls`. It must render exactly as it did — which is what the
  // "spec 04" block above proves, unmodified, and this restates for the
  // one thing that block does not look at: the repo it was checked in.
  test("a job from before this spec still shows its one branch (criterion 6)", async () => {
    const { base, dir } = start();
    const id = await enqueue(base);
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(await Bun.file(mirror).text()) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === id)!;
    job.state = "done";
    job.branchUrl = PROJECT_URL; // and no branchUrls at all
    writeFileSync(mirror, JSON.stringify(jobs));
    const { base: base2 } = start({ queueMirrorPath: mirror, gitRun: gitMergedIn([]) });
    const html = await (await fetch(`${base2}/`, auth)).text();
    expect(count(html, `class="branch"`)).toBe(1);
    expect(html).toContain(PROJECT_URL);
  });
});

// --- spec 89: the button that does the merging -------------------------------
// --- spec 96: and what, exactly, it will merge -------------------------------

// The count told a reader how MANY repos, never which kind. "Merge (1)"
// on a spec mid-`review-plan` meant "merge the plan the running step is
// about to rewrite" — three facts a reader had to combine themselves.
// The button now says the conclusion, and is not the default action
// while a step is still writing to the branch.
// Spec 96 gave the Merge button a sentence naming WHICH repo it would
// land; spec 132 moved that sentence onto the State line. Spec 149
// removed both — every step lands its own work, so the State line says
// which PHASE is next instead, and the per-repo badge says what each
// branch is waiting for.
describe("what an open branch says about itself (criteria 1-8)", () => {
  const PROJECT_REPO = "/repos/aide";
  const SPECS_REPO = "/repos/aide-specs";

  async function seededWith(
    branchUrls: { root: string; url: string }[],
    state = "done",
  ): Promise<string> {
    const { base, dir } = start();
    const id = await enqueue(base);
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(await Bun.file(mirror).text()) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === id)!;
    job.state = state;
    job.branchUrls = branchUrls;
    writeFileSync(mirror, JSON.stringify(jobs));
    return mirror;
  }

  const gitMergedIn = (roots: string[]) => async (dir: string, args: string[]) => {
    if (args[0] === "symbolic-ref") return { code: 0, stdout: "refs/remotes/origin/master\n" };
    if (args[0] === "merge-base") return { code: roots.includes(dir) ? 0 : 1, stdout: "" };
    return { code: 0, stdout: "" };
  };

  const listWith = async (mirror: string, merged: string[] = []) => {
    const { base } = start({ queueMirrorPath: mirror, gitRun: gitMergedIn(merged) });
    return await (await fetch(`${base}/`, auth)).text();
  };

  // The two repos a spec in THIS project makes: `aide` is the project's
  // own checkout — its basename is the project's name, by construction —
  // and `aide-specs` is not a project on this machine at all, which is
  // exactly what makes it the specs repo.
  const count = (html: string, needle: string): number => html.split(needle).length - 1;
  const BOTH = [
    { root: PROJECT_REPO, url: "https://example.test/aide" },
    { root: SPECS_REPO, url: "https://example.test/aide-specs" },
  ];

  // One link per open branch, and the row says nothing at all about a
  // merge: naming which repo a press would land was the press's own
  // sentence, and there is no press (spec 149).
  test("each open branch gets its own link, and no row asks for a merge", async () => {
    const html = await listWith(await seededWith(BOTH));
    expect(count(html, `class="branch"`)).toBe(2);
    expect(html).not.toContain("waiting for archive");
    expect(html).not.toContain("ready to merge");
    expect(html).not.toContain("/merge");
  });

  // `paceup` and `atlasaurus` keep their specs INSIDE the project repo,
  // so a spec there has one branch whose label is the project's own
  // name. It is worded exactly as the two-repo case — which repo it is
  // stopped being something the row has to say.
  test("a spec whose only repo is the project itself reads the same way", async () => {
    const html = await listWith(await seededWith([{ root: PROJECT_REPO, url: "https://example.test/aide" }]));
    expect(count(html, `class="branch"`)).toBe(1);
    expect(html).not.toContain("ready to merge");
  });

  // The description's own read-off-the-page: a `Merge (1)` button,
  // enabled, while the step writing that very plan was still running.
  // It was disabled first, and since spec 105 it is not drawn at all —
  // a busy spec's row offers Cancel and nothing else, and a control
  // that cannot be pressed is one more thing to read past.
  test("while a step is still running there is no Merge button at all (criterion 1)", async () => {
    const html = await listWith(await seededWith(BOTH, "running"));
    expect(html).not.toContain('class="mergeform"');
    expect(html).not.toContain("/merge");
  });

  // Gone since 2026-08-19: the small "merge anyway" behind a confirm was
  // never used on purpose and read as nonsense without its context.
  // Merging mid-job means cancelling the job first.
  test("no override beside it either while a step runs", async () => {
    const html = await listWith(await seededWith(BOTH, "running"));
    expect(html).not.toContain('class="mergeoverride"');
    expect(html).not.toContain("merge anyway");
    expect(html).not.toContain("confirm(");
  });

  // Since spec 132 a finished job's ROW carries no button at all — the
  // press is in the panel, where every other action already lived. That
  // the panel's own Merge is enabled for exactly this case is proved in
  // `render.test.ts`, "Merge is disabled, never absent…".
  test("a finished job's row offers no button, and no override beside it", async () => {
    const html = await listWith(await seededWith(BOTH));
    expect(html).not.toContain('class="mergeoverride"');
    expect(html).not.toContain("merge anyway");
    expect(html).not.toContain('class="mergeform"');
  });

  test("everything already merged leaves no button at all (criterion 7)", async () => {
    const mirror = await seededWith([{ root: PROJECT_REPO, url: "https://example.test/aide" }]);
    expect(await listWith(mirror, [PROJECT_REPO])).not.toContain("/merge");
  });

  test("a spec that never pushed anywhere has nothing to merge (criterion 8)", async () => {
    const { base } = start();
    await enqueue(base);
    const html = await (await fetch(`${base}/`, auth)).text();
    expect(html).not.toContain("/merge");
  });
});
