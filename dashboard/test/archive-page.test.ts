// Spec 163: the archive is on the dashboard.
//
// An archived spec's PAGE has worked since spec 150 — `specDir()`
// resolves an archived folder, and the four files render — but nothing
// on the dashboard linked to one, so the pages existed and could not be
// found. `/archive` is the way in: every archived spec, grouped by
// project, each with the date it was archived and a link to the page
// that already worked.
//
// And the other half: an archived spec is a RECORD. Edit used to be
// offered on its page, and Save would have written, committed and
// pushed into `archive/`. Both routes refuse it now — server-side, not
// only by hiding the button.

import { afterEach, describe, expect, test } from "bun:test";
import type { GitRunner } from "../src/branch-status.ts";
import { queueHarness } from "./helpers/queue-server.ts";

const TOKEN = "s3cret-token";
const auth = { headers: { "x-aide-token": TOKEN } };

const STAMPED = "150-one-page-shows-the-whole-spec";
const UNSTAMPED = "92-the-push-is-branch-only";

const ARCHIVED = {
  [STAMPED]: {
    description: "# One page shows the whole spec - Description\n",
    status: "# Status\n\n## Tracking info\n\n- **Archived:** `2026-08-13`\n",
  },
  [UNSTAMPED]: {
    description: "# The push is branch only - Description\n",
    status: "# Status\n\n## Tracking info\n\n- **Workflow steps completed:** create\n",
  },
};

/** Git as the archive listing asks it: the last commit touching a
 *  spec's own folder. Only the unstamped spec needs an answer — the
 *  stamped one never reaches git — so the runner keys on the directory
 *  it is given, and everything else is a repo git cannot read. */
const gitDated = (dates: Record<string, string>): GitRunner =>
  async (dir, args) => {
    if (!args.join(" ").startsWith("log -1 --format=")) return { code: 1, stdout: "" };
    for (const [folder, at] of Object.entries(dates)) {
      if (dir.includes(folder)) return { code: 0, stdout: `a3f9c21deadbeef\t${at}\n` };
    }
    return { code: 1, stdout: "" };
  };

const harness = queueHarness("aide-archive-page-");
afterEach(() => harness.cleanup());

const start = (extra: Record<string, unknown> = {}, archivedSpecs = ARCHIVED) =>
  harness.start({
    archivedSpecs,
    extra: { queueToken: TOKEN, gitRun: gitDated({ [UNSTAMPED]: "2026-07-30T11:02:00+02:00" }), ...extra },
  });

const archivePage = async (base: string): Promise<string> => {
  const res = await fetch(`${base}/archive`, auth);
  expect(res.status).toBe(200);
  return res.text();
};

// --- criteria 1, 2, 9: every row carries a date -----------------------------

describe("the archived date on a row", () => {
  test("is the stamp the archive step wrote, when there is one", async () => {
    const html = await archivePage(start().base);
    expect(html).toContain("2026-08-13");
  });

  // The stamp only started being written at spec 147; the older half of
  // the archive has none, and git remembers the commit that moved the
  // folder.
  test("falls back to the commit that last touched the folder", async () => {
    const html = await archivePage(start().base);
    expect(html).toContain("2026-07-30");
  });

  // A blank cell for half the archive is the one outcome
  // 1-description.md ruled out by name.
  test("says so in words when neither the stamp nor git answers", async () => {
    const { base } = start({ gitRun: gitDated({}) });
    const html = await archivePage(base);
    expect(html).toContain("date unknown");
  });
});

// --- criterion 3: the listing itself ----------------------------------------

describe("the /archive listing", () => {
  test("names the project and links each spec to its own page", async () => {
    const html = await archivePage(start().base);
    expect(html).toContain(">aide<");
    expect(html).toContain(`href="/specs/aide/${STAMPED}"`);
    expect(html).toContain(`href="/specs/aide/${UNSTAMPED}"`);
    expect(html).toContain("One page shows the whole spec");
  });

  // The listing is the archive and nothing else: a live spec has the
  // spec list, and a row in both places says the spec is in two states.
  test("holds no live spec", async () => {
    const html = await archivePage(start().base);
    expect(html).not.toContain("81-queue-and-runner");
  });

  // Newest first, so the specs someone is most likely to look up are
  // the ones at the top of a list that only grows.
  test("orders a project's specs newest first", async () => {
    const html = await archivePage(start().base);
    expect(html.indexOf(STAMPED)).toBeLessThan(html.indexOf(UNSTAMPED));
  });

  // Same rule as `targets()`: the allowlist in queue-config.json is
  // what the dashboard shows, and a discovered project that is not on
  // it is not the dashboard's business.
  test("shows only the projects the queue is allowed to run", async () => {
    const { base } = harness.start({
      alsoProjects: ["skjer"],
      archivedSpecs: ARCHIVED,
      extra: { queueToken: TOKEN, queueProjects: ["skjer"], gitRun: gitDated({}) },
    });
    const html = await archivePage(base);
    expect(html).not.toContain(STAMPED);
  });

  test("it is a GET, and behind the token like every other spec path", async () => {
    const { base } = start();
    expect((await fetch(`${base}/archive`, { method: "POST", ...auth, redirect: "manual" })).status).toBe(405);
    expect((await fetch(`${base}/archive`)).status).toBe(401);
  });
});

// --- criteria 5, 10: the archived spec's own page ---------------------------

describe("an archived spec's own page", () => {
  const page = `/specs/aide/${STAMPED}`;

  // `targets()` only ever held LIVE specs, so the lookup behind the
  // title found nothing and the description line was omitted entirely —
  // silently, because the H1 comes from the folder name and the page
  // looked right.
  test("shows its title, which the live-only lookup used to drop", async () => {
    const { base } = start();
    const html = await (await fetch(`${base}${page}`, auth)).text();
    // The description LINE, not the word anywhere on the page: the four
    // files are printed below it, so the title is in the markup either
    // way and only the banner says the lookup found it.
    expect(html).toContain(`<p class="desc"><strong>One page shows the whole spec</strong></p>`);
  });

  test("offers no Edit link, and says why", async () => {
    const { base } = start();
    const html = await (await fetch(`${base}${page}`, auth)).text();
    expect(html).not.toContain("/edit");
    expect(html.toLowerCase()).toContain("archived");
  });

  test("a live spec's page still offers Edit", async () => {
    const { base } = start();
    const html = await (await fetch(`${base}/specs/aide/81-queue-and-runner`, auth)).text();
    expect(html).toContain("/specs/aide/81-queue-and-runner/edit");
  });
});
