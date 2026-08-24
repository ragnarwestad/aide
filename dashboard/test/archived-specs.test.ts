// Spec 221: an archived spec is a row on the Specs list.
//
// This file was `archive-page.test.ts` — the suite for `/archive`, the
// page specs 163 and 170 built. That page is gone: everything it could
// do is done from `/` now, so its coverage moved here rather than being
// dropped. The date fallbacks, the search's three fields, the whole
// description behind a two-line clamp and the "not landed" mark are the
// same rules with a new home, and they are tested at the same altitude
// they always were — a real server and a real `fetch`, because the
// change spans discovery, the query string, the filter and the HTML,
// and only the route puts all four together.
//
// What is new here is the reader row itself: an archived spec has no
// Run, no model select and no tick box, because the server refuses
// every step but `reopen` for it (`ARCHIVE_ONLY_STEP`) and a control
// that would be refused is a control that should not be drawn.
//
// What no test here can say is whether two clamped lines of prose read
// well beside a live spec's own row, or whether the reader row really
// holds together at 390px — that is the Manual testing note in
// 3-solution.md.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { GitRunner } from "../src/branch-status.ts";
import { CSS } from "../src/render/css.ts";
import { queueHarness } from "./helpers/queue-server.ts";

const TOKEN = "s3cret-token";
const auth = { headers: { "x-aide-token": TOKEN } };

/** The one LIVE spec every harness starts with. */
const LIVE = "81-queue-and-runner";
/** And the live spec `alsoProjects` gives the second project. Named
 *  because the combined view has to order it with the rest. */
const LIVE_OTHER = "01-first";

const STAMPED = "150-one-page-shows-the-whole-spec";
const UNSTAMPED = "92-the-push-is-branch-only";
/** Same stamped date as STAMPED, lower number: what the folder-number
 *  tie-break is for. */
const SAME_DAY = "60-the-queue-remembers";
/** No stamp, and a git runner that cannot date it either. */
const UNDATED = "31-a-folder-copied-in";
/** In another project, and archived later than anything in `aide` — so
 *  the two projects have to interleave for it to come out on top. */
const OTHER = "05-the-other-project";

/** Spec 207 added a second machine-written bullet to the same section.
 *  `ms` absent is a spec archived before that existed, which is the
 *  blank-cell case 1-description.md names by hand. */
const stamp = (date: string, ms?: number) =>
  `# Status\n\n## Tracking info\n\n` +
  (ms === undefined ? "" : `- **Time spent (ms):** \`${ms}\`\n`) +
  `- **Archived:** \`${date}\`\n`;

/** What the stamped fixture cost, in milliseconds. Named so the tests
 *  assert on the figure the fixture wrote rather than on a literal that
 *  could drift away from it. */
const STAMPED_MS = 4_530_000;
/** A spec whose phases measured nothing. Falsy, present, and the whole
 *  reason the sort's null-sink cannot be a truthy check. */
const ZERO_MS = 0;
const OTHER_MS = 90_000;
const noStamp = "# Status\n\n## Tracking info\n\n- **Workflow steps completed:** create\n";

const described = (title: string, prose: string) =>
  `# ${title} - Description\n\n## Description\n\n${prose}\n`;

/** The long one: what the two-line clamp exists for, and what proves
 *  that search reaches text the cell cannot show. */
const LONG_TAIL = "wolverine";
const LONG =
  "The archive is a record and a record only grows. " +
  "A page that was fine at six specs is a wall of prose at eighty, " +
  "which is why the description column is bounded rather than left to " +
  `the browser, and why the ${LONG_TAIL} at the end of this paragraph ` +
  "is still findable by searching even though nobody will ever see it.";

const ARCHIVED = {
  [STAMPED]: {
    description: described("One page shows the whole spec", "Every spec file on one page."),
    status: stamp("2026-08-13", STAMPED_MS),
  },
  [UNSTAMPED]: {
    description: described("The push is branch only", `A run pushes a branch. ${LONG}`),
    status: noStamp,
  },
  [SAME_DAY]: {
    description: described("The queue remembers", "Jobs survive a restart."),
    status: stamp("2026-08-13", ZERO_MS),
  },
  // No `## Description` section at all: the dash case.
  [UNDATED]: { description: "# A folder copied in - Description\n", status: noStamp },
  [OTHER]: {
    description: described("The other project", "Proof that projects interleave."),
    status: stamp("2026-08-20", OTHER_MS),
    project: "skjer",
  },
};

/** Git as the archived rows ask it: the last commit touching a spec's
 *  own folder. Only the unstamped specs reach git — a stamped one never
 *  does — so the runner keys on the directory it is given, and
 *  everything else is a repo git cannot read. */
const gitDated = (dates: Record<string, string>): GitRunner =>
  async (dir, args) => {
    if (!args.join(" ").startsWith("log -1 --format=")) return { code: 1, stdout: "" };
    for (const [folder, at] of Object.entries(dates)) {
      if (dir.includes(folder)) return { code: 0, stdout: `a3f9c21deadbeef\t${at}\n` };
    }
    return { code: 1, stdout: "" };
  };

const harness = queueHarness("aide-archived-specs-");
afterEach(() => harness.cleanup());

type ArchivedFixture = Record<string, { description?: string; status?: string; project?: string }>;

const start = (extra: Record<string, unknown> = {}, archivedSpecs: ArchivedFixture = ARCHIVED) =>
  harness.start({
    archivedSpecs,
    alsoProjects: ["skjer"],
    extra: {
      queueToken: TOKEN,
      queueProjects: ["aide", "skjer"],
      gitRun: gitDated({ [UNSTAMPED]: "2026-07-30T11:02:00+02:00" }),
      ...extra,
    },
  });

/** The Specs list, whatever the query. `?state=archived` is the view
 *  most of this file is about — the reading the Archive tab used to be. */
const specsList = async (base: string, query = ""): Promise<string> => {
  const res = await fetch(`${base}/${query}`, auth);
  expect(res.status).toBe(200);
  return res.text();
};

const ARCHIVED_VIEW = "?state=archived";
const ALL_VIEW = "?state=all";

/** The folders the table lists, in the order it lists them. Read off
 *  the row links rather than off the raw HTML: a folder name also
 *  appears inside a href, and `indexOf` on the bare name would compare
 *  two different things. A job's own page is `/specs/<id>` — one
 *  segment — so the two-segment shape here is the SPEC link and nothing
 *  else. */
const order = (html: string): string[] =>
  [...html.matchAll(/href="\/specs\/[A-Za-z0-9._-]+\/([A-Za-z0-9._-]+)"/g)].map((m) => m[1]!);

/** One spec's whole row. Read per row, because a mark appearing
 *  anywhere on the page says nothing about WHICH spec it belongs to. */
const rowFor = (html: string, folder: string): string => {
  const rows = html.split('<tr class="spechead').filter((r) => r.includes(`/${folder}"`));
  expect(rows.length).toBe(1);
  return rows[0]!.slice(0, rows[0]!.indexOf("</tr>"));
};

/** Spec 208 moved WHEN origin is asked: the render reads whatever a
 *  background schedule last found, so the page is polled until the
 *  first tick has landed rather than assumed to have made the call
 *  itself. The same bounded loop `projects-route.test.ts` uses. */
const listUntil = async (base: string, text: string, query = "", budgetMs = 2000): Promise<string> => {
  const deadline = Date.now() + budgetMs;
  let html = "";
  while (Date.now() < deadline) {
    html = await specsList(base, query);
    if (html.toLowerCase().includes(text.toLowerCase())) return html;
    await new Promise((r) => setTimeout(r, 25));
  }
  return html;
};

// --- criterion 1: the default view is the reading view, unchanged ----------

describe("the default filter", () => {
  test("is a chip of its own, and it is the one the bare page resolves to", async () => {
    const html = await specsList(start().base);
    expect(html).toContain(">Not archived");
    expect(html).toMatch(/aria-current="true"[^>]*>Not archived/);
  });

  // Every archived spec in this fixture has landed — `gitDated` answers
  // no `ls-remote` — which is what makes this the plain case. The one
  // exception is spec 193's, and it has a test of its own below.
  test("holds the live specs and no archived one at all (criterion 1)", async () => {
    const html = await specsList(start().base);
    expect(html).toContain(LIVE);
    for (const folder of Object.keys(ARCHIVED)) expect(html).not.toContain(folder);
    // Not the folder alone: the title and the description are what a
    // reader would see, and a row that leaked either would be a row.
    expect(html).not.toContain("One page shows the whole spec");
    expect(html).not.toContain("Every spec file on one page.");
  });

  test("still counts the archived specs on the chips that would show them", async () => {
    const html = await specsList(start().base);
    // Five archived specs exist and none of them is rendered — a chip
    // reading "Archived · 0" beside a list that has 150 of them is the
    // one thing a count must not say.
    expect(html).toMatch(/>Archived · 5</);
  });
});

// --- criterion 2: the Archived chip ----------------------------------------

describe("the Archived chip", () => {
  test("shows every archived spec and no live one (criterion 2)", async () => {
    const html = await specsList(start().base, ARCHIVED_VIEW);
    for (const folder of Object.keys(ARCHIVED)) expect(html).toContain(folder);
    expect(order(html)).not.toContain(LIVE);
  });

  // Same rule as `targets()`: the allowlist in queue-config.json is
  // what the dashboard shows, and a discovered project that is not on
  // it is not the dashboard's business.
  test("shows only the projects the queue is allowed to run", async () => {
    const html = await specsList(start({ queueProjects: ["skjer"] }).base, ARCHIVED_VIEW);
    expect(html).not.toContain(STAMPED);
    expect(html).toContain(OTHER);
  });

  test("names each spec's project on the link, the way every row does", async () => {
    const html = await specsList(start().base, ARCHIVED_VIEW);
    expect(html).toContain(`href="/specs/aide/${STAMPED}"`);
    expect(html).toContain(`href="/specs/skjer/${OTHER}"`);
  });
});

// --- criterion 3: it is a READER row ---------------------------------------

describe("an archived spec's row", () => {
  test("links its spec page, dates it, and offers Reopen (criterion 3)", async () => {
    const row = rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED);
    expect(row).toContain(`href="/specs/aide/${STAMPED}"`);
    expect(row).toContain("2026-08-13");
    expect(row).toContain("Reopen");
    expect(row).toContain('name="steps" value="reopen"');
  });

  test("draws no model select, no tick box and no Run (criterion 3)", async () => {
    const html = await specsList(start().base, ARCHIVED_VIEW);
    const row = rowFor(html, STAMPED);
    expect(row).not.toContain("<select");
    expect(row).not.toContain('type="checkbox"');
    // The Run form is a carrier with an id of its own; a reader row must
    // not carry one, nor the button that submits it.
    expect(row).not.toContain('class="rowrun"');
    expect(row).not.toContain("starting…");
    // And no fold control, because there is nothing under it to open.
    expect(row).not.toContain('class="fold');
  });

  test("says what it is, in the column that says what every row is", async () => {
    expect(rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED)).toContain(">archived<");
  });

  // The stamp only started being written at spec 147; the older half of
  // the archive has none, and git remembers the commit that moved the
  // folder.
  test("falls back to the commit that last touched the folder", async () => {
    expect(rowFor(await specsList(start().base, ARCHIVED_VIEW), UNSTAMPED)).toContain("2026-07-30");
  });

  // A blank cell for half the archive is the one outcome
  // 1-description.md ruled out by name.
  test("says so in words when neither the stamp nor git answers", async () => {
    expect(rowFor(await specsList(start().base, ARCHIVED_VIEW), UNDATED)).toContain("date unknown");
  });

  test("carries what the spec cost in time, when its archive recorded one", async () => {
    expect(rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED)).toContain("1h15m");
  });

  test("holds the whole description behind the clamp the archive used", async () => {
    const row = rowFor(await specsList(start().base, ARCHIVED_VIEW), UNSTAMPED);
    expect(row).toContain('class="spec-title archive-desc"');
    expect(row).toContain(LONG_TAIL);
  });

  test("that clamp is a real rule: two lines and a bounded width", () => {
    const rule = CSS.slice(CSS.indexOf(".archive-desc {"));
    expect(rule.slice(0, rule.indexOf("}"))).toMatch(/line-clamp:\s*2/);
    expect(rule.slice(0, rule.indexOf("}"))).toMatch(/max-width:/);
  });

  test("a spec with no description says so with a dash", async () => {
    expect(rowFor(await specsList(start().base, ARCHIVED_VIEW), UNDATED)).toContain("—");
  });
});

// --- criterion 4: spec 193's mark carries over ------------------------------
//
// Three specs reached the archive with their code still on a branch,
// and every row said done. This is the half that reaches a spec whose
// job the queue's LRU cap has long since evicted — 146's case — so the
// mark is derived from origin, not from the job.

describe("an archived spec whose branch is still on origin", () => {
  /** The dating runner every test here needs, plus origin's answer for
   *  "which spec branches are still open". `open` names the folders. */
  const gitWithBranches = (open: string[]): GitRunner =>
    async (dir, args) => {
      const a = args.join(" ");
      if (a.startsWith("ls-remote")) {
        return {
          code: 0,
          stdout: open.map((f) => `a3f9c21deadbeef\trefs/heads/aide/${f}\n`).join(""),
        };
      }
      return gitDated({ [UNSTAMPED]: "2026-07-30T11:02:00+02:00" })(dir, args);
    };

  test("carries the not-landed mark (criterion 4)", async () => {
    const { base } = start({ gitRun: gitWithBranches([STAMPED]) });
    const html = await listUntil(base, "not landed", ARCHIVED_VIEW);
    expect(rowFor(html, STAMPED).toLowerCase()).toContain("not landed");
  });

  test("and one whose branch is gone carries none", async () => {
    const { base } = start({ gitRun: gitWithBranches([STAMPED]) });
    const html = await listUntil(base, "not landed", ARCHIVED_VIEW);
    expect(rowFor(html, SAME_DAY).toLowerCase()).not.toContain("not landed");
  });

  test("a repo origin cannot be asked about marks nothing", async () => {
    // An unanswerable question is not evidence: a network blip must not
    // stamp the whole archive as unlanded.
    const unreachable: GitRunner = async (dir, args) =>
      args.join(" ").startsWith("ls-remote")
        ? { code: 128, stdout: "" }
        : gitDated({ [UNSTAMPED]: "2026-07-30T11:02:00+02:00" })(dir, args);
    const { base } = start({ gitRun: unreachable });
    // Wait for a tick to have happened at all, then ask: a page checked
    // before the schedule ran would pass for the wrong reason.
    await listUntil(base, "never appears", ARCHIVED_VIEW, 200);
    expect((await specsList(base, ARCHIVED_VIEW)).toLowerCase()).not.toContain("not landed");
  });

  // Spec 208, criterion 14. The set is whatever a schedule last found,
  // so how OLD it is decides how much of it to believe.
  test("the mark says how old its answer is", async () => {
    const { base } = start({ gitRun: gitWithBranches([STAMPED]) });
    const html = await listUntil(base, "not landed", ARCHIVED_VIEW);
    expect(rowFor(html, STAMPED)).toContain("checked just now");
  });

  // The one row shape, not two (1-description.md). Before this spec an
  // unlanded archived spec came through `jobGroup` and read as an
  // ordinary, fully-interactive job row — with a Run the server would
  // have refused.
  test("is the same reader row as every other archived spec", async () => {
    const { base } = start({ gitRun: gitWithBranches([STAMPED]) });
    const html = await listUntil(base, "not landed", ARCHIVED_VIEW);
    const row = rowFor(html, STAMPED);
    expect(row).not.toContain('class="rowrun"');
    expect(row).toContain("Reopen");
  });

  // The exception the DEFAULT view keeps. "Not archived" is today's
  // reading view unchanged in content (1-description.md), and today it
  // shows this row: a spec archived with its work still on a branch has
  // not finished, and a reading view that dropped it would hide the
  // exact failure spec 193 exists to surface. Its landed siblings are
  // not there, so the archive itself is still not being paid for.
  test("keeps its row on the default view, where its landed siblings have none", async () => {
    const { base } = start({ gitRun: gitWithBranches([STAMPED]) });
    const html = await listUntil(base, "not landed");
    expect(rowFor(html, STAMPED).toLowerCase()).toContain("not landed");
    for (const folder of [UNSTAMPED, SAME_DAY, UNDATED, OTHER]) {
      expect(html).not.toContain(folder);
    }
  });

  test("and the chips still count the whole archive behind it", async () => {
    const { base } = start({ gitRun: gitWithBranches([STAMPED]) });
    const html = await listUntil(base, "not landed");
    // One row built, four keys with no row: the count is still five.
    expect(html).toMatch(/>Archived · 5</);
  });
});

// --- criterion 5: All means all, in ONE order ------------------------------

describe("the All chip", () => {
  test("interleaves live and archived by the same sort key (criterion 5)", async () => {
    const rows = order(await specsList(start().base, ALL_VIEW));
    // Folder number, the list's own default, descending: 150, 92, 81,
    // 60, 31, 05. The live spec sits BETWEEN two archived ones, which a
    // list that concatenated the two sets could not produce.
    expect(rows).toEqual([STAMPED, UNSTAMPED, LIVE, SAME_DAY, UNDATED, OTHER, LIVE_OTHER]);
  });

  test("and its own chip is not the default one", async () => {
    const html = await specsList(start().base, ALL_VIEW);
    expect(html).toMatch(/aria-current="true"[^>]*>All/);
    expect(html).not.toMatch(/aria-current="true"[^>]*>Not archived/);
  });

  // The four chips that were here before this spec each list the states
  // they allow, and none of them lists `archived`.
  test("the four older chips keep their meaning", async () => {
    for (const state of ["not-started", "active", "done", "problem"]) {
      const html = await specsList(start().base, `?state=${state}`);
      for (const folder of Object.keys(ARCHIVED)) expect(html).not.toContain(folder);
    }
  });
});

// --- criterion 6: the search reaches both kinds of row ---------------------

describe("the search field", () => {
  test("is a GET form on the list, so searching needs no script", async () => {
    const html = await specsList(start().base);
    expect(html).toMatch(/<form[^>]*class="specsearch"[^>]*method="get"[^>]*action="\/"/);
    expect(html).toContain('name="q"');
  });

  test("says which three fields it looks in", async () => {
    const html = (await specsList(start().base)).toLowerCase();
    const note = html.slice(html.indexOf('class="specsearch"'), html.indexOf("<table"));
    for (const field of ["folder", "title", "description"]) expect(note).toContain(field);
  });

  test("finds an archived spec under the All chip (criterion 6)", async () => {
    expect(order(await specsList(start().base, `${ALL_VIEW}&q=QUEUE+REMEMBERS`))).toEqual([SAME_DAY]);
  });

  test("matches the folder name", async () => {
    expect(order(await specsList(start().base, `${ALL_VIEW}&q=push-is-branch`))).toEqual([UNSTAMPED]);
  });

  // The whole description, not the two lines the cell shows: the term
  // is in the last sentence of the long one.
  test("matches text the clamped cell cannot show", async () => {
    expect(order(await specsList(start().base, `${ALL_VIEW}&q=${LONG_TAIL}`))).toEqual([UNSTAMPED]);
  });

  test("reaches a live spec too, and cuts the archived ones out", async () => {
    expect(order(await specsList(start().base, `${ALL_VIEW}&q=queue-and-runner`))).toEqual([LIVE]);
  });

  test("keeps the term in the field, so the reader can edit it", async () => {
    expect(await specsList(start().base, `${ALL_VIEW}&q=remembers`)).toContain('value="remembers"');
  });

  test("carries the chip along, so searching does not throw the filter away", async () => {
    const html = await specsList(start().base, ARCHIVED_VIEW);
    const form = html.slice(html.indexOf('class="specsearch"'));
    expect(form.slice(0, form.indexOf("</form>"))).toContain('name="state" value="archived"');
  });

  test("a term with nothing but spaces is no search at all", async () => {
    expect(order(await specsList(start().base, `${ALL_VIEW}&q=++`))).toEqual(
      order(await specsList(start().base, ALL_VIEW)),
    );
  });

  test("a term that matches nothing empties the table and says so", async () => {
    const html = await specsList(start().base, `${ALL_VIEW}&q=zzzznotathing`);
    expect(html).toContain("No spec matches this filter.");
  });
});

// --- spec 226, criteria 4 and 5: one press back to the unfiltered view -----

describe("the search field's clear control", () => {
  /** The form's own markup, so a `×` anywhere else on the page cannot
   *  answer for the one that is supposed to be in the field. */
  const searchForm = (html: string): string => {
    const at = html.indexOf('<form class="specsearch"');
    expect(at).toBeGreaterThan(-1);
    return html.slice(at, html.indexOf("</form>", at));
  };

  test("is a link back to the same view with the term dropped (criterion 4)", async () => {
    const form = searchForm(await specsList(start().base, `${ARCHIVED_VIEW}&q=remembers`));
    expect(form).toContain('class="searchclear"');
    // A link, not script: the same "state lives in the URL" shape the
    // fold and the sort already have, so it works with JavaScript off
    // and can be pasted to someone else.
    expect(form).toMatch(/<a class="searchclear"[^>]*href="\/\?state=archived"/);
  });

  test("keeps every other filter the reader had chosen (criterion 4)", async () => {
    const form = searchForm(
      await specsList(start().base, `${ALL_VIEW}&sort=spec&dir=asc&q=remembers`),
    );
    const href = /<a class="searchclear"[^>]*href="([^"]*)"/.exec(form)?.[1] ?? "";
    expect(href).toContain("state=all");
    expect(href).toContain("sort=spec");
    expect(href).toContain("dir=asc");
    expect(href).not.toContain("q=");
  });

  test("is not in the markup when there is nothing to clear (criterion 5)", async () => {
    expect(searchForm(await specsList(start().base, ARCHIVED_VIEW))).not.toContain("searchclear");
    // Nor for a term that is no search at all.
    expect(searchForm(await specsList(start().base, `${ARCHIVED_VIEW}&q=++`))).not.toContain(
      "searchclear",
    );
  });
});

// --- criteria 7, 8: the Archive tab retires --------------------------------

describe("the Archive tab", () => {
  test("is no longer in the navigation (criterion 7)", async () => {
    const html = await specsList(start().base);
    const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    expect(nav).not.toContain('href="/archive"');
    expect(nav).not.toContain(">Archive<");
  });

  test("and its route is gone (criterion 8)", async () => {
    const { base } = start();
    expect((await fetch(`${base}/archive`, auth)).status).toBe(404);
  });
});

// --- criterion 9: where Reopen lands the reader ----------------------------

describe("pressing Reopen", () => {
  /** The row's own form, submitted the way a browser with no script
   *  would submit it: url-encoded, and no redirect followed. */
  const press = (base: string, fields: Record<string, string>) =>
    fetch(`${base}/api/queue`, {
      method: "POST",
      redirect: "manual",
      headers: { ...auth.headers, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ project: "aide", specFolder: STAMPED, steps: "reopen", ...fields }),
    });

  test("from the list lands back on the list, filter kept (criterion 9)", async () => {
    const { base } = start();
    const res = await press(base, { fromList: "1", "view.state": "archived" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?state=archived");
  });

  test("from the spec's own page still lands there", async () => {
    const { base } = start();
    const res = await press(base, {});
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/specs/aide/${STAMPED}`);
  });

  test("the row's form is the one that carries the mark", async () => {
    const row = rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED);
    expect(row).toContain('name="fromList" value="1"');
  });
});

// --- criterion 10: the default view does not pay for the archive -----------

describe("building the archived rows", () => {
  // Asserted on the CODE, not on the response: a response that happened
  // to be fast, or one whose rows were built and then filtered out,
  // would both pass a test that only read the HTML. The repo does this
  // elsewhere for the same reason — `queue.test.ts` reads two
  // `errorReason` declarations as text and asserts they agree.
  const serveSrc = readFileSync(new URL("../src/serve.ts", import.meta.url), "utf-8");

  test("is asked for by the reader's own chip and by nothing else", () => {
    const calls = [...serveSrc.matchAll(/\barchivedSpecRows\(([^)]*)\)/g)]
      .map((m) => m[1]!)
      // Its own declaration reads the same as a call; it is not one.
      .filter((arg) => !arg.includes(":"));
    expect(calls).toEqual(["chosenState"]);
  });

  test("skips a row before it reads anything for it (criterion 10)", () => {
    const body = serveSrc.slice(serveSrc.indexOf("function archivedSpecRows"));
    const fn = body.slice(0, body.indexOf("\n  }\n"));
    // The gate is the resolved filter's own answer...
    expect(fn).toContain("filterShowsArchived(state)");
    // ...and it stands in front of the per-row file reads, which is what
    // makes it a gate rather than a filter over work already done.
    expect(fn.indexOf("continue;")).toBeLessThan(fn.indexOf("archivedAt(ref.dir)"));
    expect(fn.indexOf("continue;")).toBeLessThan(fn.indexOf("specDurationMs(ref.dir)"));
  });

  test("and the gate answers for every chip there is", async () => {
    const { filterShowsArchived } = await import("../src/render/queue-list.ts");
    expect(filterShowsArchived(undefined)).toBe(false);
    expect(filterShowsArchived("not-archived")).toBe(false);
    expect(filterShowsArchived("all")).toBe(true);
    expect(filterShowsArchived("archived")).toBe(true);
    for (const key of ["not-started", "active", "done", "problem"]) {
      expect(filterShowsArchived(key)).toBe(false);
    }
    // A stale bookmark falls back to the default, which shows none.
    expect(filterShowsArchived("nonsense")).toBe(false);
  });

  test("the rows fragment the live refresh asks for is gated the same way", async () => {
    const { base } = start();
    const rows = await (await fetch(`${base}/?rows=1`, auth)).text();
    for (const folder of Object.keys(ARCHIVED)) expect(rows).not.toContain(folder);
    const archivedRows = await (await fetch(`${base}/?rows=1&state=archived`, auth)).text();
    expect(archivedRows).toContain(STAMPED);
  });
});

// --- spec 226, criterion 1: no view leaves a spec off the page -------------
//
// This block pinned the opposite until spec 226: exactly 25 rows, and a
// line counting the rest. The archived and the combined views exist to
// be browsed and searched with the browser's own find, and find cannot
// reach a row the server never sent.

describe("an archive bigger than the page", () => {
  /** Thirty archived specs. aide alone has about 150 of them. */
  const MANY = Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [
      `${100 + i}-archived-spec`,
      { description: `# Spec ${100 + i} - Description\n`, status: stamp("2026-08-13") },
    ]),
  );

  test("the archived view shows all thirty (criterion 1)", async () => {
    const html = await specsList(start({}, MANY).base, ARCHIVED_VIEW);
    expect(order(html)).toHaveLength(30);
    expect(html).not.toContain("not shown");
  });

  test("and so does a combined view", async () => {
    const html = await specsList(start({}, MANY).base, ALL_VIEW);
    // Thirty archived plus the two live specs.
    expect(order(html)).toHaveLength(32);
    expect(html).not.toContain("not shown");
  });

  // The live-refresh route renders the same fragment, so a cap left in
  // one of the two would have shown as a list that shrank five seconds
  // after it was drawn.
  test("the five-second refresh sends the same thirty", async () => {
    const { base } = start({}, MANY);
    const rows = await (await fetch(`${base}/?rows=1&state=archived`, auth)).text();
    expect(order(rows)).toHaveLength(30);
    expect(rows).not.toContain("not shown");
  });
});
