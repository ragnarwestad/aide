// Spec 163: the archive is on the dashboard.
//
// An archived spec's PAGE has worked since spec 150 — `specDir()`
// resolves an archived folder, and the four files render — but nothing
// on the dashboard linked to one, so the pages existed and could not be
// found. `/archive` is the way in: every archived spec, with the date it
// was archived and a link to the page that already worked.
//
// And the other half: an archived spec is a RECORD. Edit used to be
// offered on its page, and Save would have written, committed and
// pushed into `archive/`. Both routes refuse it now — server-side, not
// only by hiding the button.
//
// Spec 170 turned the listing from a section per project into ONE
// table — Project, Title, Description, Date — that sorts on three of
// those four and filters on a search term. Everything here is a route
// test rather than a renderer test: the change spans discovery, the
// query string, the ordering and the HTML, and only the route puts all
// four together. What no test here can say is whether two clamped lines
// of prose read well, or whether a four-column table really scrolls at
// 390px — that is the Manual testing note in 3-solution.md.

import { afterEach, describe, expect, test } from "bun:test";
import type { GitRunner } from "../src/branch-status.ts";
import { CSS } from "../src/render/css.ts";
import { queueHarness } from "./helpers/queue-server.ts";

const TOKEN = "s3cret-token";
const auth = { headers: { "x-aide-token": TOKEN } };

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

const stamp = (date: string) => `# Status\n\n## Tracking info\n\n- **Archived:** \`${date}\`\n`;
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
    status: stamp("2026-08-13"),
  },
  [UNSTAMPED]: {
    description: described("The push is branch only", `A run pushes a branch. ${LONG}`),
    status: noStamp,
  },
  [SAME_DAY]: {
    description: described("The queue remembers", "Jobs survive a restart."),
    status: stamp("2026-08-13"),
  },
  // No `## Description` section at all: the dash case.
  [UNDATED]: { description: "# A folder copied in - Description\n", status: noStamp },
  [OTHER]: {
    description: described("The other project", "Proof that projects interleave."),
    status: stamp("2026-08-20"),
    project: "skjer",
  },
};

/** Git as the archive listing asks it: the last commit touching a
 *  spec's own folder. Only the unstamped specs reach git — a stamped
 *  one never does — so the runner keys on the directory it is given,
 *  and everything else is a repo git cannot read. */
const gitDated = (dates: Record<string, string>): GitRunner =>
  async (dir, args) => {
    if (!args.join(" ").startsWith("log -1 --format=")) return { code: 1, stdout: "" };
    for (const [folder, at] of Object.entries(dates)) {
      if (dir.includes(folder)) return { code: 0, stdout: `a3f9c21deadbeef\t${at}\n` };
    }
    return { code: 1, stdout: "" };
  };

/** The search form, not the About dialog's close button, which is also
 *  a form and comes first in the shell. */
const SEARCH_FORM = '<form class="row" method="get"';
const searchForm = (html: string): string => {
  const at = html.indexOf(SEARCH_FORM);
  expect(at).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf("</form>", at));
};

const harness = queueHarness("aide-archive-page-");
afterEach(() => harness.cleanup());

const start = (extra: Record<string, unknown> = {}, archivedSpecs = ARCHIVED) =>
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

const archivePage = async (base: string, query = ""): Promise<string> => {
  const res = await fetch(`${base}/archive${query}`, auth);
  expect(res.status).toBe(200);
  return res.text();
};

/** The folders the table lists, in the order it lists them. Read off
 *  the row links rather than off the raw HTML: a folder name also
 *  appears inside a href, and `indexOf` on the bare name would compare
 *  two different things. */
const order = (html: string): string[] =>
  [...html.matchAll(/href="\/specs\/[A-Za-z0-9._-]+\/([A-Za-z0-9._-]+)"/g)].map((m) => m[1]!);

// --- criteria 1, 8: every row carries a date ---------------------------------

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
    const html = await archivePage(start().base);
    expect(html).toContain("date unknown");
  });
});

// --- criterion 1: one table, four columns -----------------------------------

describe("the /archive table", () => {
  test("is one table with exactly Project, Title, Description and Date", async () => {
    const html = await archivePage(start().base);
    const head = html.slice(html.indexOf("<thead"), html.indexOf("</thead>"));
    // The lookahead keeps `<thead>` itself out of the count.
    expect([...head.matchAll(/<th(?=[\s>])[^>]*>/g)]).toHaveLength(4);
    expect(head.indexOf("Project")).toBeLessThan(head.indexOf("Title"));
    expect(head.indexOf("Title")).toBeLessThan(head.indexOf("Description"));
    expect(head.indexOf("Description")).toBeLessThan(head.indexOf("Date"));
    // One table, not one per project: the sections and their jump-links
    // are what this replaced.
    expect([...html.matchAll(/<table/g)]).toHaveLength(1);
    expect(html).not.toContain('href="#project-');
  });

  test("names each spec's project in a cell and links its folder", async () => {
    const html = await archivePage(start().base);
    expect(html).toContain(`href="/specs/aide/${STAMPED}"`);
    expect(html).toContain(`href="/specs/skjer/${OTHER}"`);
    expect(html).toContain("One page shows the whole spec");
    expect(html).toContain("skjer");
  });

  // The listing is the archive and nothing else: a live spec has the
  // spec list, and a row in both places says the spec is in two states.
  test("holds no live spec", async () => {
    const html = await archivePage(start().base);
    expect(html).not.toContain("81-queue-and-runner");
  });

  // Same rule as `targets()`: the allowlist in queue-config.json is
  // what the dashboard shows, and a discovered project that is not on
  // it is not the dashboard's business.
  test("shows only the projects the queue is allowed to run", async () => {
    const html = await archivePage(start({ queueProjects: ["skjer"] }).base);
    expect(html).not.toContain(STAMPED);
    expect(html).toContain(OTHER);
  });

  test("it is a GET, and behind the token like every other spec path", async () => {
    const { base } = start();
    expect((await fetch(`${base}/archive`, { method: "POST", ...auth, redirect: "manual" })).status).toBe(405);
    expect((await fetch(`${base}/archive`)).status).toBe(401);
  });

  // The table has its own width and no way to give it up; the box
  // scrolls instead of the page (spec 155). Whether it actually scrolls
  // at 390px is the manual note — this is the markup contract.
  test("sits inside the scroll box every wide table on this site uses", async () => {
    const html = await archivePage(start().base);
    expect(html).toContain('<div class="tablewrap"><table class="list">');
  });
});

// --- criterion 2: the default order -----------------------------------------

describe("with no query at all", () => {
  test("orders every project's specs together, newest first", async () => {
    const html = await archivePage(start().base);
    // skjer's spec is the newest of the five, so a listing that still
    // grouped by project could not put it first.
    expect(order(html)).toEqual([OTHER, STAMPED, SAME_DAY, UNSTAMPED, UNDATED]);
  });

  test("breaks an equal date by folder number, and puts the undated last", async () => {
    const rows = order(await archivePage(start().base));
    // 150 and 60 share 2026-08-13.
    expect(rows.indexOf(STAMPED)).toBeLessThan(rows.indexOf(SAME_DAY));
    expect(rows[rows.length - 1]).toBe(UNDATED);
  });
});

// --- criteria 3, 4, 9: the sort controls ------------------------------------

describe("the sortable headings", () => {
  const heading = (html: string, label: string): string => {
    const head = html.slice(html.indexOf("<thead"), html.indexOf("</thead>"));
    const cells = [...head.matchAll(/<th(?=[\s>])[^>]*>.*?<\/th>/gs)].map((m) => m[0]);
    return cells.find((c) => c.includes(label))!;
  };

  test("are ordinary links, so sorting needs no script", async () => {
    const html = await archivePage(start().base);
    for (const label of ["Project", "Title", "Date"]) {
      expect(heading(html, label)).toContain('<a class="sortlink');
    }
    expect(heading(html, "Project")).toContain('href="/archive?sort=project"');
  });

  test("Description carries none: prose sorts to nothing useful", async () => {
    expect(heading(await archivePage(start().base), "Description")).not.toContain("<a ");
  });

  test("sort by project puts the projects in name order", async () => {
    const rows = order(await archivePage(start().base, "?sort=project"));
    expect(rows[rows.length - 1]).toBe(OTHER);
    expect(rows.indexOf(STAMPED)).toBeLessThan(rows.indexOf(OTHER));
  });

  test("sort by title reads the human title, not the folder", async () => {
    const rows = order(await archivePage(start().base, "?sort=title"));
    // "A folder copied in" before "Every ..." — by folder number, 31
    // would not be first among these five either way, so the title is
    // the only thing that can put it there.
    expect(rows[0]).toBe(UNDATED);
    expect(rows.indexOf(UNDATED)).toBeLessThan(rows.indexOf(STAMPED));
  });

  test("the active heading says so, and its link turns the sort round", async () => {
    const html = await archivePage(start().base, "?sort=project");
    const th = heading(html, "Project");
    expect(th).toContain('aria-sort="ascending"');
    expect(th).toContain('href="/archive?sort=project&amp;dir=desc"');
    // And an inactive one does not claim the state.
    expect(heading(html, "Date")).not.toContain("aria-sort");
  });

  test("reversing a column really reverses it", async () => {
    const asc = order(await archivePage(start().base, "?sort=project&dir=asc"));
    const desc = order(await archivePage(start().base, "?sort=project&dir=desc"));
    expect(desc).toEqual([...asc].reverse());
  });

  test("a date sorted the other way puts the oldest first, undated still last", async () => {
    const rows = order(await archivePage(start().base, "?sort=date&dir=asc"));
    expect(rows[0]).toBe(UNSTAMPED);
    expect(rows[rows.length - 1]).toBe(UNDATED);
  });

  test("a sort nobody offers is the default rather than an error", async () => {
    const odd = await archivePage(start().base, "?sort=colour&dir=sideways");
    expect(order(odd)).toEqual(order(await archivePage(start().base)));
  });
});

// --- criteria 5, 9: the search field ----------------------------------------

describe("the search field", () => {
  test("is a GET form, so searching needs no script either", async () => {
    const html = await archivePage(start().base);
    expect(html).toMatch(/<form[^>]*method="get"[^>]*action="\/archive"/);
    expect(html).toContain('name="q"');
  });

  test("says which three fields it looks in", async () => {
    const html = (await archivePage(start().base)).toLowerCase();
    const note = html.slice(html.indexOf(SEARCH_FORM), html.indexOf("<table"));
    for (const field of ["folder", "title", "description"]) expect(note).toContain(field);
  });

  test("matches the title whatever the case", async () => {
    expect(order(await archivePage(start().base, "?q=QUEUE+REMEMBERS"))).toEqual([SAME_DAY]);
  });

  test("matches the folder name", async () => {
    expect(order(await archivePage(start().base, "?q=push-is-branch"))).toEqual([UNSTAMPED]);
  });

  // The whole description, not the two lines the cell shows: the term
  // is in the last sentence of the long one.
  test("matches text the clamped cell cannot show", async () => {
    expect(order(await archivePage(start().base, `?q=${LONG_TAIL}`))).toEqual([UNSTAMPED]);
  });

  test("keeps the term in the field, so the reader can edit it", async () => {
    expect(await archivePage(start().base, "?q=remembers")).toContain('value="remembers"');
  });

  test("a term with nothing but spaces is no search at all", async () => {
    expect(order(await archivePage(start().base, "?q=++"))).toEqual(order(await archivePage(start().base)));
  });
});

// --- criterion 6: the two controls do not clear each other -------------------

describe("search and sort", () => {
  test("a heading link carries the search along", async () => {
    const html = await archivePage(start().base, "?q=the");
    expect(html).toContain('href="/archive?q=the&amp;sort=project"');
  });

  test("the form carries the sort along", async () => {
    const html = await archivePage(start().base, "?sort=title&dir=desc");
    const form = searchForm(html);
    expect(form).toContain('name="sort" value="title"');
    expect(form).toContain('name="dir" value="desc"');
  });

  test("both at once cut the rows AND order what is left", async () => {
    const rows = order(await archivePage(start().base, "?q=the&sort=title&dir=desc"));
    // The cut: only 31 has "the" in neither its folder, its title nor
    // its description. The order: titles from Z, which is neither the
    // default order nor the folder order.
    expect(rows).toEqual([SAME_DAY, UNSTAMPED, OTHER, STAMPED]);
  });
});

// --- criterion 7: the description cell --------------------------------------

describe("the description cell", () => {
  test("holds the whole description, not an excerpt the server cut", async () => {
    const html = await archivePage(start().base);
    expect(html).toContain(LONG_TAIL);
  });

  test("carries the hook the two-line clamp selects on", async () => {
    expect(await archivePage(start().base)).toContain('class="archive-desc"');
  });

  test("that hook is a real rule: two lines and a bounded width", async () => {
    const rule = CSS.slice(CSS.indexOf(".archive-desc {"));
    expect(rule.slice(0, rule.indexOf("}"))).toMatch(/line-clamp:\s*2/);
    expect(rule.slice(0, rule.indexOf("}"))).toMatch(/max-width:/);
  });

  test("a spec with no description says so with a dash", async () => {
    const html = await archivePage(start().base);
    const row = html.slice(html.indexOf(UNDATED));
    expect(row.slice(0, row.indexOf("</tr>"))).toContain("—");
  });
});

// --- criterion 8: the two empty states are different -------------------------

describe("when the table has no rows", () => {
  test("an archive with nothing in it says nothing has been archived", async () => {
    const html = await archivePage(harness.start({
      alsoProjects: ["skjer"],
      extra: { queueToken: TOKEN, queueProjects: ["aide", "skjer"], gitRun: gitDated({}) },
    }).base);
    expect(html.toLowerCase()).toContain("nothing has been archived");
  });

  test("a search that matches nothing says THAT instead", async () => {
    const html = (await archivePage(start().base, "?q=zzzznotathing")).toLowerCase();
    expect(html).toContain("no archived spec matches");
    expect(html).not.toContain("nothing has been archived");
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
