// `/new`: the form that makes a spec, and nothing else on the page.
//
// It used to be a disclosure folded into the spec list — press "New
// spec" and the page unfolded under the button (spec 113 gave that
// summary the primary-button look). Pressing a primary button and
// having the page grow under it reads oddly, and there was no way out
// of the open form but pressing the same button again: no Cancel
// existed, because a toggle needs none.
//
// A page of its own answers both. The control on `/` is a plain link,
// this page is the whole form, and it has the two actions a form on its
// own page has to have: Create, which queues the job and returns to the
// list where the new spec's row shows its progress, and Cancel, which
// returns having done nothing. Both work with no script at all — a
// link and a form POST — and there is no `#jobrows` here for the
// five-second swap to reach for.
//
// Modelled on `projects-page.ts`, which is the other served page with
// real forms on it: same shell, same guard, same top-of-page refusal.

import { backLink, btn, field, messageSlot, phaseChip, phases, rowMessage, stepLabel, tokenField } from "../ui/components.ts";
import { esc } from "../ui/html.ts";
import { pageShell, type NavEntry } from "../ui/shell.ts";
import { PHASE_LINES, type QueuePageOptions, type QueueTarget, type SpecGroup } from "./queue-list.ts";
import { aiPicker, modelPicker, phaseCaptionCells, type PickerOptions } from "./queue-list/model-picker.ts";

export interface NewSpecPageOptions {
  /** Carried into the form, for a browser that got here with the token
   *  in the address rather than in a cookie. */
  token?: string;
  /** Every project a spec may be CREATED in — the raw allowlist, not
   *  the discovered set. A project whose first spec this form exists to
   *  make has nothing on disk to be discovered from. Empty or absent
   *  and the page says so instead of drawing a form with an empty
   *  dropdown. */
  createProjects?: string[];
  /** Every active spec, across every project: what the new one may be
   *  made to build on. */
  targets?: QueueTarget[];
  /** The page's browser code, compiled from `queue-client.ts` by the
   *  server: the inline refusal and the Depends-on scoping. Everything
   *  here works without it, one page load at a time. */
  script?: string;
  /** Why the last attempt was refused, carried back in the query string
   *  after a no-JS form POST. It goes at the top: the spec it named was
   *  never made, so there is no row for it to land on. */
  error?: string;
  /** Every model the config granted a budget to, and which CLI each
   *  starts — the same view the spec list's phase lines are given, built
   *  by the same helper in `serve.ts` so the two pages cannot come to
   *  offer different lists (spec 228). */
  modelChoices?: QueuePageOptions["modelChoices"];
  /** What the configuration would give each step. Only `create`'s entry
   *  (or the table's `default`) can matter here: a create job runs that
   *  one step. */
  defaultModels?: QueuePageOptions["defaultModels"];
  /** Where "← Back" goes (spec 252) — resolved by `serve.ts` from the
   *  request's own `Referer`, same-origin only. Absent falls back to
   *  `/`, today's exact hardcoded destination. */
  backHref?: string;
}

// What a spec builds on (spec 110). One chip per active spec, newest
// first — the number is the order a reader thinks in, and it is the
// reverse of `discoverProjects`'s ascending sort.
//
// The chip's own project rides on a WRAPPER, not on the chip: `phaseChip`
// ties its `data-` attribute to its form value, and the value here has
// to be the folder. A bare `<span>` with a data attribute needs no class,
// so the closed component vocabulary (`css-token-guard.test.ts`) is
// untouched.
//
// On THIS page every project's chips are rendered, and the browser
// scopes them to the chosen one (`queue-client.ts`). Without script they
// are all offered, and a cross-project pick is caught by the same server
// refusal that catches it from the API — the convenience is lost, the
// guard is not.
//
// Shared with the Edit page since spec 174, which had a free-text input
// where this control already existed. Hence the two arguments rather
// than the page's own options object: the list to offer, and which of
// it is already ticked. A second copy of this markup would have drifted
// from it the first time one of the two was fixed.
export function dependsOnField(
  targets: QueueTarget[],
  checked: Set<string> = new Set(),
  // A row of its own, or a field sharing one. The New-spec page asks for
  // the first since spec 228; the Edit page, the other caller, keeps the
  // layout it has by leaving this alone.
  // `locked`: folders this spec already depends on that are NOT among
  // the targets — archived ones, which cannot be chosen and so are not
  // offered. They are drawn ticked and disabled, above the rest with
  // the other picked ones, so the page says what the specs list says
  // without offering a change it cannot make.
  o: { wide?: boolean; locked?: string[]; project?: string } = {},
): string {
  const specs = [...targets].sort(
    (a, b) =>
      a.project.localeCompare(b.project) ||
      -a.specFolder.localeCompare(b.specFolder, "en", { numeric: true }),
  );
  if (specs.length === 0 && !(o.locked ?? []).length) return "";
  const chip = (t: QueueTarget) =>
    `<span data-project="${esc(t.project)}">` +
    phaseChip({
      dataAttr: "data-depends",
      value: t.specFolder,
      label: t.specFolder,
      name: "dependsOn",
      checked: checked.has(t.specFolder),
    }) +
    `</span>`;
  // Spec 404: what is already ticked sits above the scrolling list
  // (REQ-1), never capped itself — one partition of the same set, not
  // two controls (REQ-3): every chip still posts `dependsOn` from the
  // one form, whichever half it renders in.
  // An archived dependency is an ordinary chip, ticked. It cannot be
  // ADDED — nothing archived is offered in the list below — but a
  // dependency you already have is one you can drop, and a box that
  // will not untick would say otherwise.
  const lockedChip = (folder: string) =>
    `<span data-project="${esc(o.project ?? "")}">` +
    phaseChip({
      dataAttr: "data-depends",
      value: folder,
      label: folder,
      name: "dependsOn",
      checked: true,
      title: "archived — it can be dropped here, but not added back",
    }) +
    `</span>`;
  const picked = specs.filter((t) => checked.has(t.specFolder));
  const rest = specs.filter((t) => !checked.has(t.specFolder));
  const lockedBlock = (o.locked ?? []).map(lockedChip).join("");
  const pickedBlock =
    picked.length || lockedBlock ? phases(lockedBlock + picked.map(chip).join(""), "picked") : "";
  return field(
    "Depends on",
    pickedBlock + phases(rest.map(chip).join("")),
    { group: true, wide: o.wide },
  );
}

// One row per phase — create, analyze, implement, archive — each with a
// tick, an AI choice and a model choice, drawn by the same
// `aiPicker`/`modelPicker`/`phaseCaptionCells` the Specs list's own spec
// row uses (spec 342): the control this page needs already exists as
// parts, and the task is reusing them, not writing a second version for
// a spec that does not exist yet.
//
// `aiPicker`/`modelPicker` derive the `<select>`'s `form="..."` from a
// `SpecGroup`'s own `project`/`specFolder` — real values a spec on this
// page has neither of, so a small, clearly-synthetic row is built once
// here, and `formIdOverride` (this page's own form id) is what actually
// ties every select to it.
function newSpecPhaseTable(opts: NewSpecPageOptions, formId: string): string {
  const pickerOpts: PickerOptions = {
    modelChoices: opts.modelChoices,
    defaultModels: opts.defaultModels,
    // No `pendingModels`: a spec that does not exist yet has no
    // `specFolder` to key a pending pick on (REQ-6) — the `pending`
    // tier of `resolveChosenModel` then falls through to `configured`
    // every time, the same answer `create`'s own picker already gave.
  };
  const row: SpecGroup = {
    project: "", specFolder: "new", named: false, state: "not-started",
    spentUsd: 0, costUnmeasured: false, phases: [], done: [],
    dependsOn: [], analyzeStale: false,
  };
  const captionRow = (opts.modelChoices ?? []).length
    ? `<tr class="subrow" data-caption="1">${phaseCaptionCells(pickerOpts)}</tr>`
    : "";
  const phaseRows = PHASE_LINES.map((step) => {
    // `create` MADE the spec these lines belong to and cannot be
    // created again — the same locked, nameless box `phase-rows.ts`'s
    // own `create` line draws for an existing spec.
    const locked = step === "create";
    const box = phaseChip({
      dataAttr: "data-phase",
      value: step,
      label: "",
      ariaLabel: locked
        ? "Create — always runs, and not a step you can drop"
        : stepLabel(step),
      name: locked ? "" : "steps",
      form: formId,
      checked: locked,
      disabled: locked,
      plain: true,
    });
    return (
      `<tr class="subrow" data-step="${esc(step)}"><td class="phasecell">${esc(stepLabel(step))}</td>` +
      `<td class="modelcell"><span class="row">` +
      `<span class="aimodel">${aiPicker(row, pickerOpts, step, false, false, undefined, undefined, formId)}` +
      `${modelPicker(row, pickerOpts, step, false, false, undefined, undefined, formId)}</span>` +
      `${box}</span></td></tr>`
    );
  }).join("");
  return `<table class="list"><tbody>${captionRow}${phaseRows}</tbody></table>`;
}

// Spec 394 (REQ-2, REQ-3): the acceptance switch, paired with "Depends
// on" beside it rather than living inside the phase table's own rows —
// neither is about one phase, both are about the spec as a whole.
// Spec 386's original placement (a row inside `newSpecPhaseTable`) split
// this pair across the phase table; REQ-9 also flips the default to
// CHECKED, so a spec made without touching the switch is recorded as
// not requiring ticking.
function acceptanceField(formId: string): string {
  return phaseChip({
    dataAttr: "data-acceptance",
    value: "1",
    label: "acceptance ticking not required",
    name: "acceptanceNotRequired",
    form: formId,
    checked: true,
    plain: true,
    title: "Skip the acceptance-criteria table this analyze writes — the requirements stay written down, nothing is left to tick before archive.",
  });
}

// The fields needed to make the spec: which project, its phase table,
// what it builds on, its title and its description.
//
// It posts a project NAME, a title and a description. What the spec ends
// up being CALLED is decided by `/aide-create` alone: nothing here, and
// nothing in `aide-run-spec`, computes a spec number or a folder slug.
function newSpecForm(opts: NewSpecPageOptions, projects: string[]): string {
  const formId = "new-spec-form";
  // Four lines, read top to bottom: Project on its own, the phase table
  // beneath it, Depends on paired with the acceptance switch (spec 394,
  // REQ-3) on a line of their own, Title on the next, then Description
  // with Create and Cancel at its right-hand side. Each `.frow` is a
  // full-width row inside the same wrapping flex the Add form shares,
  // so the shared `.newspecform` look is untouched.
  return (
    `<form method="post" action="/api/queue/create" class="newspecform" id="${formId}">` +
    tokenField(opts.token) +
    `<span class="frow">` +
    field(
      "Project",
      `<select name="project">` +
        projects.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("") +
        `</select>`,
    ) +
    `</span>` +
    newSpecPhaseTable(opts, formId) +
    // Spec 394 (REQ-3): the two whole-spec facts drawn adjacent to each
    // other, in one row — never split across the phase table the way
    // spec 386 originally left the switch.
    `<span class="frow">` +
    dependsOnField(opts.targets ?? [], new Set(), { wide: true }) +
    acceptanceField(formId) +
    `</span>` +
    field(
      "Title",
      `<input type="text" name="title" maxlength="120" required ` +
        `placeholder="what the spec is about, in a few words">`,
      { wide: true },
    ) +
    `<span class="frow">` +
    field(
      "Description",
      `<textarea name="description" rows="4" maxlength="2000" required ` +
        `placeholder="the problem, and what you want instead"></textarea>` +
        `<small class="muted small">Requirements will be drafted from this ` +
        `text — a "## Requirements" section you write here is left as it ` +
        `stands.</small>`,
      { wide: true },
    ) +
    `<span class="factions">` +
    btn({ label: "Create", variant: "primary", pending: "creating…" }) +
    `</span></span>` +
    // The slot a refusal is written into. A rejected create names a spec
    // that was never made, so there is no row for the reason to land on
    // the way there is for every other action. Empty until something
    // fills it (`.refused:empty` draws nothing).
    messageSlot("refused") +
    `</form>`
  );
}

export function renderNewSpecPage(
  entries: NavEntry[],
  generatedAt: string,
  opts: NewSpecPageOptions,
): string {
  const projects = opts.createProjects ?? [];
  const body =
    backLink(opts.backHref ?? "/", "New spec") +
    // A refusal first, or it is read after the thing it refused.
    (opts.error ? rowMessage("failed", opts.error, { hook: "refusal", tag: "p" }) + "\n" : "") +
    (projects.length
      ? newSpecForm(opts, projects)
      : // The link on `/` is simply not offered when there is nothing to
        // create in, but this page has an address of its own and can be
        // reached anyway — and an empty form with an empty dropdown
        // reads as a page that failed to load.
        `<p class="muted">No project on this machine may have a spec made in it yet. ` +
        `Add one on the Projects page first.</p>`);
  // `/` as the current path, not this page's own: the tab bar names the
  // two AREAS of the site, and making a spec is part of the spec list's
  // — the same answer `job-page.ts` gives for a job's detail page.
  //
  // No meta refresh, for the reason `/projects` has none: this page is
  // a form, and a blunt refresh wipes a half-typed description.
  return pageShell("New spec", entries, "/", body, generatedAt, undefined, {
    docTitle: "aide -board — new spec",
    script: opts.script,
    hideHeading: true,
  });
}
