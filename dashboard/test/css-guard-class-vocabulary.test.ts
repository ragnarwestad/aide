// Split out of css-token-guard.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ROOT, RENDER_FILES } from "./css-guard-fixtures.ts";

// --- the class vocabulary ---------------------------------------------------

/** The six components and their documented modifiers. Anything a page
 *  wants to look like has to be one of these. */
const COMPONENTS = [
  "btn", "primary", "ok", "danger", "busy", "spin",
  // Spec 208: what a control wears between the click and the answer,
  // for the two kinds of waiting a BUTTON's `busy` does not cover — an
  // in-page row swap, and a real navigation to another document.
  "awaiting",
  "badge", "b-idle", "b-running", "b-waiting", "b-ready", "b-refused", "b-done", "dot",
  "phases", "phase", "default", "checked", "done", "off", "box",
  "rowmsg", "err", "warn", "info",
  // the invisible holder around the spec row's state badge (2026-08-24),
  // mirroring actionslot: it reserves the width on mobile so the pill
  // inside keeps its natural size.
  "badgeslot",
  // the "still checking" pulse (2026-08-24): the bar itself, and the
  // visually-hidden word inside it that screen readers get instead.
  "checking", "sr",
  "field", "wide",
  "filters",
];

/** Class names `queue-client.ts` selects on or writes. They carry no
 *  styling of their own — renaming one silently breaks Run, Approve,
 *  Cancel, Merge or the refusal display in a browser, with no type
 *  error to catch it. */
const JS_HOOKS = [
  "rowrun", "actionform", "mergeform",
  "refused", "refusal", "newspec", "newspecform", "frow", "factions",
  // spec 112: the Projects panel — the Add form and one Remove per
  // allowlisted project.
  "addprojectform", "removeform",
  // spec 258: the Deploy button on a project's own page.
  "deployform",
  // spec 276: queue-client.ts selects on all three — the Enabled
  // checkbox, the Run-now form, and the create/edit form (whose own
  // `input[name="cron"]` feeds the live cron-next preview).
  "scheduleenabled", "schedulerun", "scheduleform",
  // spec 277: the Delete confirmation, a plain POST with no submit
  // override — queue-client.ts binds bindTypedConfirm to it only.
  "scheduledeleteform",
];

/** Structure and layout: what a thing IS on the page, not what it looks
 *  like. Short on purpose — a new entry here is a decision, and it
 *  shows up in the diff as one. */
const STRUCTURE = [
  // the frame — "menu" and "menupanel" are the "…" disclosure in the
  // header and the box it opens (spec 119, which removed "layout").
  "pagehead", "stamp", "brand", "mark", "mark-l", "mark-d", "surface", "actionslot", "current", "lbl",
  // where the pips sit on a spec's name line, since the Progress
  // column went and they moved in beside the name (2026-08-22)
  "pipslot",
  "tabbar", "tab",
  // The same bar one level in: a spec's seven tabs and a job's three,
  // which were filter pills until 2026-08-23 (2026-08-23, "IKKE bruke
  // chips i stedet for tabs").
  "subtabs",
  // The one width a document page shares: banner, tabs and panel
  // (2026-08-23).
  "doc",
  // "theme" is Theme's own sibling disclosure (spec 243, popup revision
  // 2026-08-25) — same trigger/panel look as "menu" via the shared
  // class, this one names which of the two a given "details.menu" is.
  // "state" is the state-filter dropdown's own (spec 289, replacing the
  // per-state chips) — a third "details.menu", named the same way.
  "menu", "menupanel", "theme", "state", "about", "aboutpanel", "aboutclose", "listtop",
  // a confirmation asked over the page instead of on one of its own
  // (2026-08-31, the schedule row's Delete): the same `<dialog>` the
  // About box is, and the panel inside it.
  "confirmdialog", "confirmpanel",
  // text roles — "u-usd"/"u-tok" are the two halves of every
  // consumption figure (spec 118): both are rendered, and one CSS rule
  // each shows exactly the one the reader asked for.
  "small", "muted", "num", "label", "desc", "summary", "counts", "specdesc",
  // one whole spec file, preformatted (spec 150) — the spec page shows
  // four of them and a phase's job page one
  "specfile",
  // the archive's own three: the search box, widened and uncaptioned,
  // and the two cells that must not wrap — the date (2026-08-23) and
  // what the spec cost in time (spec 207). All three are on the Specs
  // list since spec 221, which folded the archive into it.
  "archive-q", "archive-date", "archive-duration",
  // and the form that box sits in (spec 221): a line of its own under
  // the chips, because that line was already full. "searchfield" is the
  // box's own wrapper and "searchclear" the × inside it (spec 226) —
  // one press back to the whole list, and a link like every other
  // control on this page rather than a script.
  // "icon-search" is the magnifying glass inside the field, left-aligned
  // opposite "searchclear" (design handoff, 2026-08-25).
  "specsearch", "searchfield", "searchclear", "icon-search",
  "u-usd", "u-tok",
  // containers — "stack" was the vertical one (spec 124): the row's
  // action buttons, one under the next, in the list's first column. It
  // went with them in spec 157, which draws ONE button per row, beside
  // the state, in the page's ordinary "row" container. "tablewrap" is
  // the box a table too wide for the window scrolls inside, so the
  // PAGE never does (spec 155).
  "row", "intro", "tabpanel", "facts", "extra",
  // the one back-navigation link every subpage carries (spec 252),
  // deliberately not ".btn": it goes somewhere rather than submitting
  // anything.
  "backlink",
  // the Steps tab's per-row expand (spec 240): the link that opens a
  // step's own log, and the row the log itself sits in.
  "steplink", "steplog",
  "tablewrap",
  // the spec list
  // "modelcell" is where a phase line's three choices sit: the AI, the
  // model, and the phase's own box. Spec 165 gave the AI a column of
  // its own ("toolcell") and spec 192 took it back out again — a
  // column boundary is a reserved width and two lots of cell padding,
  // and the three read as three separate things with that between
  // them.
  "list", "spechead", "subrow", "phasecell", "modelcell",
  // the spec list's own table (2026-08-24): the mobile stylesheet lays
  // it out as stacked blocks, and the archive page and the settings
  // table share "list" without wanting any of that.
  "speclist",
  // the mobile fold on a phase line (design handoff, mobile-spec-row):
  // the label, its hidden checkbox, the chevron, and the AI+model pair
  // the checkbox shows and hides. Inert on desktop.
  "phasefold", "foldphase", "foldchevron", "aimodel",
  "spec-name", "spec-title",
  // the row's message panel (spec 143): a full-width row of its own, so
  // a sentence out of a status file or a runner's refusal wraps instead
  // of running off the right edge of a cell sized for a word.
  "specnotice",
  "empty", "listnote", "fold", "shut", "sortlink", "on", "asc",
  "branchlist", "branch",
  "pips", "pip", "now", "past", "todo",
  // a spec row's own state — deliberately NOT `active`/`archived`,
  // which `site.ts` uses for the unrelated question of whether a spec
  // folder has been archived on disk. "run-archived" is spec 221's
  // reader row: an archived spec, on the list, with no control on it
  // the server would refuse.
  "run-new", "run-live", "run-past", "run-archived",
  // and site.ts's answer to that other question
  "spec-open", "spec-archived",
  // the project overview
  "proj-row", "error-text", "error",
  // the row's name is stretched across the whole row by an ::after
  // overlay (spec 233), so a press anywhere on it opens the project;
  // "proj-row-action" lifts the Remove button back above that overlay,
  // which is the only reason either class exists.
  "proj-row-link", "proj-row-action",
  // a spec's remaining checks, at the top of its page (spec 182): the
  // Tasks-table rows of 4-status.md, grouped by phase, each undone one
  // carrying the button that ticks it. "checkbox" is that button — and
  // the same-sized span a done or archived row shows in its place, so
  // the two kinds of row line up.
  "checks", "checkshead", "checklist", "checkphase", "check", "checktask", "checkbox",
  // the two forms on the spec page that post one of those checks and
  // the description (spec 229). A class of its own for one rule: their
  // buttons sit a step lower than an ordinary form's do.
  "specform",
  // /schedule (spec 276, reworked spec 278): the New-job link's own
  // right-alignment, the detail page's key/value overview, the
  // create/edit form's error line, and the Cron field's input and its
  // live "Next run" preview span.
  "schedulenewlink", "kv", "scheduleform-error", "cron-input", "cron-next",
];

const ALLOWED = new Set([...COMPONENTS, ...JS_HOOKS, ...STRUCTURE]);

/** Every class name a render file writes into markup. `${...}` is
 *  replaced first: a fragment built from an expression is skipped, so
 *  the check is on the literal vocabulary. The expressions themselves
 *  are all in `components.ts`, where the variant unions are typed and a
 *  bogus one is a compile error rather than a class nobody notices. */
function classesIn(source: string): string[] {
  const flat = source.replace(/\$\{[^}]*\}/g, "«»");
  const attrs = [
    ...flat.matchAll(/class="([^"]*)"/g),
    ...flat.matchAll(/className\s*=\s*"([^"]*)"/g),
  ];
  return attrs
    .flatMap((m) => m[1]!.split(/\s+/))
    .filter((c) => c && !c.includes("«"));
}

describe("render files use the component vocabulary and nothing else", () => {
  test("the glob found the render files at all", () => {
    expect(RENDER_FILES.length).toBeGreaterThan(4);
  });

  for (const file of RENDER_FILES) {
    test(`${file} introduces no class of its own`, async () => {
      const source = await Bun.file(join(ROOT, file)).text();
      const unknown = [...new Set(classesIn(source))].filter((c) => !ALLOWED.has(c));
      expect(unknown).toEqual([]);
    });
  }

  // Split across an entry point and its themed folder (split
  // queue-client.ts into a bundled folder) — both are globbed, so a
  // class written in any of the split files is caught the same as one
  // in the entry.
  test("the browser code writes no class of its own either", async () => {
    const files = [
      "src/queue-client.ts",
      ...new Bun.Glob("src/queue-client/**/*.ts").scanSync(ROOT),
    ];
    const source = (await Promise.all(files.map((f) => Bun.file(join(ROOT, f)).text()))).join("\n");
    const unknown = [...new Set(classesIn(source))].filter((c) => !ALLOWED.has(c));
    expect(unknown).toEqual([]);
  });
});
