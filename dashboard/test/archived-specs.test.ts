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
 *  blank-cell case 1-description.md names by hand.
 *
 *  `steps` is spec 224's addition: an archived row's phase lines say
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
 *  none for `done`. */
const stamp = (date: string, ms?: number, steps?: string[], models?: Record<string, string>) =>
  `# Status\n\n## Tracking info\n\n` +
  (steps === undefined ? "" : `- **Workflow steps completed:** ${steps.join(", ")}\n`) +
  Object.entries(models ?? {})
    .map(([step, value]) => `- **Model (${step}):** ${value}\n`)
    .join("") +
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
/** What STAMPED's own `4-status.md` claims it has had, and therefore
 *  what its phase lines have to say. The two it does NOT name are the
 *  other half of the same assertion. */
const STAMPED_STEPS = ["create", "analyze"];
const STAMPED_NOT_RUN = ["implement", "archive"];
/** What STAMPED's `4-status.md` records analyze ran on (spec 244) — the
 *  one step this fixture gives a `Model (<step>):` line, so the other
 *  three lines have something to be blank BESIDE. */
const STAMPED_MODEL = "claude claude-sonnet-5";
const noStamp = "# Status\n\n## Tracking info\n\n- **Workflow steps completed:** create\n";

/** One phase's own outcome record (spec 245's write format — spec 247's
 *  read side): a Tracking-info block inside that phase's OWN file, never
 *  `4-status.md`. Only the lines a fixture actually wants, mirroring how
 *  `stamp()` above only writes what it is given. */
const outcome = (opts: { model?: string; timeSpent?: string; cost?: string } = {}) =>
  `# Analysis\n\n## Tracking info\n\n` +
  (opts.model ? `- **Model:** ${opts.model}\n` : "") +
  `- **Result:** completed\n` +
  (opts.timeSpent ? `- **Time spent:** ${opts.timeSpent}\n` : "") +
  (opts.cost ? `- **Cost:** ${opts.cost}\n` : "");

/** What STAMPED's `2-analysis.md` records the analyze phase spent (spec
 *  247) — `durationLabel`'s own formatting of this is what the phase
 *  subrow's Time cell has to show. */
const STAMPED_TIME_SPENT = "5m32s";
const STAMPED_COST = "$1.5000";
/** `money()`'s own two-decimal rendering of `STAMPED_COST` — the text
 *  the cost cell actually shows, never the raw four-decimal figure the
 *  file spells it as. */
const STAMPED_COST_LABEL = "$1.50";

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
    // Two of the four steps, deliberately: the phase-line tests need one
    // row that says "this happened" and "this did not" at the same time.
    // One `Model (<step>):` line, on the same terms: analyze has one, the
    // other three do not, so the locked-model tests have a line each way.
    status: stamp("2026-08-13", STAMPED_MS, STAMPED_STEPS, { analyze: STAMPED_MODEL }),
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

type ArchivedFixture = Record<
  string,
  { description?: string; status?: string; project?: string; analysis?: string; solution?: string }
>;

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

/** One spec's row AND everything drawn under it: its notice panel and,
 *  on an open row, its phase lines. `rowFor` above stops at the head
 *  row's own `</tr>`; this one runs to the next spec's head row, which
 *  is what the phase-line assertions need (spec 224). */
const blockFor = (html: string, folder: string): string => {
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
const phaseLines = (html: string, folder: string): Record<string, string> => {
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
const opened = (folder: string, project = "aide"): string => `&open=${project}/${folder}`;

/** Every model the list may offer, so the "nothing on this row takes a
 *  choice" assertions have something that WOULD have been drawn. Two
 *  tools, because `aiPicker` draws nothing at all below two. */
const TWO_TOOLS = {
  budgetUsd: 5,
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
  modelChoices: {
    sonnet: { budgetUsd: 3 },
    "codex-fast": { budgetUsd: 5, tool: "codex" },
  },
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
    expect(html).toContain(">Active");
    expect(html).toMatch(/aria-current="true"[^>]*>Active/);
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
    // reading "Archived (0)" beside a list that has 150 of them is the
    // one thing a count must not say.
    expect(html).toMatch(/>Archived \(5\)</);
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
    const html = await specsList(start({ queueDefaults: TWO_TOOLS }).base, ARCHIVED_VIEW);
    const row = rowFor(html, STAMPED);
    expect(row).not.toContain("<select");
    expect(row).not.toContain('type="checkbox"');
    // The Run form is a carrier with an id of its own; a reader row must
    // not carry one, nor the button that submits it.
    expect(row).not.toContain('class="rowrun"');
    expect(row).not.toContain("starting…");
  });

  // Spec 224 turned this line round. It read `not.toContain('class="fold')`
  // until then, on the grounds that a reader row had nothing under it to
  // open — and that was the whole of what made it a second kind of row.
  test("has the fold chevron every other row has (spec 224)", async () => {
    expect(rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED)).toContain('class="fold');
  });

  test("carries the pip strip beside its name, like every other row", async () => {
    expect(rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED)).toContain(
      '<span class="pipslot">',
    );
  });

  // Criterion 7. `stateAction`'s ordinary branches name the phase a
  // press would run; a locked row's one action is Reopen, open or shut.
  test("offers no Analyze, Implement or Archive button, open or shut", async () => {
    for (const query of [ARCHIVED_VIEW, `${ARCHIVED_VIEW}${opened(STAMPED)}`]) {
      const block = blockFor(await specsList(start().base, query), STAMPED);
      for (const label of ["Analyze", "Implement", "Archive"]) {
        expect(block).not.toContain(`>${label}</button>`);
      }
      expect(block).toContain(">Reopen</button>");
    }
  });

  test("says what it is, in the column that says what every row is", async () => {
    expect(rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED)).toContain(">archived<");
  });

  // Spec 224. `nextPhase` deletes `archive` from the done-set before it
  // looks for what is missing — deliberately, for a row that is still on
  // this list — so a FINISHED spec routed through it resolves to
  // "archive" and its badge would read "ready". Ready for the step it
  // has already had.
  test("its badge never says the spec is ready for anything", async () => {
    const row = rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED);
    expect(row).not.toContain(">ready<");
  });

  // `startedCell` reads `g.createdAt`, which an archived row has none
  // of: routed through it unmodified the cell would be a bare dash.
  test("its date and duration are in the column every row's date is in", async () => {
    const row = rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED);
    const cell = row.slice(row.indexOf('data-col="started"'));
    const body = cell.slice(0, cell.indexOf("</td>"));
    expect(body).toContain("2026-08-13");
    expect(body).toContain("1h15m");
    // The duration is the figure worth leading with (spec 257) — the
    // archive date is secondary, muted context beside it.
    expect(body.indexOf("1h15m")).toBeLessThan(body.indexOf("2026-08-13"));
  });

  test("the column header reads Time, not Started (spec 257)", async () => {
    const html = await specsList(start().base, ARCHIVED_VIEW);
    const start_ = html.indexOf('<th class="" data-col="started"');
    const th = html.slice(start_, html.indexOf("</th>", start_));
    expect(th).toContain(">Time<");
    expect(th).not.toContain("Started");
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

  // Spec 257: the head row's own Cost cell hardcoded `spentUsd: 0` even
  // though each phase's own real cost was already available — summed
  // here off the same phases that already carry it (the analyze phase
  // is STAMPED's only one with a recorded cost).
  test("carries the sum of its phases' recorded costs in the head row's Cost cell", async () => {
    const row = rowFor(await specsList(start().base, ARCHIVED_VIEW), STAMPED);
    const cell = row.slice(row.indexOf('data-col="cost"'));
    expect(cell.slice(0, cell.indexOf("</td>"))).toContain(STAMPED_COST_LABEL);
  });

  // Spec 257: the description no longer shows under the title at all —
  // recorded or not, long or short. It stays SEARCHABLE (see the search
  // tests below), only the on-page display goes.
  test("shows no description text under the title, recorded or not", async () => {
    const withDescription = rowFor(await specsList(start().base, ARCHIVED_VIEW), UNSTAMPED);
    expect(withDescription).not.toContain("archive-desc");
    expect(withDescription).not.toContain(LONG_TAIL);
  });

  test("shows no dash placeholder either, for a spec with no description", async () => {
    const withoutDescription = rowFor(await specsList(start().base, ARCHIVED_VIEW), UNDATED);
    expect(withoutDescription).not.toContain("archive-desc");
    expect(withoutDescription).not.toContain("—");
  });
});

// --- spec 224: the same row, opened ----------------------------------------
//
// The row is the ordinary one with a lock on it, so opening it does
// what opening any other row does: phase lines, in the workflow's own
// order, saying what happened. What it must NOT do is offer a press —
// every step but `reopen` is refused server-side for an archived spec
// (`ARCHIVE_ONLY_STEP`), and a control that would be refused is a
// control that should not be drawn.

describe("an archived spec's row, opened", () => {
  const openList = (query = "") =>
    specsList(start({ queueDefaults: TWO_TOOLS }).base, `${ARCHIVED_VIEW}${opened(STAMPED)}${query}`);

  test("shows a line for every phase, in the workflow's own order", async () => {
    const steps = Object.keys(phaseLines(await openList(), STAMPED));
    expect(steps).toEqual(["create", "analyze", "implement", "archive"]);
  });

  // The file's own claim, and only that: `refreshSpecCaches` never warms
  // the git-verified answer for an archived spec, so there is no second
  // source for such a row to read.
  test("each line says what 4-status.md's own line claims happened", async () => {
    const lines = phaseLines(await openList(), STAMPED);
    for (const step of STAMPED_STEPS) expect(lines[step]).toContain(">done<");
    for (const step of STAMPED_NOT_RUN) {
      expect(lines[step]).not.toContain(">done<");
      expect(lines[step]).toContain("not run yet");
    }
  });

  // `preTicked` answers "what would a press run next", which for a
  // finished spec is always `{archive}` alone — so routed through it a
  // locked row would tick the one step it did not have and leave the two
  // it did unticked. No press is offered, so the box says what happened.
  test("each box is ticked by what happened, not by what a press would run", async () => {
    const lines = phaseLines(await openList(), STAMPED);
    for (const step of STAMPED_STEPS) expect(lines[step]).toContain(" checked");
    for (const step of STAMPED_NOT_RUN) expect(lines[step]).not.toContain(" checked");
  });

  test("no box can be ticked, and none would post a step if it were", async () => {
    const lines = phaseLines(await openList(), STAMPED);
    // A loop over nothing passes: the row has to HAVE its four lines
    // before "none of them takes a tick" says anything at all.
    expect(Object.keys(lines)).toHaveLength(4);
    for (const [step, line] of Object.entries(lines)) {
      const box = line.slice(line.indexOf(`data-phase="${step}"`));
      expect(box.slice(0, box.indexOf("</label>"))).toContain(" disabled");
      expect(box.slice(0, box.indexOf("</label>"))).not.toContain('name="steps"');
    }
  });

  // Criterion 5: the interactive picker is a CHOICE about a run still
  // ahead, and a locked phase's run already happened — so no caption
  // over the model cell, whether or not that phase recorded a model.
  // The cell itself (spec 257) now draws a real, but LOCKED, control for
  // a step that recorded one — see the two tests below.
  test("offers no caption over the model cell on any line (criterion 5)", async () => {
    const block = blockFor(await openList(), STAMPED);
    expect(block).toContain('data-step="analyze"');
    expect(block).not.toContain('data-cap="model"');
    expect(block).not.toContain('data-cap="ai"');
  });

  test("offers no select at all for a step that recorded no model (criterion 5, spec 257)", async () => {
    const lines = phaseLines(await openList(), STAMPED);
    for (const step of STAMPED_NOT_RUN) {
      expect(lines[step]).not.toContain("<select");
    }
  });

  // The live Specs page always draws a real select/model-choice control;
  // an archived phase line must look the same, but LOCKED — disabled,
  // pre-filled with only the model the phase's own record names, never
  // the currently configured default.
  test("shows exactly one disabled, one-option select for a step that recorded a model (criterion 5, spec 257)", async () => {
    const lines = phaseLines(await openList(), STAMPED);
    const line = lines["analyze"]!;
    expect([...line.matchAll(/<select\b/g)]).toHaveLength(1);
    expect([...line.matchAll(/<option\b/g)]).toHaveLength(1);
    expect(line).toContain(" disabled");
    expect(line).toContain(STAMPED_MODEL);
  });

  // Criterion 4: what a phase ran ON is not in the queue's job history —
  // capped at two hundred jobs against an archive of about 150 specs —
  // but it IS in `4-status.md`'s own `Model (<step>):` line, and this is
  // the fixture's one recorded step.
  test("shows the locked text for a step that recorded a model (criterion 4)", async () => {
    const lines = phaseLines(await openList(), STAMPED);
    expect(lines["analyze"]).toContain(STAMPED_MODEL);
  });

  // The other three lines have no such line in `4-status.md` — nobody
  // having recorded it is not the same as having asked and failed, so
  // this draws no locked-model span at all (the same rule
  // `archiveDateCell`'s duration mark already keeps: blank, not a
  // dash).
  test("draws no locked-model span for a step that recorded no model (criterion 4)", async () => {
    const lines = phaseLines(await openList(), STAMPED);
    for (const step of STAMPED_NOT_RUN) {
      expect(lines[step]).not.toContain("lockedmodel");
    }
  });

  // Spec 247: the sibling gap Model's own fix (spec 244) left open —
  // `2-analysis.md`'s own Tracking info is the analyze phase's only
  // source for what it cost in time and money, and the fixture gives it
  // one (spec 247, criteria 1 and 3).
  test("shows the locked time and cost for a step that recorded them (spec 247, criteria 1, 3)", async () => {
    const lines = phaseLines(await openList(), STAMPED);
    const line = lines["analyze"]!;
    expect(line).toContain(STAMPED_TIME_SPENT);
    // Dollar-formatted, through the same `costCell()` a live row uses —
    // never the "est." mark this cost was not flagged with.
    const cell = line.slice(line.indexOf('data-col="cost"'));
    expect(cell.slice(0, cell.indexOf("</td>"))).toContain(STAMPED_COST_LABEL);
    expect(line).not.toContain("est.");
  });

  // The three steps that recorded neither (spec 247, criteria 2, 5) —
  // `create` has a file but no Tracking-info outcome block, `implement`
  // and `archive` have no phase file at all in this fixture. Nobody
  // having recorded a figure is not the same as having asked and failed,
  // so the cell stays empty, never a dash and never `0m00s`/`$0.00`.
  test("draws no time or cost for a step that recorded neither (spec 247, criteria 2, 5)", async () => {
    const lines = phaseLines(await openList(), STAMPED);
    for (const step of ["create", ...STAMPED_NOT_RUN]) {
      const line = lines[step]!;
      expect(line).toContain('<td data-col="started"></td>');
      expect(line).toContain('<td class="num" data-col="cost"></td>');
    }
  });

  // Spec 247, criterion 4: the same "est." mark a live row's own
  // unmeasured cost already carries, now on a locked phase's cost too.
  // Its own fixture, so the plain-cost assertion above stays a
  // single-value check rather than one cost doing double duty.
  test("carries the est. mark for a cost recorded as unmeasured (spec 247, criterion 4)", async () => {
    const folder = "155-a-locked-unmeasured-cost";
    const { base } = start({}, {
      [folder]: {
        description: described("A locked unmeasured cost", "One archived spec, one recorded cost."),
        status: stamp("2026-08-15", 60_000, ["create", "analyze"]),
        analysis: outcome({ cost: `${STAMPED_COST} (unmeasured)` }),
      },
    });
    const lines = phaseLines(await specsList(base, `${ARCHIVED_VIEW}${opened(folder)}`), folder);
    const line = lines["analyze"]!;
    expect(line).toContain("est.");
    expect(line).toContain(STAMPED_COST_LABEL);
  });

  // Spec 247, criterion 7: the OLD `4-status.md` `Model (<step>):` line
  // and the NEW per-phase-file `Model:` line never both exist for the
  // same real archive (`2-analysis.md`'s own "Findings"), but the merge
  // order still has to be deterministic — the new value wins.
  test("prefers the new-format model over the old when a fixture carries both (spec 247, criterion 7)", async () => {
    const folder = "156-a-locked-model-merge";
    const oldModel = "claude claude-sonnet-5";
    const newModel = "claude claude-opus-5";
    const { base } = start({}, {
      [folder]: {
        description: described("A locked model merge", "One archived spec, two model records."),
        status: stamp("2026-08-16", 60_000, ["create", "analyze"], { analyze: oldModel }),
        analysis: outcome({ model: newModel }),
      },
    });
    const lines = phaseLines(await specsList(base, `${ARCHIVED_VIEW}${opened(folder)}`), folder);
    expect(lines["analyze"]).toContain(newModel);
    expect(lines["analyze"]).not.toContain(oldModel);
  });

  test("still carries no Run form when open (criterion 4)", async () => {
    const block = blockFor(await openList(), STAMPED);
    expect(block).toContain('data-step="analyze"');
    expect(block).not.toContain('class="rowrun"');
  });

  // A live row is not touched by any of this (criterion 8). Opened the
  // same way, in the same table, it keeps its selects and its tickable
  // boxes.
  test("a live spec opened beside it keeps every control it had", async () => {
    const html = await specsList(
      start({ queueDefaults: TWO_TOOLS }).base,
      `${ALL_VIEW}${opened(LIVE)}`,
    );
    const block = blockFor(html, LIVE);
    expect(block).toContain("<select");
    expect(block).toContain('name="steps"');
    expect(block).toContain('class="rowrun"');
  });
});

// --- spec 224: a Reopen the server turns down --------------------------------

describe("a failed Reopen", () => {
  // The old flat row bypassed `specNoticeRow` altogether, so a refusal
  // had nowhere on the list to be read. Routed through the shared row
  // body, an archived row gets the panel every other row has.
  test("says why, on the row it was pressed on", async () => {
    const key = `aide/${STAMPED}`;
    const html = await specsList(
      start().base,
      `${ARCHIVED_VIEW}&error=${encodeURIComponent("already reopened")}&errorSpec=${encodeURIComponent(key)}`,
    );
    expect(blockFor(html, STAMPED)).toContain("already reopened");
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
    // Spec 224: the same row means the same row OPEN too — the fold and
    // the phase lines under it, not a second shape wearing the mark.
    expect(row).toContain('class="fold');
    expect(row).toContain(">archived<");
    const open = await listUntil(base, "not landed", `${ARCHIVED_VIEW}${opened(STAMPED)}`);
    expect(Object.keys(phaseLines(open, STAMPED))).toEqual([
      "create",
      "analyze",
      "implement",
      "archive",
    ]);
    expect(blockFor(open, STAMPED)).not.toContain('class="rowrun"');
  });

  // The exception the DEFAULT view keeps. "Active" is today's
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
    expect(html).toMatch(/>Archived \(5\)</);
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
    expect(html).not.toMatch(/aria-current="true"[^>]*>Active/);
  });

  // The three chips that were here before this spec each list the states
  // they allow, and none of them lists `archived`.
  test("the three older chips keep their meaning", async () => {
    for (const state of ["active", "done", "problem"]) {
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
    // Spec 224 added a THIRD read behind the same gate: the phase lines
    // a locked row now opens come off `4-status.md`'s own claim.
    expect(fn.indexOf("continue;")).toBeLessThan(fn.indexOf("archivedSteps(ref.dir)"));
  });

  test("and the gate answers for every chip there is", async () => {
    const { filterShowsArchived } = await import("../src/render/queue-list.ts");
    expect(filterShowsArchived(undefined)).toBe(false);
    expect(filterShowsArchived("not-archived")).toBe(false);
    expect(filterShowsArchived("all")).toBe(true);
    expect(filterShowsArchived("archived")).toBe(true);
    for (const key of ["active", "done", "problem"]) {
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
