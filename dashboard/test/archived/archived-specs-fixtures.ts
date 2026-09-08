// Shared test data for the archived-specs suite, split by theme across
// archived-specs-filters.test.ts, archived-specs-row.test.ts,
// archived-specs-row-opened.test.ts,
// archived-specs-reopen-and-landing.test.ts, archived-specs-search.test.ts
// and archived-specs-misc.test.ts (split out of archived-specs.test.ts).
//
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

import { expect } from "bun:test";
import type { GitRunner } from "../../src/git/branch-status.ts";
import { queueHarness } from "../helpers/queue-server.ts";

export const TOKEN = "s3cret-token";
export const auth = { headers: { "x-aide-token": TOKEN } };

/** The one LIVE spec every harness starts with. */
export const LIVE = "81-queue-and-runner";
/** And the live spec `alsoProjects` gives the second project. Named
 *  because the combined view has to order it with the rest. */
export const LIVE_OTHER = "01-first";

export const STAMPED = "150-one-page-shows-the-whole-spec";
export const UNSTAMPED = "92-the-push-is-branch-only";
/** Same stamped date as STAMPED, lower number: what the folder-number
 *  tie-break is for. */
export const SAME_DAY = "60-the-queue-remembers";
/** No stamp, and a git runner that cannot date it either. */
export const UNDATED = "31-a-folder-copied-in";
/** In another project, and archived later than anything in `aide` — so
 *  the two projects have to interleave for it to come out on top. */
export const OTHER = "05-the-other-project";

/** `steps` is spec 224's addition: an archived row's phase lines say
 *  what this line claims, and nothing else — the git-verified answer a
 *  live row shows is never warmed for an archived spec
 *  (`refreshSpecCaches`), so the file's own claim is the only source
 *  such a row can afford. Absent writes no line at all, which is the
 *  empty-done case.
 *
 *  `models` is spec 244's addition: `aide-run-spec` has written one
 *  `- **Model (<step>):**` line per completed step since spec 217, and
 *  this is where a fixture can say a step recorded one. Absent from the
 *  map writes no line for that step, exactly as `steps` absent writes
 *  none for `done`.
 *
 *  Spec 273 dropped the `ms` parameter this used to take: the archive
 *  no longer writes a `Time spent (ms):` bullet at all, so a fixture
 *  wanting a duration on the row gives `analysis: outcome({ timeSpent:
 *  ... })` instead — the per-phase file `readerGroup()` actually sums. */
export const stamp = (date: string, steps?: string[], models?: Record<string, string>) =>
  `# Status\n\n## Tracking info\n\n` +
  (steps === undefined ? "" : `- **Workflow steps completed:** ${steps.join(", ")}\n`) +
  Object.entries(models ?? {})
    .map(([step, value]) => `- **Model (${step}):** ${value}\n`)
    .join("") +
  `- **Archived:** \`${date}\`\n`;

/** What STAMPED's own `4-status.md` claims it has had, and therefore
 *  what its phase lines have to say. The two it does NOT name are the
 *  other half of the same assertion. */
export const STAMPED_STEPS = ["create", "analyze"];
export const STAMPED_NOT_RUN = ["implement", "archive"];
/** What STAMPED's `4-status.md` records analyze ran on (spec 244) — the
 *  one step this fixture gives a `Model (<step>):` line, so the other
 *  three lines have the configured default to show instead (spec 265).
 *  Bare "sonnet" so the recorded value lands on a real, configured
 *  choice — `phaseSubRows` splits the "<tool> " prefix off before either
 *  picker ever sees the rest. */
export const STAMPED_MODEL = "claude sonnet";
export const noStamp = "# Status\n\n## Tracking info\n\n- **Workflow steps completed:** create\n";

/** One phase's own outcome record (spec 245's write format — spec 247's
 *  read side): a Tracking-info block inside that phase's OWN file, never
 *  `4-status.md`. Only the lines a fixture actually wants, mirroring how
 *  `stamp()` above only writes what it is given. */
export const outcome = (opts: { model?: string; timeSpent?: string; cost?: string; tokens?: string } = {}) =>
  `# Analysis\n\n## Tracking info\n\n` +
  (opts.model ? `- **Model:** ${opts.model}\n` : "") +
  `- **Result:** completed\n` +
  (opts.timeSpent ? `- **Time spent:** ${opts.timeSpent}\n` : "") +
  (opts.cost ? `- **Cost:** ${opts.cost}\n` : "") +
  (opts.tokens ? `- **Tokens:** ${opts.tokens}\n` : "");

/** What STAMPED's `2-analysis.md` records the analyze phase spent (spec
 *  247) — `durationLabel`'s own formatting of this is what the phase
 *  subrow's Time cell has to show. */
/** What the phase file records — the writer's own `NNmNNs` shape. */
export const STAMPED_TIME_SPENT = "5m32s";
/** And what a row draws it as: the two parts stand apart since
 *  2026-09-08, so a reader is not asked to break "5m32s" up first. */
export const STAMPED_TIME_SHOWN = "5m 32s";
export const STAMPED_COST = "$1.5000";
/** `money()`'s own two-decimal rendering of `STAMPED_COST` — the text
 *  the cost cell actually shows, never the raw four-decimal figure the
 *  file spells it as. */
export const STAMPED_COST_LABEL = "$1.50";

export const described = (title: string, prose: string) =>
  `# ${title} - Description\n\n## Description\n\n${prose}\n`;

/** The long one: what the two-line clamp exists for, and what proves
 *  that search reaches text the cell cannot show. */
export const LONG_TAIL = "wolverine";
export const LONG =
  "The archive is a record and a record only grows. " +
  "A page that was fine at six specs is a wall of prose at eighty, " +
  "which is why the description column is bounded rather than left to " +
  `the browser, and why the ${LONG_TAIL} at the end of this paragraph ` +
  "is still findable by searching even though nobody will ever see it.";

export const ARCHIVED = {
  [STAMPED]: {
    description: described("One page shows the whole spec", "Every spec file on one page."),
    // Two of the four steps, deliberately: the phase-line tests need one
    // row that says "this happened" and "this did not" at the same time.
    // One `Model (<step>):` line, on the same terms: analyze has one, the
    // other three do not, so the locked-model tests have a line each way.
    status: stamp("2026-08-13", STAMPED_STEPS, { analyze: STAMPED_MODEL }),
    // Spec 247: analyze's own phase-outcome record — Time spent and Cost,
    // deliberately no `Model` line here so the OLD-format one above stays
    // the only source for the locked-model tests below (criterion 6 stays
    // a regression check, not a merge). `implement`'s `3-solution.md` is
    // left unwritten, which is what gives criterion 2 (a phase that never
    // recorded one) something to be blank beside.
    analysis: outcome({ timeSpent: STAMPED_TIME_SPENT, cost: STAMPED_COST }),
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

/** Git as the archived rows ask it: the last commit touching a spec's
 *  own folder. Only the unstamped specs reach git — a stamped one never
 *  does — so the runner keys on the directory it is given, and
 *  everything else is a repo git cannot read. */
export const gitDated = (dates: Record<string, string>): GitRunner =>
  async (dir, args) => {
    if (!args.join(" ").startsWith("log -1 --format=")) return { code: 1, stdout: "" };
    for (const [folder, at] of Object.entries(dates)) {
      if (dir.includes(folder)) return { code: 0, stdout: `a3f9c21deadbeef\t${at}\n` };
    }
    return { code: 1, stdout: "" };
  };

export const harness = queueHarness("aide-archived-specs-");

export type ArchivedFixture = Record<
  string,
  { description?: string; status?: string; project?: string; analysis?: string; solution?: string }
>;

export const start = (extra: Record<string, unknown> = {}, archivedSpecs: ArchivedFixture = ARCHIVED) =>
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
export const specsList = async (base: string, query = ""): Promise<string> => {
  const res = await fetch(`${base}/${query}`, auth);
  expect(res.status).toBe(200);
  return res.text();
};

export const ARCHIVED_VIEW = "?state=archived";
export const ALL_VIEW = "?state=all";

/** The folders the table lists, in the order it lists them. Read off
 *  the row links rather than off the raw HTML: a folder name also
 *  appears inside a href, and `indexOf` on the bare name would compare
 *  two different things. A job's own page is `/specs/<id>` — one
 *  segment — so the two-segment shape here is the SPEC link and nothing
 *  else. */
export const order = (html: string): string[] =>
  [...html.matchAll(/href="\/specs\/[A-Za-z0-9._-]+\/([A-Za-z0-9._-]+)"/g)].map((m) => m[1]!);

/** One spec's whole row. Read per row, because a mark appearing
 *  anywhere on the page says nothing about WHICH spec it belongs to. */
export const rowFor = (html: string, folder: string): string => {
  const rows = html.split('<tr class="spechead').filter((r) => r.includes(`/${folder}"`));
  expect(rows.length).toBe(1);
  return rows[0]!.slice(0, rows[0]!.indexOf("</tr>"));
};

/** One spec's row AND everything drawn under it: its notice panel and,
 *  on an open row, its phase lines. `rowFor` above stops at the head
 *  row's own `</tr>`; this one runs to the next spec's head row, which
 *  is what the phase-line assertions need (spec 224). */
export const blockFor = (html: string, folder: string): string => {
  // On the head row's own `data-folder`, not on a link anywhere in it:
  // an OPEN row puts its key in every other row's fold href, so a search
  // for the folder name across the whole block finds all of them.
  const blocks = html
    .split('<tr class="spechead')
    .filter((r) => r.slice(0, r.indexOf(">")).includes(`data-folder="${folder}"`));
  expect(blocks.length).toBe(1);
  return blocks[0]!;
};

/** The phase lines alone, one per step, keyed by the step they name. */
export const phaseLines = (html: string, folder: string): Record<string, string> => {
  const lines: Record<string, string> = {};
  for (const m of blockFor(html, folder).matchAll(
    /<tr class="subrow" data-step="([^"]+)">([\s\S]*?)<\/tr>/g,
  )) {
    lines[m[1]!] = m[2]!;
  }
  return lines;
};

/** The row opened, the way the fold chevron opens it: the state is in
 *  the query string, so the server knows before it draws. */
export const opened = (folder: string, project = "aide"): string => `&open=${project}/${folder}`;

/** Every model the list may offer, so the "nothing on this row takes a
 *  choice" assertions have something that WOULD have been drawn. Two
 *  tools, because `aiPicker` draws nothing at all below two. */
export const TWO_TOOLS = {
  budgetUsd: 5,
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
  modelChoices: {
    sonnet: { budgetUsd: 3 },
    "codex-fast": { budgetUsd: 5, tool: "codex" },
  },
};

/** `TWO_TOOLS`, with one more choice named — for a fixture whose recorded
 *  model has to land as a KNOWN choice rather than the synthetic,
 *  no-longer-configured one `modelOptions` draws for anything else
 *  (spec 265). */
export const modelChoicesWith = (extra: Record<string, { budgetUsd: number; tool?: string }>) => ({
  ...TWO_TOOLS,
  modelChoices: { ...TWO_TOOLS.modelChoices, ...extra },
});

/** Spec 208 moved WHEN origin is asked: the render reads whatever a
 *  background schedule last found, so the page is polled until the
 *  first tick has landed rather than assumed to have made the call
 *  itself. The same bounded loop `projects-route.test.ts` uses. */
/** Poll the archived list until `text` shows, and THROW when it never
 *  does — see `queue-routes/fixtures.ts`'s twin for what returning the
 *  last page instead cost on 2026-09-05: a wait that gave up silently,
 *  and an assertion blamed for it. */
export const listUntil = async (base: string, text: string, query = "", budgetMs = 10_000): Promise<string> => {
  const deadline = Date.now() + budgetMs;
  let html = "";
  for (;;) {
    html = await specsList(base, query);
    if (html.toLowerCase().includes(text.toLowerCase())) return html;
    if (Date.now() > deadline) {
      throw new Error(`the archived list never showed "${text}" within ${budgetMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
};
