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
// returns having done nothing. There is no `#jobrows` here for the
// five-second swap to reach for.
//
// Modelled on `projects-page.ts`, which is the other served page with
// real forms on it: same shell, same guard, same top-of-page refusal.

import { backLink, btn, field, messageSlot, phaseChip, phases, helpPopover} from "../../ui/components";
import { DESCRIPTION_MAX, TITLE_MAX } from "../../../queue/parse-request.ts";
import { esc } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { pickTab, tabBar } from "../../ui/tabs.ts";
import { NEW_SPEC_ROUTE } from "../projects-page";
import type { SpecsPageOptions, SpecTarget } from "../specs-list";
import { optionsTab } from "./options-tab.ts";

export interface NewSpecPageOptions {
  /** What a failed create had typed (spec 506): the form opens with it
   *  filled in. A project the form no longer offers is simply not selected. */
  prefill?: { project: string; title: string; description: string };
  /** Every project a spec may be CREATED in — the raw allowlist, not
   *  the discovered set. A project whose first spec this form exists to
   *  make has nothing on disk to be discovered from. Empty or absent
   *  and the page says so instead of drawing a form with an empty
   *  dropdown. */
  createProjects?: string[];
  /** Every active spec, across every project: what the new one may be
   *  made to build on. */
  targets?: SpecTarget[];
  /** The page's browser code, compiled from `specs-client.ts` by the
   *  server: the inline refusal and the Depends-on scoping. Everything
   *  here works without it, one page load at a time. */
  script?: string;
  /** Every model the config lists, and which CLI each starts — the
   *  same view the spec list's phase lines are given, built by the same
   *  helper in `serve.ts` so the two pages cannot come to offer
   *  different lists (spec 228). */
  modelChoices?: SpecsPageOptions["modelChoices"];
  /** What the configuration would give each step. Only `create`'s entry
   *  (or the table's `default`) can matter here: a create job runs that
   *  one step. */
  defaultModels?: SpecsPageOptions["defaultModels"];
  /** Where "← Back" goes (spec 252) — resolved by `serve.ts` from the
   *  request's own `Referer`, same-origin only. Absent falls back to
   *  `/`, today's exact hardcoded destination. */
  backHref?: string;
  /** Spec 408. Absent means English — the same default `pageShell`'s
   *  own `opts.lang` falls back to. */
  lang?: Language;
  /** Spec 435. The request's own address, threaded to `pageShell` so its
   *  language links keep the reader on this same page. */
  currentUrl?: string;
  /** Which tab the page opens on, off the address's `?tab=`; anything
   *  but a tab's own key opens Spec. */
  tab?: string;
}

// What a spec builds on (spec 110). One chip per active spec, newest
// first — the number is the order a reader thinks in, and it is the
// reverse of `discoverProjects`'s ascending sort.
//
// The chip's own project rides on a WRAPPER, not on the chip: `phaseChip`
// ties its `data-` attribute to its form value, and the value here has
// to be the folder. A bare `<span>` with a data attribute needs no class,
// so the closed component vocabulary is untouched.
//
// On THIS page every project's chips are rendered, and the browser
// scopes them to the chosen one (`specs-client.ts`). Without script they
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
  targets: SpecTarget[],
  checked: Set<string> = new Set(),
  // A row of its own, or a field sharing one. The New-spec page asks for
  // the first since spec 228; the Edit page, the other caller, keeps the
  // layout it has by leaving this alone.
  // `locked`: folders this spec already depends on that are NOT among
  // the targets — archived ones, which cannot be chosen and so are not
  // offered. They are drawn ticked and disabled, above the rest with
  // the other picked ones, so the page says what the specs list says
  // without offering a change it cannot make.
  // `actions`: a Save/Cancel pair to draw on the "Depends on" line
  // itself, after the "(?)". The spec page's tracking form has this
  // field as its only real control, and its buttons belong beside the
  // label rather than under a list tall enough to push them off screen.
  o: {
    wide?: boolean; locked?: string[]; project?: string; actions?: string;
    /** New-spec page only (spec 474): draw the picked box and the pick
     *  list as two same-styled fields side by side, each with its own
     *  label, no outer title and no "none" placeholder. */
    sideBySide?: { dependsOnLabel: string; selectLabel: string };
  } = {},
): string {
  const specs = [...targets].sort(
    (a, b) =>
      a.project.localeCompare(b.project) ||
      -a.specFolder.localeCompare(b.specFolder, "en", { numeric: true }),
  );
  if (specs.length === 0 && !(o.locked ?? []).length) return "";
  const chip = (t: SpecTarget) =>
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
  const help = helpPopover(
    "what a dependency does",
    "A dependency applies from this spec's next gated step (implement, resolve, archive) — " +
      "never to a step already running.",
  );
  // Spec 474: the New-spec page's own shape — picked box and pick list
  // side by side, both framed the same way (AC-3), no outer title
  // (AC-6, the left column's own label is it) and no "none" placeholder
  // (AC-4). One shared `.field` still wraps both: depends-lift.ts walks
  // up to the nearest `.field` from a ticked box and queries DOWN for
  // `.phases.picked` / `.phases:not(.picked)` — both have to still be
  // found from one shared ancestor, never two.
  if (o.sideBySide) {
    return (
      `<span class="field${o.wide ? " wide" : ""} depends-pair">` +
        `<span class="depends-col">` +
          `<span class="fieldhead"><span class="lbl">${esc(o.sideBySide.dependsOnLabel)}</span>` +
          `<span class="fieldend">${help}</span></span>` +
          phases(lockedBlock + picked.map(chip).join(""), "picked") +
        `</span>` +
        `<span class="depends-col">` +
          `<span class="lbl">${esc(o.sideBySide.selectLabel)}</span>` +
          phases(rest.map(chip).join("")) +
        `</span>` +
      `</span>`
    );
  }
  // "Selected:" is drawn whether or not anything is: an empty picked
  // block was no block at all, so a spec that depends on nothing looked
  // exactly like one whose dependencies the page had failed to show,
  // and the framed list below read as the answer.
  // The picked box is ALWAYS drawn, even with nothing in it: the word
  // "none" in its place left the script that lifts a chip on tick with
  // no box to lift into, so ticking did nothing. "none" is a sibling
  // that CSS hides the moment the box has a chip (`field.css`).
  const selected = `<span class="row"><span class="lbl">Selected:</span>` +
    phases(lockedBlock + picked.map(chip).join(""), "picked") +
    `<span class="muted" data-none>none</span></span>`;
  return field(
    "Depends on",
    selected + phases(rest.map(chip).join("")),
    { group: true, wide: o.wide, help, actions: o.actions },
  );
}

// The New spec page's two tabs, in the order the strip shows them, each
// key also its `?tab=` value.
export const NEW_SPEC_TABS = ["spec", "options"] as const;
export type NewSpecTab = (typeof NEW_SPEC_TABS)[number];

/** The form's id: the fields inside it, and Create and the phase table's
 *  controls outside or beside it, are tied to it by name. */
const FORM_ID = "new-spec-form";

// Both tabs are in the one form, so a press posts what either holds; the
// closed one is `hidden`, and the page script switches them in place
// (`specs-client/new-spec-tabs/`).
const panel = (key: NewSpecTab, open: NewSpecTab, body: string): string =>
  `<div data-tab-panel="${key}"${key === open ? "" : " hidden"}>${body}</div>`;

// The fields needed to make the spec: which project, its title, its
// description and what it builds on, on the Spec tab; the settings and
// the phase table on Options.
//
// It posts a project NAME, a title and a description. What the spec ends
// up being CALLED is decided by `/aide-create` alone: nothing here, and
// nothing in `aide-run-spec`, computes a spec number or a folder slug.
function newSpecForm(opts: NewSpecPageOptions, projects: string[], open: NewSpecTab): string {
  const chosen = projects.find((p) => p === opts.prefill?.project);
  // Each `.frow` is a full-width row inside the same wrapping flex the
  // Add form shares, so the shared `.pageform` look is untouched.
  const spec =
    field(
      "Project",
      // Nothing is chosen for the reader: the first project in the list was
      // where every untouched form used to land. `required` is what makes the
      // browser refuse the empty placeholder at the field, as it does for the
      // title and the description below. `id` is what `for` below points at.
      `<select name="project" id="new-spec-project" required>` +
        `<option value=""${chosen ? "" : " selected"}>Choose a project…</option>` +
        projects.map((p) => `<option value="${esc(p)}"${p === chosen ? " selected" : ""}>${esc(p)}</option>`).join("") +
        `</select>`,
      { wide: true, for: "new-spec-project" },
    ) +
    field(
      "Title",
      `<input type="text" name="title" maxlength="${TITLE_MAX}" required ` +
        (opts.prefill ? `value="${esc(opts.prefill.title)}" ` : "") +
        `placeholder="what the spec is about, in a few words">`,
      { wide: true },
    ) +
    `<span class="frow">` +
    field(
      "Description",
      `<textarea name="description" rows="10" maxlength="${DESCRIPTION_MAX}" required ` +
        `placeholder="the problem, and what you want instead">${esc(opts.prefill?.description ?? "")}</textarea>`,
      { wide: true },
    ) +
    `</span>` +
    `<span class="frow">` +
    dependsOnField(opts.targets ?? [], new Set(), {
      wide: true,
      sideBySide: {
        dependsOnLabel: t(opts.lang ?? "en", "newSpec.dependsOn"),
        selectLabel: t(opts.lang ?? "en", "newSpec.select"),
      },
    }) +
    `</span>`;
  return (
    `<form method="post" action="/api/queue/create" class="pageform newspecform" id="${FORM_ID}">` +
    panel("spec", open, spec) +
    panel("options", open, optionsTab(opts, FORM_ID)) +
    // The slot a refusal is written into, after both tabs so it is seen
    // from either. A rejected create names a spec that was never made, so
    // there is no row for the reason to land on the way there is for
    // every other action. Empty until something fills it (`.refused:empty`
    // draws nothing).
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
  const lang = opts.lang ?? "en";
  const open = pickTab(NEW_SPEC_TABS, opts.tab, "spec");
  // Above the tabs, so it is pressed from either. It reaches the form by
  // `form=`, and the form holds no button of its own: `postForm()` gives
  // the busy word to the form's first button, and only without one to a
  // button naming it (`specs-client/press.ts`).
  const create = btn({ label: "Create", variant: "primary", pending: "creating…", form: FORM_ID });
  const tabs = tabBar(NEW_SPEC_TABS, NEW_SPEC_ROUTE, open, {}, "", {
    label: (key) => t(lang, key === "spec" ? "newSpec.tabSpec" : "newSpec.tabOptions"),
    data: { "new-spec-tabs": "" },
  });
  const body = projects.length
    ? backLink(opts.backHref ?? "/", "New spec", create) + tabs + newSpecForm(opts, projects, open)
    : backLink(opts.backHref ?? "/", "New spec") +
      // The link on `/` is simply not offered when there is nothing to
      // create in, but this page has an address of its own and can be
      // reached anyway — and an empty form with an empty dropdown
      // reads as a page that failed to load.
      `<p class="muted">No project on this machine may have a spec made in it yet. ` +
      `Add one on the Projects page first.</p>`;
  // `/` as the current path, not this page's own: the tab bar names the
  // two AREAS of the site, and making a spec is part of the spec list's
  // — the same answer `job-page.ts` gives for a job's detail page.
  //
  // No reload of its own, for the reason `/projects` has none: this page is
  // a form, and a blunt refresh wipes a half-typed description.
  return pageShell("New spec", entries, "/", body, generatedAt, {
    docTitle: "aide -board — new spec",
    script: opts.script,
    hideHeading: true,
    hideTabBar: true,
    lang: opts.lang,
    currentUrl: opts.currentUrl,
  });
}
