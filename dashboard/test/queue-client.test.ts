// Spec 96: the page's own merge submit. Pressing Merge used to be a
// plain form POST — several seconds with nothing changing on the button,
// then a 303 back to the list and a reload that threw the reader to the
// top of the page.
//
// Spec 101 gave the same treatment to the other four controls (Run,
// Approve, Cancel, Create) and took the last navigation out of the
// refusal path, so this file now covers one shared handler rather than
// Merge's own special case.
//
// `queue-client.ts` can neither import nor export anything (the server
// transpiles it into an inline classic <script>), so it cannot be
// imported by a test the way every other module here is. It CAN be
// transpiled and run — which is what this file does, against a document
// small enough to state in full: getElementById, one delegated listener,
// one form, one button. What that proves is the DECISION — what is
// requested, when the button changes, and when the page is allowed to
// navigate — which is the whole of what this file decides.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SPINNER } from "../src/render/components.ts";

const RAW = readFileSync(join(import.meta.dir, "..", "src", "queue-client.ts"), "utf-8");
const SOURCE = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(RAW);

interface Reply {
  ok: boolean;
  body?: unknown;
  throws?: boolean;
  /** Hold the request open until this settles — for what happens
   *  WHILE a press is in flight. */
  hold?: Promise<void>;
  /** What a row-refresh answers with. Named per reply because spec 129
   *  is about WHICH of two answers reaches `#jobrows`, so the two have
   *  to be told apart once they are both in the air. */
  text?: string;
}

/** What each control is called before and during its request, and which
 *  form it is drawn in. The wording is the server's (`data-pending` in
 *  the markup); the harness only has to carry it the way the DOM would.
 *
 *  Keyed by CONTROL, not by form class: two controls can share a class
 *  and be told apart by route, label and variant only, so a table keyed
 *  by class could test one of them at most. The `variant` is what the
 *  server put on the button before the press, which is the thing `busy`
 *  has to replace. */
const CONTROLS: Record<
  string,
  { label: string; pending: string; action: string; formClass: string; variant: string }
> = {
  rowrun: {
    label: "Run", pending: "starting…", formClass: "rowrun", variant: "primary",
    action: "http://dash.test/api/queue",
  },
  actionform: {
    label: "Cancel", pending: "cancelling…", formClass: "actionform", variant: "primary",
    action: "http://dash.test/api/queue/job-1/cancel",
  },
};

/** `className` and `classList` over one string, the way the DOM keeps
 *  them: the code under test reads one and writes the other, and a fake
 *  where those two disagree could not tell "busy replaced the variant"
 *  from "busy was added beside it". */
function classes(el: { className: string }) {
  const set = () => new Set(el.className.split(" ").filter(Boolean));
  const write = (s: Set<string>) => void (el.className = [...s].join(" "));
  return {
    add: (c: string) => write(set().add(c)),
    remove: (c: string) => {
      const s = set();
      s.delete(c);
      write(s);
    },
    contains: (c: string) => set().has(c),
  };
}

/** One button in one form in `#jobrows`, the New-spec form beside it,
 *  and the globals the file actually touches. Nothing here pretends to
 *  be a browser: it answers the handful of questions the code asks, and
 *  records what it was asked to do. */
function harness(
  reply: (url: string) => Reply,
  control_ = "actionform",
  search = "",
  o: { offRow?: boolean; pathname?: string } = {},
) {
  const control = CONTROLS[control_]!;
  const formClass = control.formClass;
  /** The run form's id. Every control on the row that is written
   *  outside its tags names it — the Run button, the phase boxes, the
   *  five model selects and the AI picker — and it is what a press has
   *  to follow to reach them. */
  const ROW_FORM = "rowrun-aide/127-one-ai";
  /** One button as the DOM reports it. Two of them are needed since
   *  spec 151: the one pressed, and the siblings on the same row that
   *  must lock with it.
   *
   *  `form` is the attribute, and it is the whole point for Run: that
   *  button is written OUTSIDE `<form class="rowrun">` and reaches it
   *  by name alone (`queue-list.ts`, `stateAction`). */
  const makeButton = (label: string, pending: string, variant: string, form?: string) => {
    const b = {
      textContent: label,
      // What the server drew it as. A fake with no starting class could
      // not prove the variant is REMOVED when the busy look goes on.
      className: `btn ${variant}`,
      classList: {} as ReturnType<typeof classes>,
      innerHTML: "",
      // A button with nothing left to run is hidden rather than drawn
      // dead, which is what the server does too — so the fake has to be
      // able to hold the answer.
      hidden: false,
      title: "",
      disabled: false,
      isConnected: true,
      tagName: "BUTTON",
      dataset: { pending },
      getAttribute: (n: string) => (n === "form" ? form ?? null : null),
      insertAdjacentHTML: (where: string, html: string) => {
        b.innerHTML = where === "afterbegin" ? html + b.innerHTML : b.innerHTML + html;
      },
    };
    b.classList = classes(b);
    return b;
  };
  const button = makeButton(
    control.label,
    control.pending,
    control.variant,
    formClass === "rowrun" ? ROW_FORM : undefined,
  );
  // The row's phase boxes — the space this spec's spinner takes over
  // while the press is out. A COLLAPSED row (spec 103) has none: it
  // renders Approve or Merge alone, with no run form and no boxes.
  const boxes = "<label class=\"phase\">analyze</label>";
  // `offsetWidth` is the one thing a hand-built object cannot honestly
  // report — nothing here lays anything out. It is a stated number, and
  // what the test proves is that the code READS it and holds the space
  // it names, not how many pixels a browser would have said.
  const phases = { innerHTML: boxes, isConnected: true, offsetWidth: 168, style: { minWidth: "" } };
  const otherPhases = { innerHTML: boxes, isConnected: true, offsetWidth: 168, style: { minWidth: "" } };
  /** Since spec 124 the boxes are on the phase LINES and the buttons
   *  on the header row, so a button's own `<tr>` has none to lend —
   *  and the code stopped asking. Every selector it does ask for is
   *  recorded, so a lookup creeping back is a failed test rather than
   *  a spinner appearing in the "also touches" chips beside the
   *  button. */
  const rowQueries: string[] = [];
  const row = {
    querySelector: (sel: string) => {
      rowQueries.push(sel);
      return null;
    },
  };
  const tokenInput = { value: "s3cret" };
  // Spec 151: the OTHER controls on the same row. A press locks the
  // whole row, so a fake with one button on it could not tell a
  // row-wide lock from the single-button one it replaced.
  //
  // They sat in a `<td class="stackcell">` until spec 157 moved the
  // row's one control into the State cell of the head row and deleted
  // that cell. The scope is `tr.spechead` now, which is the same
  // element open or shut — a collapsed row had no stack cell at all,
  // and this fake had to model that as "no scope".
  const runButton = formClass === "rowrun" ? button : makeButton("Run", "starting…", "primary", ROW_FORM);
  const cancelButton = formClass === "actionform" ? button : makeButton("Cancel", "cancelling…", "danger");
  const headControls = [...new Set([runButton, cancelButton, button])];
  /** The run form as the State cell holds it: hidden fields only, and
   *  an id every control outside its tags names. */
  const runFormEl = {
    id: ROW_FORM,
    className: "rowrun",
    // What `rowControls` asks any form: which row am I on. And what a
    // press asks: where is this row's token.
    closest: (sel: string) => (sel.includes("spechead") ? (o.offRow ? null : spechead) : null),
    querySelector: (sel: string) => (sel.includes("token") ? tokenInput : null),
    querySelectorAll: () => [],
  };
  /** The `<tr class="spechead">` the row's one control is drawn in.
   *  It is what a press scopes itself to. */
  const spechead = {
    querySelectorAll: () => headControls,
    querySelector: (sel: string) => (sel.includes("rowrun") ? runFormEl : null),
  };
  const form = {
    action: control.action,
    className: formClass,
    // The run form is the only one with an id, because it is the only
    // one whose controls are written outside it.
    id: formClass === "rowrun" ? ROW_FORM : "",
    // The phase boxes ARE the Run form's fields — a real `FormData`
    // reads the checkboxes that are in the form at that moment. So the
    // fake reads them out of the same element the press overwrites: a
    // spinner put there before the form was serialised would post a job
    // with no phases at all, and a fixed list could not tell.
    //
    // And a DISABLED control posts nothing — the browser's own rule,
    // and the reason the row is locked only after the form has been
    // serialised (spec 151). A fake that ignored `disabled` could not
    // tell the two orders apart.
    get fields(): [string, string][] {
      const live = phases.innerHTML.includes("phase") && !stepBoxes.some((b) => b.disabled);
      const ticked: [string, string][] = live ? [["steps", "analyze"]] : [];
      return [...ticked, ["view.state", "active"]];
    },
    // Empty for the run form, and that is the markup: its button is
    // written after its closing tag and reaches it by `form="…"`, so
    // `querySelectorAll` — descendants only — finds nothing at all.
    querySelectorAll: () => (formClass === "rowrun" ? [] : [button]),
    querySelector: (sel: string) => (sel.includes("token") ? tokenInput : null),
    closest: (sel: string) =>
      sel === "tr"
        ? row
        : sel.includes("spechead")
          ? // A form that is not on a spec's row at all — the New-spec
            // page, the Projects panel. `collapsed` no longer names a
            // row without a scope: since spec 157 a shut row draws its
            // control in the same `<tr>` an open one does.
            (o.offRow ? null : spechead)
          : sel.includes(`.${formClass}`)
            ? form
            : null,
  };

  // The New-spec form is the whole of `/new` since spec 121 — no
  // #jobrows beside it and no disclosure around it — so it is bound
  // directly rather than by delegation, a second code path tested as
  // one.
  const createButton = {
    textContent: "Create",
    className: "btn primary",
    classList: {} as ReturnType<typeof classes>,
    innerHTML: "",
    title: "",
    disabled: false,
    isConnected: true,
    dataset: { pending: "creating…" },
    insertAdjacentHTML: (_where: string, html: string) => void (createButton.innerHTML += html),
  };
  createButton.classList = classes(createButton);
  const slot = { textContent: "" };
  const resets: number[] = [];
  // Spec 110's Depends-on chips: one wrapper per active spec, each
  // naming its own project, plus the Project select they are scoped to.
  // `reset()` reverts the select the way the browser's own does —
  // silently, without firing `change`, which is the whole reason the
  // reset path needs a re-sync of its own.
  const projectSelect = { value: "aide", addEventListener: (t: string, fn: (e: unknown) => void) => void (on[`select:${t}`] = fn) };
  const chip = (project: string) => {
    const input = { checked: true, disabled: false };
    return {
      dataset: { project },
      getAttribute: (name: string) => (name === "data-project" ? project : null),
      hidden: false,
      querySelector: (sel: string) => (sel.includes("input") ? input : null),
      input,
    };
  };
  const chips = [chip("aide"), chip("aide-dashboard")];

  // The five phase model selects, and (spec 179) the AI select each one
  // is paired with. `<option>` collections are scaffolding the chips
  // above cannot stand in for: a select's value IS one of its options,
  // which is the whole of what a write has to move.
  const MODELS: [string, string][] = [
    ["sonnet", "claude"],
    ["fable", "claude"],
    ["codex-fast", "codex"],
  ];
  /** `ran` is the server's own "this phase has history" marker
   *  (`data-ran="1"`, `queue-list.ts`): the select is showing what the
   *  phase really ran on. */
  const modelSelect = (step: string, chosen: string, ran = false) => {
    const options = MODELS.map(([value, tool]) => ({
      value,
      dataset: { tool },
      hidden: false,
      selected: value === chosen,
    }));
    const self = {
      name: `model.${step}`,
      options,
      dataset: ran ? { ran: "1" } : ({} as { ran?: string }),
      tagName: "SELECT",
      // Spec 151: a press locks the row, and a select is a control on
      // it. `isConnected` is what tells "the swap replaced me" from
      // "the swap never came".
      disabled: false,
      isConnected: true,
      getAttribute: (n: string) => (n === "form" ? ROW_FORM : null),
      // A change lands on the select itself, and the handler walks up
      // with `closest`. A model select is NOT an AI select, not a
      // phase box and not a tail box (spec 160) — it is not an `input`
      // at all — so it answers all three of those selectors with null
      // and its own with itself.
      closest: (sel: string): unknown =>
        sel.includes("data-ai") || sel.includes('name="steps"') || sel.includes("data-post-to")
          ? null
          : self,
      get selectedOptions() {
        return options.filter((o) => o.selected);
      },
      // A real select's value IS its selected option: writing one moves
      // the other, which is the whole of what the reselection does.
      get value() {
        return options.find((o) => o.selected)?.value ?? "";
      },
      set value(v: string) {
        for (const o of options) o.selected = o.value === v;
      },
      /** What the SERVER drew, to go back to when the rows are
       *  replaced. A browser gets brand-new elements out of that swap;
       *  a fake that kept the old ones would prove nothing. */
      redraw: () => {
        for (const o of options) {
          o.selected = o.value === chosen;
          o.hidden = false;
        }
      },
    };
    return self;
  };
  // Two phases with history and three still ahead — the mixed row
  // "set all" is scoped against (spec 169).
  const modelSelects = [
    modelSelect("create", "sonnet"),
    modelSelect("analyze", "fable", true),
    modelSelect("review-plan", "sonnet", true),
    modelSelect("implement", "codex-fast"),
    modelSelect("archive", "sonnet"),
  ];
  /** A model select belonging to ANOTHER row: a write must reach the
   *  five that share its form id and no others. */
  const otherRowSelect = { ...modelSelect("analyze", "fable"), getAttribute: () => "rowrun-aide/99-other" };
  // Spec 179: one AI select per phase line, paired with that phase's
  // model select by `data-ai` and the shared form id. The model it
  // fills in per tool is worked out by the SERVER and carried on each
  // option's `data-default` — the browser copies that value and never
  // decides one, which is what these fixtures stand for.
  const AI_DEFAULT: Record<string, string> = { claude: "sonnet", codex: "codex-fast" };
  const aiSelect = (step: string, tool: string) => {
    const options = ["claude", "codex"].map((t) => ({
      value: t,
      dataset: { default: AI_DEFAULT[t]! },
      hidden: false,
      selected: t === tool,
    }));
    const self = {
      // No `name`: the control posts nothing (`queue-list.ts`). It is
      // still what the DOM reports — an empty string, not undefined —
      // and the key a kept choice would be filed under is built from
      // it, which is why the handler must intercept it BEFORE the
      // branch that remembers every other select.
      name: "",
      options,
      dataset: { ai: `model.${step}` },
      tagName: "SELECT",
      disabled: false,
      isConnected: true,
      getAttribute: (n: string) =>
        n === "form" ? ROW_FORM : n === "data-ai" ? `model.${step}` : null,
      closest: (sel: string): unknown =>
        sel.includes('name="steps"') || sel.includes("data-post-to") ? null : self,
      get selectedOptions() {
        return options.filter((o) => o.selected);
      },
      get value() {
        return options.find((o) => o.selected)?.value ?? "";
      },
      set value(v: string) {
        for (const o of options) o.selected = o.value === v;
      },
      /** What the SERVER drew: the tool of the model the phase is
       *  actually on, which is where a swap puts this select back. */
      redraw: () => {
        for (const o of options) o.selected = o.value === tool;
      },
    };
    return self;
  };
  /** One per phase line, resting on the tool of the model that line's
   *  select is drawn on. */
  const aiSelects = [
    aiSelect("create", "claude"),
    aiSelect("analyze", "claude"),
    aiSelect("review-plan", "claude"),
    aiSelect("implement", "codex"),
    aiSelect("archive", "claude"),
  ];
  // Spec 141: the row's phase boxes. They share one `name` — the step
  // is in the VALUE — which is why what is remembered about them is
  // keyed on three parts and not the two a select needs. `create` has
  // no box (a spec that exists cannot be created again), so the four
  // that can be run are the four that are here.
  const stepCheckbox = (value: string, served: boolean) => {
    const self = {
      name: "steps",
      value,
      checked: served,
      tagName: "INPUT",
      disabled: false,
      isConnected: true,
      // `aria-label` is the phase's reader-facing name, which the server
      // sets on every box (`phaseChip`) and which the button's label is
      // read off — "review" for `review-plan`, so the two differ and
      // the test can tell which one the code used.
      getAttribute: (n: string) =>
        n === "form" ? ROW_FORM : n === "aria-label" ? (value === "review-plan" ? "review" : value) : null,
      // A tick lands on the input itself. It is not a select of any
      // kind, so it answers both select selectors with null and its
      // own with itself — otherwise the delegated listener would file
      // it in the map the model selects use.
      closest: (sel: string): unknown => (sel.includes('name="steps"') ? self : null),
      /** What the SERVER drew: `preTicked` re-derives the ticks from
       *  the row's own history on every render, so a swap puts them
       *  back exactly as they were before the reader touched them. */
      redraw: () => void (self.checked = served),
    };
    return self;
  };
  const stepBoxes = [
    stepCheckbox("analyze", true),
    stepCheckbox("review-plan", true),
    stepCheckbox("implement", false),
    stepCheckbox("archive", false),
  ];
  // Spec 160: a box for a phase the RUNNING job has not reached yet.
  // It names the run form the way every other control on the row does
  // — that is how a press finds the row to lock — but carries no
  // `name`, so it is never posted with it. Its own route is in
  // `data-post-to`, and a tick goes there on `change` rather than
  // waiting for a submit this row does not offer.
  const tailBox = (() => {
    const self = {
      name: "",
      value: "archive",
      checked: false,
      tagName: "INPUT",
      disabled: false,
      isConnected: true,
      getAttribute: (n: string) =>
        n === "form" ? ROW_FORM : n === "data-post-to" ? "/api/queue/job-1/steps" : null,
      closest: (sel: string): unknown => (sel.includes("data-post-to") ? self : null),
      /** What the SERVER draws after the swap: the tick the job's own
       *  step list justifies, which for a refused edit is the box
       *  exactly as it was. */
      redraw: () => void (self.checked = false),
    };
    return self;
  })();
  const createForm = {
    action: "http://dash.test/api/queue/create",
    fields: [["project", "aide"], ["title", "A spec"]] as [string, string][],
    querySelectorAll: (sel: string) =>
      sel.includes("data-project") ? (chips as unknown as typeof createButton[]) : [createButton],
    querySelector: (sel: string) =>
      sel.includes("token")
        ? tokenInput
        : sel.includes("refused")
          ? slot
          : sel.includes("project")
            ? projectSelect
            : null,
    // Nothing wraps this form on `/new` — the page IS the form. A fake
    // that still handed a `<details>` back would let a re-added
    // panel-close pass unnoticed.
    closest: () => null,
    reset: () => {
      resets.push(1);
      projectSelect.value = "aide";
    },
    addEventListener: (type: string, fn: (e: unknown) => void) => void (on[`create:${type}`] = fn),
  };

  // Spec 112's Projects panel: one Remove form, with the typed
  // confirmation the browser gates its button on. The button is
  // rendered ENABLED by the server — turning it off is this code's job,
  // and a fake that started it disabled could not tell the two apart.
  const removeButton = {
    textContent: "Remove",
    title: "",
    disabled: false,
    dataset: { pending: "removing…" },
    className: "btn danger",
    isConnected: true,
    insertAdjacentHTML: () => {},
  } as unknown as typeof createButton & { disabled: boolean };
  removeButton.classList = classes(removeButton);
  const confirmInput = { value: "" } as { value: string; addEventListener?: unknown };
  const confirmWrap = {
    getAttribute: (name: string) => (name === "data-confirm" ? "atlasaurus" : null),
    querySelector: (sel: string) => (sel.includes("input") ? confirmInput : removeButton),
  };
  const removeSlot = { textContent: "" };
  // Spec 138: the Add form, which is the one whose SUCCESS has something
  // to say — the readiness answer the server worked out for the project
  // that was just added. A Remove has no such answer, and still leaves.
  const addButton = {
    textContent: "Save",
    title: "",
    disabled: false,
    dataset: { pending: "saving…" },
    className: "btn primary",
    isConnected: true,
    insertAdjacentHTML: () => {},
  } as unknown as typeof createButton & { disabled: boolean };
  addButton.classList = classes(addButton);
  // `className` too: the slot the server renders is the REFUSAL slot,
  // and a success written into it must not stay the colour of one.
  const addSlot = { textContent: "", className: "refused rowmsg err" };
  const addForm = {
    action: "http://dash.test/api/queue/projects",
    fields: [["name", "skjer"], ["existingPath", "skjer"]] as [string, string][],
    querySelectorAll: () => [addButton],
    querySelector: (sel: string) =>
      sel.includes("data-confirm")
        ? null
        : sel.includes("token")
          ? tokenInput
          : sel.includes("refused")
            ? addSlot
            : null,
    closest: () => null,
    addEventListener: (type: string, fn: (e: unknown) => void) => void (on[`add:${type}`] = fn),
  };
  const removeForm = {
    action: "http://dash.test/api/queue/projects/atlasaurus/remove",
    fields: [["confirm", "atlasaurus"]] as [string, string][],
    querySelectorAll: () => [removeButton],
    querySelector: (sel: string) =>
      sel.includes("data-confirm")
        ? confirmWrap
        : sel.includes("token")
          ? tokenInput
          : sel.includes("refused")
            ? removeSlot
            : null,
    closest: () => null,
    addEventListener: (type: string, fn: (e: unknown) => void) => void (on[`remove:${type}`] = fn),
  };
  let typed: (() => void) | undefined;
  confirmInput.addEventListener = (type: string, fn: () => void) => {
    if (type === "input") typed = fn;
  };

  const inserted: { id: string; className: string; textContent: string }[] = [];
  const parentNode = {
    insertBefore: (node: { id: string; className: string; textContent: string }) => void inserted.push(node),
  };
  // Replacing the rows is not a string assignment in a browser: the old
  // selects are gone and new ones stand there, drawn from the server's
  // answer. The fake says so — every select goes back to what the
  // server would have rendered — because a fake that kept the reader's
  // choice by doing nothing could not tell a fix from its absence.
  let rowsHtml = "";
  const rows = {
    get innerHTML(): string {
      return rowsHtml;
    },
    set innerHTML(html: string) {
      rowsHtml = html;
      for (const a of aiSelects) a.redraw();
      for (const m of modelSelects) m.redraw();
      otherRowSelect.redraw();
      for (const b of stepBoxes) b.redraw();
      tailBox.redraw();
    },
    querySelectorAll: (sel: string) =>
      sel.includes("model.")
        ? [...modelSelects, otherRowSelect]
        : sel.includes('name="steps"')
          ? stepBoxes
          : sel.startsWith("button")
            ? [runButton]
            : [],
    parentNode,
    addEventListener: (type: string, fn: (e: unknown) => void) => void (on[type] = fn),
  };
  const on: Record<string, (e: unknown) => void> = {};
  const requests: { url: string; init: Record<string, unknown> }[] = [];
  // `pathname` because the page's own reloads go back to the page they
  // are on — the Projects panel is served at `/projects` since spec 115,
  // and a hardcoded `/` would throw the reader onto the spec list.
  const location = { search, href: "http://dash.test/", pathname: o.pathname ?? "/" };
  // `replaceState` moves the address bar WITHOUT loading a document, so
  // it writes `search` (which `swapRows` reads back) and deliberately
  // leaves `href` alone: in this file `href` means "the page navigated",
  // and that is the thing the refusal path stopped doing.
  const replaced: string[] = [];
  const history = {
    replaceState: (_state: unknown, _title: string, url: string) => {
      replaced.push(String(url));
      location.search = new URL(String(url), "http://dash.test").search;
    },
  };

  const document = {
    getElementById: (id: string) => (id === "jobrows" ? rows : null),
    // `.phases` answers with ANOTHER row's boxes on purpose: a press
    // must reach its own row's boxes and no others, so a document-wide
    // lookup has to be visibly wrong rather than accidentally right.
    querySelector: (sel: string) =>
      sel.includes("newspecform")
        ? createForm
        : // Spec 160: a tail box is on a phase LINE, and the row it
          // belongs to is reached through the form it names — the same
          // id every other control outside that form carries.
          sel.startsWith("form[id=")
          ? (sel.includes(ROW_FORM) ? runFormEl : null)
          : sel.includes("phases")
            ? otherPhases
            : null,
    // Spec 112 binds its panel's forms as a SET, the same way it is
    // rendered: one Add form and one Remove per allowlisted project.
    // A form-scoped selector answers only the selects that name that
    // form — the DOM's own answer, and the one thing a fake that
    // handed back every select on the page could not tell apart.
    // The `data-ai` branch is asked FIRST on purpose: an AI select's
    // own selector names the model select it is paired with, so
    // `select[data-ai="model.analyze"]` contains "model." too and the
    // branch below would answer it with the model selects.
    querySelectorAll: (sel: string) =>
      sel.includes("removeform")
        ? [addForm, removeForm]
        : sel.includes("data-ai=")
          ? aiSelects.filter(
              (a) =>
                sel.includes(`form="${a.getAttribute("form")}"`) &&
                sel.includes(`data-ai="${a.dataset.ai}"`),
            )
          : sel.includes("model.")
            ? [...modelSelects, otherRowSelect].filter(
                (s) =>
                  sel.includes(`form="${s.getAttribute("form")}"`) &&
                  // `^=` asks for every model select on the form; a
                  // full `name="model.analyze"` asks for exactly one,
                  // and a fake that handed back all five would let a
                  // write that reached every phase pass as one that
                  // reached its own.
                  (sel.includes('name^="model."') || sel.includes(`name="${s.name}"`)),
              )
            : // Spec 151: everything written OUTSIDE a form and tied to
              // it by name — the Run button, the four phase boxes, the
              // five model selects and the five AI selects. Another
              // row's select names another form and is not answered
              // here, which is what "the press reaches its own row and
              // no other" is proved against.
              sel.startsWith("[form=")
              ? [
                  runButton, ...stepBoxes, tailBox, ...modelSelects, ...aiSelects, otherRowSelect,
                ].filter((el) => sel.includes(`"${el.getAttribute("form")}"`))
              : [],
    createElement: () => ({ id: "", className: "", textContent: "" }),
    // Recorded since spec 189: `visibilitychange` is what opens and
    // closes the page's connection now, so a fake that swallowed it
    // could not tell a tab going quiet from one that never connected.
    addEventListener: (type: string, fn: (e: unknown) => void) => void (on[`doc:${type}`] = fn),
    visibilityState: "hidden",
  };
  const fetchStub = async (url: unknown, init: Record<string, unknown> = {}) => {
    const at = String(url);
    requests.push({ url: at, init });
    const r = reply(at);
    if (r.throws) throw new Error("offline");
    if (r.hold) await r.hold;
    return {
      ok: r.ok,
      json: async () => r.body,
      text: async () => r.text ?? "<tr></tr>",
    };
  };
  // The form serializer the browser owns. Injected rather than reached
  // for as a global, because a fake form is not an HTMLFormElement and
  // the real constructor refuses it.
  class FakeFormData {
    constructor(private readonly f: { fields?: [string, string][] }) {}
    forEach(fn: (value: string, key: string) => void): void {
      for (const [k, v] of this.f.fields ?? []) fn(v, k);
    }
  }

  /** The connection the page keeps open (spec 189). Every one ever
   *  constructed is kept, closed ones included: what a test about the
   *  hidden tab has to be able to say is that the old one was CLOSED
   *  and no new one was made in its place. */
  class FakeEventSource {
    static made: FakeEventSource[] = [];
    readonly listeners: Record<string, ((e: unknown) => void)[]> = {};
    closed = false;
    constructor(readonly url: string) {
      FakeEventSource.made.push(this);
    }
    addEventListener(type: string, fn: (e: unknown) => void): void {
      (this.listeners[type] ??= []).push(fn);
    }
    close(): void {
      this.closed = true;
    }
    /** What the browser would deliver. Synchronous, so a test says what
     *  happened next without waiting on a real socket. */
    emit(type: string): void {
      for (const fn of this.listeners[type] ?? []) fn({ type });
    }
  }
  FakeEventSource.made = [];
  /** The one the page is listening on right now, if any. */
  const live = () => FakeEventSource.made.filter((s) => !s.closed).at(-1) ?? null;

  /** Every timer the page asks for. Spec 189 took the last one away —
   *  the five-second poll — and an idle page that registers one again
   *  is the regression this records. */
  const intervals: number[] = [];

  // eslint-disable-next-line no-new-func -- the file under test IS a script
  new Function(
    "document", "location", "fetch", "setInterval", "history", "FormData", "EventSource",
    SOURCE,
  )(
    document,
    location,
    fetchStub,
    (_fn: () => void, ms: number) => {
      intervals.push(ms);
      return 0;
    },
    history,
    FakeFormData,
    FakeEventSource,
  );

  /** The visibility change the browser fires when the tab is shown or
   *  hidden. The state is set on the fake document first, exactly as
   *  the browser sets it before it dispatches. */
  const visibility = (state: "visible" | "hidden") => {
    document.visibilityState = state;
    on["doc:visibilitychange"]?.({});
  };

  /** What replaced the five-second timer: the server saying something
   *  moved. Connecting first when the page has not yet — the tests that
   *  used to call `tick()` set `visibilityState` by hand and expect the
   *  swap to follow, and connecting is what a visible page does. */
  const tick = () => {
    if (!live()) visibility(document.visibilityState as "visible" | "hidden");
    live()?.emit("changed");
  };

  const fire = (
    listener: string,
    target: unknown,
    extra: Partial<{ defaultPrevented: boolean }> = {},
  ) => {
    let prevented = extra.defaultPrevented ?? false;
    const event = {
      target,
      // A plain primary-button click. `navigate` reads this and bails
      // on anything else (middle click, a modifier held), so an event
      // without it would let every fold test pass for the wrong
      // reason.
      button: 0,
      get defaultPrevented() {
        return prevented;
      },
      preventDefault: () => {
        prevented = true;
      },
    };
    return on[listener]!(event) as unknown as Promise<void>;
  };

  const submit = (extra: Partial<{ defaultPrevented: boolean }> = {}) => {
    // The button is what a click lands on; `closest` walks up to the form.
    (button as unknown as { closest: (s: string) => unknown }).closest = form.closest;
    return fire("submit", button, extra);
  };
  const submitCreate = (extra: Partial<{ defaultPrevented: boolean }> = {}) =>
    fire("create:submit", createButton, extra);
  /** A plain CLICK on the row's own button, through the delegated
   *  listener `#jobrows` carries. The fold's chevron is on that same
   *  listener, which is why a button that now sits on the head row
   *  (spec 157) has to be shown not to reach it. */
  const click = () => {
    (button as unknown as { closest: (s: string) => unknown }).closest = form.closest;
    return fire("click", button);
  };
  /** The fold's own chevron, on the same delegated listener: the
   *  control that DOES navigate. Without it the button-click tests
   *  would pass against a listener that had stopped working. */
  const foldLink = {
    getAttribute: (n: string) => (n === "href" ? "/?open=aide%2F127-one-ai" : null),
    closest: (sel: string) => (sel.includes("data-nav") ? foldLink : null),
  };
  const clickFold = () => fire("click", foldLink);

  return {
    submit, submitCreate, click, clickFold, button, createButton, requests, location, rows, inserted,
    replaced, slot, resets, document, phases, otherPhases, rowQueries, tick,
    sources: FakeEventSource.made, live, visibility, intervals,
    projectSelect, chips,
    removeButton, removeSlot, confirmInput,
    addButton, addSlot,
    submitRemove: (extra: Partial<{ defaultPrevented: boolean }> = {}) =>
      fire("remove:submit", removeButton, extra),
    submitAdd: (extra: Partial<{ defaultPrevented: boolean }> = {}) =>
      fire("add:submit", addButton, extra),
    /** What the reader typing in the confirmation field does. */
    type: (value: string) => {
      confirmInput.value = value;
      typed?.();
    },
    changeProject: (value: string) => {
      projectSelect.value = value;
      on["select:change"]?.({ target: projectSelect });
    },
    modelSelects, otherRowSelect, aiSelects, stepBoxes, tailBox,
    /** A tail box ticked or unticked by hand — the tick that posts on
     *  its own, without a Run press behind it (spec 160). */
    changeTail: (checked: boolean) => {
      tailBox.checked = checked;
      return on["change"]?.({ target: tailBox }) as unknown as Promise<void>;
    },
    runButton, cancelButton,
    /** An AI picked on ONE phase line (spec 179) — the action that
     *  fills that phase's model in, and no other phase's. */
    changeAi: (index: number, tool: string) => {
      const select = aiSelects[index]!;
      select.value = tool;
      on["change"]?.({ target: select });
    },
    /** One phase's model, moved by hand — the other half of what a
     *  swap must not wash away. */
    changeModel: (index: number, value: string) => {
      const select = modelSelects[index]!;
      select.value = value;
      on["change"]?.({ target: select });
    },
    /** A phase box ticked or unticked by hand — the third control on
     *  the row a swap used to wash away. */
    changeStep: (index: number, checked: boolean) => {
      const box = stepBoxes[index]!;
      box.checked = checked;
      on["change"]?.({ target: box });
    },
    /** A change on something in the table that is no control at all. */
    changeOther: () =>
      on["change"]?.({ target: { closest: () => null } }),
  };
}

/** Enough microtask turns for a released `hold` to run the rest of
 *  `swapRows` — the fetch, the `text()`, the assignment. Counted
 *  rather than awaited because `tick()` drops its promise on purpose
 *  (a listener's return value is nobody's to wait on). */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const OK_ACTION = { ok: true, job: { id: "job-1" } };
/** Where `swapRows` asked for the rows, which is where the refusal the
 *  page is about to show comes from. */
const swapUrl = (h: { requests: { url: string }[] }): string =>
  h.requests.map((r) => r.url).find((u) => u.startsWith("/?") && u.includes("rows=1")) ?? "";

describe("a row button posts from the page (criteria 10-12)", () => {
  test("it asks for JSON on the form's own route, and carries the token", async () => {
    const h = harness((url) => (url.includes("/cancel") ? { ok: true, body: OK_ACTION } : { ok: true }));
    await h.submit();
    const posted = h.requests.find((r) => r.url.includes("/cancel"))!;
    expect(posted.init.method).toBe("POST");
    expect((posted.init.headers as Record<string, string>).accept).toBe("application/json");
    // The guard reads a header, the query string or the cookie — never
    // the form body, which is where the hidden field would have gone.
    expect(posted.url).toContain("token=s3cret");
  });

  // Spec 104: it says so by CHANGING, not by changing its word. The
  // pending wording is still the server's, and still shown — as the
  // button's `title`, where it costs no width.
  test("the button says so at once, instead of looking untouched (criterion 10)", async () => {
    let seenBusy = false;
    let seenTitle = "";
    const h = harness((url) => {
      if (url.includes("/cancel")) {
        seenBusy = h.button.classList.contains("busy");
        seenTitle = h.button.title;
      }
      return { ok: true, body: OK_ACTION };
    });
    await h.submit();
    expect(seenBusy).toBe(true);
    expect(seenTitle).toBe("cancelling…");
    // And the page stayed where the reader was.
    expect(h.location.href).toBe("http://dash.test/");
  });

  test("the rows are swapped as soon as the answer arrives, not on the next tick (criterion 11)", async () => {
    const h = harness(() => ({ ok: true, body: OK_ACTION }));
    await h.submit();
    expect(swapUrl(h)).toContain("rows=1");
    expect(h.rows.innerHTML).toBe("<tr></tr>");
  });

  // The five-second tick swaps `#jobrows` from the server. While a press
  // is in flight the server still shows the OLD state, so a swap in that
  // window put back an untouched label over the pending one the press
  // had just shown — seen on 2026-08-19: no feedback, then a jump. The
  // tick waits while anything is in flight.
  test("the tick does not swap the rows while a press is in flight", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const h = harness((url) => (url.includes("/cancel") ? { ok: true, body: OK_ACTION, hold: held } : { ok: true }));
    h.document.visibilityState = "visible";
    const pressed = h.submit();
    await Promise.resolve();
    h.tick();
    await Promise.resolve();
    expect(h.requests.filter((r) => r.url.includes("rows=1"))).toHaveLength(0);
    expect(h.button.classList.contains("busy")).toBe(true);
    release();
    await pressed;
    // Once the answer is in, the rows are fetched (criterion 11) — once.
    expect(h.requests.filter((r) => r.url.includes("rows=1"))).toHaveLength(1);
    h.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.requests.filter((r) => r.url.includes("rows=1"))).toHaveLength(2);
  });

  // The reload keeps the reader's view: a press that failed while the
  // server restarted used to land on a bare `/`, and the sort and
  // filter they had set were gone (seen 2026-08-19: "Spec ▴" reset to
  // "Started ▾" with no press of theirs).
  test("a press that cannot be sent at all reloads rather than lying — and keeps the view (criterion 12)", async () => {
    const h = harness(() => ({ ok: false, throws: true }), "actionform", "?sort=spec&dir=asc");
    await h.submit();
    expect(h.location.href).toBe("/?sort=spec&dir=asc");
  });

  // A form whose own onsubmit cancelled the event is not ours to post:
  // a delegated handler that ignored that would post anyway.
  test("a submit that was already cancelled posts nothing", async () => {
    const h = harness(() => ({ ok: true, body: OK_ACTION }), "actionform");
    await h.submit({ defaultPrevented: true });
    expect(h.requests).toHaveLength(0);
    expect(h.button.disabled).toBe(false);
    expect(h.button.textContent).toBe("Cancel");
  });
});

// --- spec 99/101: the view survives the press, and the row gets the reason ---

// Merging from the page goes through this file, not through the form
// POST — so the server's redirect fix reaches nobody with JavaScript on
// unless what this file does carries the same two things. Spec 101 took
// the navigation itself out: the query the server would have redirected
// to is written with `history.replaceState` and the rows are swapped, so
// the reader keeps the page, the scroll position and the form they were
// filling in.
describe("a refused action keeps the view and names its spec (criteria 7, 8)", () => {
  // One sentence, not a list: the route that answered per repo was the
  // merge route, and it went with the button (spec 149).
  const REFUSED = {
    ok: false,
    spec: "aide/99-merge-leaves-nothing-behind",
    error: "the tree is dirty in /repos/aide-specs",
  };

  test("the current filter and sort come along", async () => {
    const h = harness(
      (url) => (url.includes("/cancel") ? { ok: true, body: REFUSED } : { ok: true }),
      "actionform",
      "?state=active&sort=cost&token=s3cret",
    );
    await h.submit();
    const to = new URL(h.replaced[0]!, "http://dash.test");
    expect(to.pathname).toBe("/");
    expect(to.searchParams.get("state")).toBe("active");
    expect(to.searchParams.get("sort")).toBe("cost");
    // The token is handed over once as a cookie; carrying it back into
    // the address bar would put it in history for no reason.
    expect(to.searchParams.get("token")).toBeNull();
  });

  test("the spec the server named rides along, so the row can show it", async () => {
    const h = harness((url) => (url.includes("/cancel") ? { ok: true, body: REFUSED } : { ok: true }));
    await h.submit();
    const to = new URL(h.replaced[0]!, "http://dash.test");
    expect(to.searchParams.get("errorSpec")).toBe("aide/99-merge-leaves-nothing-behind");
    expect(to.searchParams.get("error")).toContain("the tree is dirty");
  });

  test("a refusal the server did not attribute still says the reason", async () => {
    const h = harness((url) =>
      url.includes("/cancel") ? { ok: true, body: { ok: false, error: "the tree is dirty" } } : { ok: true },
    );
    await h.submit();
    const to = new URL(h.replaced[0]!, "http://dash.test");
    expect(to.searchParams.get("error")).toContain("the tree is dirty");
    expect(to.searchParams.get("errorSpec")).toBeNull();
  });

  // Spec 101, criterion 6: the message lands on the row without the
  // page moving. The rows are re-fetched with the same query the
  // address bar now holds, so the reason comes back rendered on the
  // spec it belongs to — and nothing scrolled.
  test("the page does not navigate, and the rows are re-asked with the reason", async () => {
    const h = harness((url) => (url.includes("/cancel") ? { ok: true, body: REFUSED } : { ok: true }));
    await h.submit();
    expect(h.location.href).toBe("http://dash.test/");
    expect(decodeURIComponent(swapUrl(h))).toContain("errorSpec=aide/99-merge-leaves-nothing-behind");
    expect(h.rows.innerHTML).toBe("<tr></tr>");
  });
});

// --- spec 101: every control answers the press ------------------------------

// Run and Cancel were plain form posts: the browser navigated on the
// click, the button froze mid-navigation, and the redirect target
// re-rendered the whole page (a git call per spec) before anything came
// back. Same request, same route, same answer — the wait and the jump
// are what go.
describe("every action button says it was pressed (criteria 4, 5)", () => {
  const OK = { ok: true, job: { id: "job-1" } };

  for (const formClass of ["rowrun", "actionform"] as const) {
    test(`${formClass} changes its button before the answer arrives`, async () => {
      let seen = false;
      const h = harness(
        (url) => {
          if (url.includes("/api/queue")) seen = h.button.classList.contains("busy");
          return { ok: true, body: OK };
        },
        formClass,
      );
      await h.submit();
      expect(seen).toBe(true);
      // And it is put back when the request is over, in case the swap
      // left this very button standing.
      expect(h.button.textContent).toBe(CONTROLS[formClass]!.label);
      expect(h.button.classList.contains("busy")).toBe(false);
      expect(h.button.disabled).toBe(false);
    });

    test(`${formClass} swaps the rows in place instead of navigating`, async () => {
      const h = harness(() => ({ ok: true, body: OK }), formClass);
      await h.submit();
      expect(swapUrl(h)).toContain("rows=1");
      expect(h.rows.innerHTML).toBe("<tr></tr>");
      expect(h.location.href).toBe("http://dash.test/");
    });

    test(`a refused ${formClass} lands on the row, without the page moving`, async () => {
      const h = harness(
        (url) =>
          url.includes("rows=1")
            ? { ok: true }
            : { ok: false, body: { error: "analyze is already running on this spec", spec: "aide/101-x" } },
        formClass,
      );
      await h.submit();
      const to = new URL(h.replaced[0]!, "http://dash.test");
      expect(to.searchParams.get("error")).toContain("already running");
      expect(to.searchParams.get("errorSpec")).toBe("aide/101-x");
      expect(h.location.href).toBe("http://dash.test/");
      expect(h.rows.innerHTML).toBe("<tr></tr>");
    });
  }

  // Merge needs no body; Run IS its body — the phases, the model, the
  // other repos and the gate are all in the form, and a POST that
  // dropped them would queue something else than what was ticked.
  test("Run sends the form's own fields", async () => {
    const h = harness(() => ({ ok: true, body: OK }), "rowrun");
    await h.submit();
    const post = h.requests.find((r) => r.init.method === "POST")!;
    expect(String(post.init.body)).toContain("steps=analyze");
    expect((post.init.headers as Record<string, string>)["content-type"]).toContain(
      "application/x-www-form-urlencoded",
    );
  });
});

// The one form that is not about a spec that exists. It has no row for
// a refusal to land on — the spec it names was never made — so the
// reason goes beside the form the reader was typing into.
describe("the New-spec form answers for itself (criteria 7, 8)", () => {
  test("a refusal is written beside the form, and the reader stays on the page", async () => {
    const h = harness(() => ({ ok: false, body: { error: "no such project: nope" } }));
    await h.submitCreate();
    expect(h.slot.textContent).toContain("no such project");
    // Still on `/new`, with everything typed still typed.
    expect(h.location.href).toBe("http://dash.test/");
    expect(h.resets).toHaveLength(0);
    expect(h.replaced).toHaveLength(0);
  });

  // Spec 121, criterion 8. The form has a page of its own now: there is
  // no panel to shut, no #jobrows beside it to swap, and the thing the
  // reader asked to see — the new spec's row, with its progress — is on
  // the page this navigates to.
  test("a created spec takes the reader back to the list", async () => {
    const h = harness(() => ({ ok: true, body: { ok: true, job: { id: "job-2" } } }));
    await h.submitCreate();
    expect(h.location.href).toBe("/");
    // Nothing is put back in place first: the reader has left.
    expect(h.resets).toHaveLength(0);
    expect(h.requests.some((r) => r.url.includes("rows=1"))).toBe(false);
  });

  // Spec 104 changed what the four ROW buttons do while their request
  // is out, and deliberately left this one alone: it has no row to
  // shift and no phase boxes to lend their space, so the word it swaps
  // to costs nothing.
  test("the button says it is working, and its fields go with it", async () => {
    let seen = "";
    let seenBusy = false;
    const h = harness((url) => {
      if (url.includes("/create")) {
        seen = h.createButton.textContent;
        seenBusy = h.createButton.classList.contains("busy");
      }
      return { ok: true, body: { ok: true } };
    });
    await h.submitCreate();
    expect(seen).toBe("creating…");
    expect(seenBusy).toBe(false);
    const post = h.requests.find((r) => r.url.includes("/create"))!;
    expect(String(post.init.body)).toContain("title=A+spec");
  });

  test("a refusal already answered by something else is left alone", async () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    await h.submitCreate({ defaultPrevented: true });
    expect(h.requests).toHaveLength(0);
  });
});

// --- spec 110: the Depends-on chips follow the chosen project ----------------

// A dependency is resolved inside ONE specs root, so a chip belonging to
// another project is not a choice anyone can make. The server refuses it
// either way; this is the half that means nobody has to be refused to
// find out.
describe("the Depends-on chips are scoped to the chosen project", () => {
  test("only the chosen project's chips are live, from the moment the page loads", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    expect(h.chips[0]!.hidden).toBe(false);
    expect(h.chips[0]!.input.disabled).toBe(false);
    expect(h.chips[1]!.hidden).toBe(true);
    expect(h.chips[1]!.input.disabled).toBe(true);
  });

  test("changing the project swaps which ones are live, and unticks what it hides", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.chips[0]!.input.checked = true;
    h.changeProject("aide-dashboard");
    expect(h.chips[0]!.hidden).toBe(true);
    expect(h.chips[0]!.input.disabled).toBe(true);
    // A hidden box the reader can no longer see is not a choice they
    // are still making.
    expect(h.chips[0]!.input.checked).toBe(false);
    expect(h.chips[1]!.hidden).toBe(false);
    expect(h.chips[1]!.input.disabled).toBe(false);
  });

  // Spec 121 retired the re-sync that used to follow a create: the
  // success path navigates now, so there is no reset to chase and no
  // half-cleared form to leave behind. What the reader picked stands
  // until the browser leaves the page.
  test("a successful create leaves them alone — the page is on its way out", async () => {
    const h = harness(() => ({ ok: true, body: { ok: true, job: { id: "job-2" } } }));
    h.changeProject("aide-dashboard");
    expect(h.chips[1]!.hidden).toBe(false);
    await h.submitCreate();
    expect(h.location.href).toBe("/");
    expect(h.projectSelect.value).toBe("aide-dashboard");
    expect(h.chips[1]!.hidden).toBe(false);
  });
});

// --- spec 104: a pressed button keeps its width -----------------------------

// The press used to rewrite the button's word — "Run" became "starting…",
// "Cancel" became "cancelling…" — and the button grew or shrank to fit,
// which shoved the whole row sideways at the one moment it should look
// most in control. It says the same thing by changing its LOOK instead,
// to the busy variant the server already renders for a job in flight,
// and the spinner takes the space the phase boxes were using: they are
// idle while a press is out, and they come back with the next render.
describe("a pressed row button holds its size (spec 104)", () => {
  const OK = { ok: true, job: { id: "job-1" } };

  for (const control of ["rowrun", "actionform"] as const) {
    test(`${control} swaps to the busy look without changing its label`, async () => {
      const { label, variant } = CONTROLS[control]!;
      let seen = { label: "", busy: false, variant: true, spinner: "" };
      const h = harness(
        (url) => {
          if (url.includes("/api/queue")) {
            seen = {
              label: h.button.textContent,
              busy: h.button.classList.contains("busy"),
              variant: h.button.classList.contains(variant),
              spinner: h.button.innerHTML,
            };
          }
          return { ok: true, body: OK };
        },
        control,
      );
      await h.submit();
      // The word on the button is the word it had. Nothing that decides
      // the button's width changed, so the width could not.
      expect(seen.label).toBe(label);
      expect(seen.busy).toBe(true);
      // In PLACE of the variant, not beside it: two variants at once is
      // a button with two looks.
      expect(seen.variant).toBe(false);
      // ONE spinner per row, inside the button that was pressed: since
      // spec 124 the phase boxes are on lines of their own and have no
      // space to lend.
      expect(seen.spinner).toContain(SPINNER);
    });
  }

  // The pending word is not lost, only moved off the label: `title` is
  // where it costs no width. (A screen reader hears the press as the
  // button being disabled — see the spec's risk note.)
  test("the server's pending word rides along as the button's title", async () => {
    let seen = "";
    const h = harness((url) => {
      if (url.includes("/api/queue")) seen = h.button.title;
      return { ok: true, body: OK };
    }, "rowrun");
    await h.submit();
    expect(seen).toBe("starting…");
  });

  // Spec 124: there are no boxes to borrow any more — the phase boxes
  // are on the phase LINES, and every button on the row is on the
  // header. So the spinner goes where it always went on a collapsed
  // row: inside the button that was pressed, for every control alike.
  for (const control of ["rowrun", "actionform"] as const) {
    test(`${control} carries its own spinner, and asks no row for boxes`, async () => {
      let seen = { busy: false, spinner: "" };
      const h = harness((url) => {
        if (url.includes("/api/queue")) {
          seen = { busy: h.button.classList.contains("busy"), spinner: h.button.innerHTML };
        }
        return { ok: true, body: OK };
      }, control);
      await h.submit();
      expect(seen.busy).toBe(true);
      expect(seen.spinner).toContain(SPINNER);
      // The row is still asked for nothing at all: the "also touches"
      // chips now share the button's own `<tr>`, and a `.phases`
      // lookup would put the spinner in them.
      expect(h.rowQueries.filter((q) => q.includes("phases"))).toEqual([]);
    });
  }

  // The boxes are the Run form's own fields wherever they are drawn,
  // and the press must not disturb them: a spinner written over them
  // before the form is serialised posts a job with no phases at all.
  test("the phase boxes are left alone by a press", async () => {
    let seen = "";
    const h = harness((url) => {
      if (url.includes("/api/queue")) seen = h.phases.innerHTML;
      return { ok: true, body: OK };
    }, "rowrun");
    await h.submit();
    expect(seen).toContain('class="phase"');
    expect(h.phases.style.minWidth).toBe("");
    expect(String(h.requests[0]!.init.body)).toContain("steps=analyze");
  });

  // Nothing puts the boxes back by hand: every path out of a press ends
  // in the rows being re-asked from the server, which draws whatever is
  // true NOW — the boxes, or the busy chips of the job that just
  // started. Both halves of "success or refusal" go through it.
  test("the boxes come back with the server's own answer, on success", async () => {
    const h = harness(() => ({ ok: true, body: OK }), "rowrun");
    await h.submit();
    expect(swapUrl(h)).toContain("rows=1");
    expect(h.rows.innerHTML).toBe("<tr></tr>");
  });

  test("and on a refusal, which redraws the same way", async () => {
    const h = harness(
      (url) =>
        url.includes("rows=1")
          ? { ok: true }
          : { ok: false, body: { error: "analyze is already running", spec: "aide/104-x" } },
      "rowrun",
    );
    await h.submit();
    expect(swapUrl(h)).toContain("rows=1");
    expect(h.rows.innerHTML).toBe("<tr></tr>");
  });

  // The redraw is what puts the boxes back — but a redraw that fails
  // (server restarting, tailnet hiccup) leaves the row standing, and a
  // row left holding a spinner for something that is over is worse than
  // the shove this spec set out to fix.
  test("a redraw that never arrives puts the button back itself", async () => {
    const h = harness((url) => (url.includes("rows=1") ? { ok: false } : { ok: true, body: OK }), "rowrun");
    await h.submit();
    expect(h.rows.innerHTML).toBe("");
    expect(h.button.textContent).toBe("Run");
    expect(h.button.classList.contains("busy")).toBe(false);
    expect(h.button.classList.contains("primary")).toBe(true);
  });

  // `queue-client.ts` can neither import nor export (the server
  // transpiles it into an inline script), so the spinner it writes is a
  // hand-copied literal. Nothing but this would notice the two drifting
  // apart — one file cannot even name the other.
  test("the spinner it writes is the one components.ts renders", () => {
    expect(RAW).toContain(SPINNER);
  });
});

// --- spec 151: a press locks the row -----------------------------------------
//
// Seen 2026-08-21: Run was pressed, nothing on the row changed, so it
// was pressed again — and the second press was refused because the
// first had already started the job. The first press worked; the row
// never said so.
//
// Two things were wrong, and the second is why the first went
// unnoticed for so long. The Run button is written OUTSIDE its form
// and tied to it by `form="…"`, so `form.querySelectorAll("button")`
// — descendants only — found nothing to lock or to make busy. And the
// harness above used to hard-code `() => [button]` for every form,
// asserting by construction the very thing the markup breaks.
//
// The requirement is wider than the bug: a press locks EVERY control
// on that row at once — its own button, the other buttons in the
// stack, the phase boxes and the model/AI selects on the phase lines
// — and nothing is unlocked until the row has been redrawn from the
// server.
describe("a press locks every control on its row (spec 151)", () => {
  const OK = { ok: true, job: { id: "job-1" } };
  /** Every control the row has, as the press must leave them. */
  const rowState = (h: ReturnType<typeof harness>) => ({
    run: h.runButton.disabled,
    cancel: h.cancelButton.disabled,
    box: h.stepBoxes[0]!.disabled,
    model: h.modelSelects[0]!.disabled,
    ai: h.aiSelects[0]!.disabled,
    otherRow: h.otherRowSelect.disabled,
  });

  for (const control of ["rowrun", "actionform"] as const) {
    test(`${control} locks the whole row, and only its own row`, async () => {
      let seen = {} as ReturnType<typeof rowState>;
      const h = harness((url) => {
        if (url.includes("/api/queue")) seen = rowState(h);
        return { ok: true, body: OK };
      }, control);
      await h.submit();
      expect(seen).toEqual({
        run: true, cancel: true, box: true, model: true, ai: true,
        // The other row's select names another form. A press that
        // reached it would grey out a spec nobody touched.
        otherRow: false,
      });
    });
  }

  // The bug itself, stated as its own case: Run's button is not a
  // descendant of the form it submits, so the old descendants-only
  // lookup could neither disable it nor make it busy.
  test("Run is locked and busy although its button sits outside its form", async () => {
    let seen = { disabled: false, busy: false, title: "" };
    const h = harness((url) => {
      if (url.includes("/api/queue")) {
        seen = {
          disabled: h.runButton.disabled,
          busy: h.runButton.classList.contains("busy"),
          title: h.runButton.title,
        };
      }
      return { ok: true, body: OK };
    }, "rowrun");
    await h.submit();
    expect(seen).toEqual({ disabled: true, busy: true, title: "starting…" });
  });

  // The busy LOOK belongs to the button that was pressed. The stack is
  // locked whole, but Run is first in it — so a spinner taken from the
  // stack instead of from the submitted form would land on Run for
  // every press that was not Run's.
  test("the busy look stays on the pressed button, and Run is only greyed", async () => {
    let seen = { cancel: false, run: false, spinner: "" };
    const h = harness((url) => {
      if (url.includes("/api/queue")) {
        seen = {
          cancel: h.button.classList.contains("busy"),
          run: h.runButton.classList.contains("busy"),
          spinner: h.runButton.innerHTML,
        };
      }
      return { ok: true, body: OK };
    }, "actionform");
    await h.submit();
    expect(seen).toEqual({ cancel: true, run: false, spinner: "" });
  });

  // Not "until the answer arrives" — until the row that reflects it is
  // on the screen. The redraw is asked for while everything is still
  // locked.
  test("the row is still locked when the redraw is asked for", async () => {
    let seen = {} as ReturnType<typeof rowState>;
    const h = harness((url) => {
      if (url.includes("rows=1")) seen = rowState(h);
      return { ok: true, body: OK };
    }, "rowrun");
    await h.submit();
    expect(seen.run).toBe(true);
    expect(seen.box).toBe(true);
  });

  // The lock comes AFTER the form has been serialised. A disabled
  // control posts nothing, so locking the boxes first would queue a
  // job with no phases at all — the row's own fields, thrown away by
  // the thing meant to protect them.
  test("the phases still go with the press, although the boxes lock", async () => {
    const h = harness(() => ({ ok: true, body: OK }), "rowrun");
    await h.submit();
    expect(String(h.requests[0]!.init.body)).toContain("steps=analyze");
  });

  // Every control goes back to the state it was FOUND in, not to
  // "enabled": the server draws a row's boxes disabled while a job
  // holds them, and a press that put them back live would offer a
  // choice the server has already refused.
  test("a press that could not be sent puts back exactly what it locked", async () => {
    const h = harness(() => ({ ok: false, throws: true }), "actionform");
    h.stepBoxes[1]!.disabled = true;
    await h.submit();
    expect(rowState(h)).toEqual({
      run: false, cancel: false, box: false, model: false, ai: false, otherRow: false,
    });
    expect(h.stepBoxes[1]!.disabled).toBe(true);
  });

  // A SHUT row used to be the case with no scope at all: it drew its
  // one control in the header's last cell, that control's button was
  // inside its own form, and `td.stackcell` — an open row's cell —
  // found nothing. Spec 157 draws every row's control in the head row,
  // open or shut, so a shut row's press locks exactly what an open
  // one's does. Nothing is left that has a row and no scope.
  test("a shut row's control locks the whole row too (spec 157)", async () => {
    let seen = {} as ReturnType<typeof rowState>;
    const h = harness((url) => {
      if (url.includes("/api/queue")) seen = rowState(h);
      return { ok: true, body: OK };
    }, "actionform");
    await h.submit();
    expect(seen).toEqual({
      run: true, cancel: true, box: true, model: true, ai: true, otherRow: false,
    });
    expect(h.button.disabled).toBe(false);
    expect(h.button.classList.contains("busy")).toBe(false);
  });

  // What the fallback describes now: a form on no spec row at all —
  // the New-spec page, the Projects panel. Its own button is inside
  // it, and there is nothing to widen the scope to.
  test("a form on no spec row locks its own button and nothing else", async () => {
    let seen = { busy: false, disabled: false, run: false };
    const h = harness(
      (url) => {
        if (url.includes("/api/queue")) {
          seen = {
            busy: h.button.classList.contains("busy"),
            disabled: h.button.disabled,
            run: h.runButton.disabled,
          };
        }
        return { ok: true, body: OK };
      },
      "actionform",
      "",
      { offRow: true },
    );
    await h.submit();
    expect(seen).toEqual({ busy: true, disabled: true, run: false });
    expect(h.button.disabled).toBe(false);
    expect(h.button.classList.contains("busy")).toBe(false);
  });

  // Spec 157, criteria 9 and 11. The row's one button sits inside
  // `tr.spechead` now, and the fold's chevron is a `<a data-nav>` on
  // the same delegated listener. A press must RUN, never open the row
  // underneath the request — and it cannot, structurally: `navigate`
  // acts only on `closest("a[data-nav]")`, which a `<button>` does not
  // match. Asserted rather than assumed, since nothing in the markup
  // says so.
  for (const control of ["rowrun", "actionform"] as const) {
    test(`a press on ${control} does not fold the row open or shut`, () => {
      const h = harness(() => ({ ok: true, body: OK }), control);
      h.click();
      // No history rewrite, so no `?open=` was added or taken away —
      // and no row swap was asked for on the click's own account.
      expect(h.replaced).toEqual([]);
      expect(h.requests).toEqual([]);
    });
  }

  // The control case: the chevron on the SAME listener still folds.
  // Without this the three above would pass just as happily against a
  // listener that had stopped answering clicks at all.
  test("the fold's own chevron still navigates", () => {
    const h = harness(() => ({ ok: true, body: OK }), "rowrun");
    h.clickFold();
    expect(h.replaced).toEqual(["/?open=aide%2F127-one-ai"]);
  });
});

// --- spec 112: the Projects panel --------------------------------------------

describe("Remove is gated on the name being typed back", () => {
  test("the button is off until the input matches, and on again when it does", () => {
    const h = harness(() => ({ ok: true }));
    // Off from the moment the page loads — the server renders it
    // enabled, because a button it disabled could never be enabled
    // again with script off.
    expect(h.removeButton.disabled).toBe(true);
    h.type("atlas");
    expect(h.removeButton.disabled).toBe(true);
    h.type("atlasaurus");
    expect(h.removeButton.disabled).toBe(false);
    // And off again the moment the reader edits it back out.
    h.type("atlasaurus ");
    expect(h.removeButton.disabled).toBe(true);
  });

  test("a removal posts the confirmation and reloads the page it is on, keeping the view", async () => {
    const h = harness(
      () => ({ ok: true, body: { ok: true, results: [{ step: "confirm", ok: true }] } }),
      "actionform",
      "?state=running&sort=cost",
      { pathname: "/projects" },
    );
    await h.submitRemove();
    const post = h.requests.find((r) => r.url.includes("/remove"))!;
    expect(post.init.method).toBe("POST");
    expect(String(post.init.body)).toContain("confirm=atlasaurus");
    expect((post.init.headers as Record<string, string>).accept).toBe("application/json");
    // The panel is markup the server owns, and what changed is which
    // projects are in it — so the page is asked again, with the
    // reader's own query string. THIS page: no route name is written
    // down on either side of the move (spec 115).
    expect(h.location.href).toBe("/projects?state=running&sort=cost");
  });

  test("a refusal is written beside the form, and the page stays put", async () => {
    const h = harness(() => ({
      ok: false,
      body: { ok: false, results: [{ step: "confirm", error: 'type the project name exactly' }] },
    }));
    await h.submitRemove();
    expect(h.removeSlot.textContent).toContain("type the project name exactly");
    expect(h.location.href).toBe("http://dash.test/");
    expect(h.replaced).toHaveLength(0);
  });
});

// --- spec 115: the same code on a page with no spec list ---------------------
//
// The Add form wears `newspecform` for its looks, and on `/` that was
// harmless: the real New-spec form came first in the document, so
// `querySelector` found it. On `/projects` there is no New-spec form at
// all — the Add form would answer in its place and be bound twice, once
// as a project change and once as a spec create, sending two POSTs for
// one press.
describe("on /projects, where there is no New-spec form", () => {
  /** Enough of a matcher for the two selectors the file uses: every
   *  `.class` in the compound has to be on the element, and none of the
   *  `:not(.class)` ones may be. */
  const matches = (selector: string, className: string): boolean => {
    const classes = className.split(/\s+/);
    const negated = [...selector.matchAll(/:not\(\.([\w-]+)\)/g)].map((m) => m[1]!);
    const required = [...selector.replace(/:not\([^)]*\)/g, "").matchAll(/\.([\w-]+)/g)].map((m) => m[1]!);
    return required.every((c) => classes.includes(c)) && !negated.some((c) => classes.includes(c));
  };

  test("the Add form is bound once — as a project change, not also as a create", () => {
    const bound: string[] = [];
    const addForm = {
      className: "newspecform addprojectform",
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: (type: string) => void bound.push(type),
    };
    const document = {
      getElementById: () => null,
      querySelector: (sel: string) => (matches(sel, addForm.className) ? addForm : null),
      querySelectorAll: (sel: string) =>
        sel.includes("addprojectform") || sel.includes("removeform") ? [addForm] : [],
      createElement: () => ({ id: "", className: "", textContent: "" }),
      addEventListener: () => {},
      visibilityState: "hidden",
    };
    // eslint-disable-next-line no-new-func -- the file under test IS a script
    new Function(
      "document", "location", "fetch", "setInterval", "history", "FormData", "EventSource",
      SOURCE,
    )(
      document,
      { search: "", href: "http://dash.test/projects", pathname: "/projects" },
      async () => ({ ok: true, json: async () => ({}), text: async () => "" }),
      () => 0,
      { replaceState: () => {} },
      class {
        forEach(): void {}
      },
      class {
        addEventListener(): void {}
        close(): void {}
      },
    );
    expect(bound).toEqual(["submit"]);
  });
});

// --- spec 169: one action sets every phase still ahead ----------------------

// The row's AI select is gone. It posted nothing and chose nothing: all
// it did was hide the other tool's models from the five phase selects,
// which is exactly what stopped anyone discovering that a row CAN run
// analyze on one CLI and implement on another.
//
// What takes its slot is the convenience the filter was really standing
// in for — one action instead of five — done the way round that does
// not take anything away: it WRITES the five selects rather than
// hiding half of each.
//
// It writes only the phases still AHEAD. A phase that has run shows
// what it ran on, which is history rather than a suggestion, and the
// server marks those selects `data-ran="1"` so the two can never
// disagree about where the tail starts.
describe("an AI picked on a phase line fills that phase's model (spec 179)", () => {
  const values = (h: ReturnType<typeof harness>) => h.modelSelects.map((s) => s.value);
  const tools = (h: ReturnType<typeof harness>) => h.aiSelects.map((s) => s.value);

  test("nothing is written until the reader picks an AI", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    expect(values(h)).toEqual(["sonnet", "fable", "sonnet", "codex-fast", "sonnet"]);
    expect(tools(h)).toEqual(["claude", "claude", "claude", "codex", "claude"]);
  });

  // The value written is the one the SERVER worked out and put on the
  // option (`data-default`). Which model an AI stands for is a
  // configuration fact, and the browser copies it rather than deciding
  // between the tool's models itself.
  test("picking an AI writes that phase's model, and no other phase's", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeAi(1, "codex"); // analyze
    expect(values(h)).toEqual(["sonnet", "codex-fast", "sonnet", "codex-fast", "sonnet"]);
  });

  // A phase that has RUN is no exception. The removed set-all control
  // left it alone because one action wrote five selects and could not
  // ask; this is the reader picking on that line, and a rerun on
  // another AI is exactly what the line is for.
  test("a phase with history is written like any other", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeAi(1, "codex"); // analyze, which carries data-ran="1"
    expect(values(h)[1]).toBe("codex-fast");
  });

  test("picking Claude Code fills a Claude model in just as well", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeAi(3, "claude"); // implement, drawn on codex-fast
    expect(values(h)).toEqual(["sonnet", "fable", "sonnet", "sonnet", "sonnet"]);
    // And nothing is hidden by any of it: every model stays on offer
    // in every select, which is what spec 169 removed the filter for.
    for (const select of h.modelSelects) {
      expect([select.name, select.options.some((o) => o.hidden)]).toEqual([select.name, false]);
    }
  });

  // The pairing is `data-ai` plus the shared form id, because the
  // selects are written outside the form's own tags and tied to it by
  // that attribute alone — the row is not a container that holds them.
  test("another row's model select is left alone", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeAi(1, "codex");
    expect(h.otherRowSelect.value).toBe("fable");
  });

  // Delegated on #jobrows, like every other control on the table: the
  // rows are replaced wholesale every five seconds, and a listener
  // bound to the select itself would last exactly one tick.
  test("it answers a change on the container, and ignores every other one", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeOther();
    expect(values(h)).toEqual(["sonnet", "fable", "sonnet", "codex-fast", "sonnet"]);
    h.changeAi(0, "codex");
    expect(values(h)[0]).toBe("codex-fast");
  });

  // Setting `.value` from script fires no `change` event, so the
  // per-select "remember what a hand touched" map is not written by the
  // browser on this path — `applyAiPick` has to write it itself.
  // Without that, the five-second swap puts the server's markup back
  // and the phase this just set silently reverts, with a press
  // afterwards starting the step on a model nobody chose.
  test("what an AI pick wrote survives the five-second swap", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    h.changeAi(1, "codex");
    h.document.visibilityState = "visible";
    h.tick();
    await flush();

    expect(h.rows.innerHTML).toBe("<tr>fresh</tr>");
    expect(values(h)).toEqual(["sonnet", "codex-fast", "sonnet", "codex-fast", "sonnet"]);
    // And the AI select the swap just redrew says the same thing the
    // model select does. It carries no memory of its own — it is set
    // from the model that was restored, which is what keeps the two
    // from ever disagreeing.
    expect(tools(h)).toEqual(["claude", "codex", "claude", "codex", "claude"]);
  });

  test("a chosen MODEL survives it too, and an untouched one is the server's", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    // One phase moved by hand; the other four left exactly as drawn.
    h.changeModel(1, "sonnet");
    h.document.visibilityState = "visible";
    h.tick();
    await flush();

    expect(values(h)).toEqual(["sonnet", "sonnet", "sonnet", "codex-fast", "sonnet"]);
  });

  // The tool is DERIVED from the model, in both directions of travel:
  // a reader who goes straight to the model select, ignoring the AI
  // picker beside it, must not be left with a line that says Claude
  // Code over a Codex model until the next swap comes to fix it.
  test("changing the model by hand moves its own AI select at once", () => {
    const h = harness(() => ({ ok: true, body: { ok: true } }));
    h.changeModel(0, "codex-fast");
    expect(tools(h)).toEqual(["codex", "claude", "claude", "codex", "claude"]);
    h.changeModel(3, "fable");
    expect(tools(h)).toEqual(["codex", "claude", "claude", "claude", "claude"]);
  });

  test("a swap nobody has touched a select on is left to the server", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    h.document.visibilityState = "visible";
    h.tick();
    await flush();

    // The point of restoring only what a hand moved: a phase that has
    // RUN shows the model it ran on, and the swap is what delivers it.
    expect(values(h)).toEqual(["sonnet", "fable", "sonnet", "codex-fast", "sonnet"]);
    expect(tools(h)).toEqual(["claude", "claude", "claude", "codex", "claude"]);
  });

  // The AI select has no `name`, so the generic "remember every select"
  // branch would file every one of them under the same key — the form
  // id and an empty string — and the last one touched would decide the
  // lot. It is intercepted before that branch, and nothing about it is
  // remembered at all.
  test("the AI select is not filed in the map the model selects use", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    h.changeAi(1, "codex");
    h.document.visibilityState = "visible";
    h.tick();
    await flush();

    // Only analyze moved. Had the AI select been remembered under the
    // shared key, the restore would have written it across the row.
    expect(values(h)).toEqual(["sonnet", "codex-fast", "sonnet", "codex-fast", "sonnet"]);
  });
});

// --- spec 141: the phase boxes survive the swap too --------------------------
//
// The 2026-08-20 fix above covered the row's SELECTS. The boxes beside
// them were left out, and they are what a press actually runs: tick
// implement and archive, wait six seconds, press Run — and the job
// started whatever the server had ticked, without a word. The server
// re-derives its ticks from the row's history (`preTicked`) on every
// render, so a swap is not a no-op for them; it is an overwrite.
describe("a hand-ticked phase box survives the five-second swap (spec 141)", () => {
  const ticks = (h: ReturnType<typeof harness>) => h.stepBoxes.map((b) => b.checked);

  const swap = async (h: ReturnType<typeof harness>) => {
    h.document.visibilityState = "visible";
    h.tick();
    await flush();
  };

  // The button says what a press would run, and a press runs the BOXES
  // — so the label has to follow them as they are clicked. The server
  // names it from `preTicked`, its own suggestion, which is right for
  // the row as drawn and wrong the moment a reader ticks something
  // else: on 2026-08-21 spec 162, with analyze suggested and only
  // `archive` ticked by hand, went on offering "Analyze". The press was
  // correct — an open row posts its boxes and no hidden steps — but the
  // row said one thing and did another.
  test("the button names the first ticked phase as the boxes are clicked", () => {
    const h = harness(() => ({ ok: true }));
    expect(h.runButton.textContent).toBe("Run");

    h.changeStep(0, false); // analyze off — review-plan is first now
    expect(h.runButton.textContent).toBe("Review");

    h.changeStep(1, false); // and off — nothing ticked at all
    expect(h.runButton.hidden).toBe(true);

    h.changeStep(3, true); // archive alone
    expect(h.runButton.hidden).toBe(false);
    expect(h.runButton.textContent).toBe("Archive");
  });

  test("a box the reader ticked is still ticked after the swap", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    h.changeStep(2, true); // implement
    h.changeStep(3, true); // archive
    await swap(h);

    expect(h.rows.innerHTML).toBe("<tr>fresh</tr>");
    expect(ticks(h)).toEqual([true, true, true, true]);
  });

  // A hand-made "off" is as much a choice as a hand-made "on": the
  // server had these two ticked, and the reader said no to one.
  test("a box the reader unticked stays unticked", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    h.changeStep(1, false); // review-plan, which the server pre-ticked
    await swap(h);

    expect(ticks(h)).toEqual([true, false, false, false]);
  });

  test("a row nobody has touched keeps the ticks the server drew", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    await swap(h);

    expect(ticks(h)).toEqual([true, true, false, false]);
  });

  // The boxes share one `name`, so a key built the way a select's is
  // would file all four under `form|steps` and the last tick would
  // decide the lot.
  test("each box is remembered on its own, not one answer for the row", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    h.changeStep(0, false); // analyze off
    h.changeStep(3, true); // archive on
    await swap(h);

    expect(ticks(h)).toEqual([false, true, false, true]);
  });

  // The two maps must not spill into each other: a tick is not a value
  // the model selects can be restored from, and vice versa.
  test("ticking a box leaves the row's selects to the server", async () => {
    const h = harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));
    h.changeStep(2, true);
    await swap(h);

    expect(h.aiSelects.map((s) => s.value)).toEqual([
      "claude", "claude", "claude", "codex", "claude",
    ]);
    expect(h.modelSelects.map((s) => s.value)).toEqual([
      "sonnet", "fable", "sonnet", "codex-fast", "sonnet",
    ]);
  });
});

// --- spec 129: an answer older than the press never lands on top of it -------
//
// `inFlight` stops a NEW swap from STARTING while a press runs. It says
// nothing about one that was already in the air when the press began:
// that request carries the server's answer from BEFORE the press, and
// on resolving wrote it straight into `#jobrows` — over the busy button
// the press had just drawn, or over the refusal banner it had just
// asked for.
//
// The window is wide, not theoretical. Every `/?rows=1` answer waits on
// `isMerged()` for every branch of every listed job, and a cache miss
// there costs up to three sequential git calls at four seconds each —
// which is the 10-15 seconds of a pressed button sitting unchanged that
// was measured on 2026-08-20 (on the Merge button, which spec 149 later
// removed; the window it measured belongs to every control alike).
describe("a swap older than the press is discarded, not applied (spec 129)", () => {
  /** What the server said BEFORE the press, and what must never reach
   *  the page after it. */
  const STALE = "<tr>before the press</tr>";
  /** What it says once the press is accounted for. */
  const FRESH = "<tr>after the press</tr>";

  test("a tick's answer arriving mid-press does not put the untouched row back", async () => {
    let releaseTick: () => void = () => {};
    const tickHeld = new Promise<void>((r) => (releaseTick = r));
    let releasePress: () => void = () => {};
    const pressHeld = new Promise<void>((r) => (releasePress = r));
    const h = harness((url) =>
      url.includes("/cancel")
        ? { ok: true, body: OK_ACTION, hold: pressHeld }
        : { ok: true, text: STALE, hold: tickHeld },
    );
    h.document.visibilityState = "visible";
    // The tick goes first and its answer is held open — nothing about
    // this request will ever know a press happened.
    h.tick();
    await Promise.resolve();
    expect(h.requests.filter((r) => r.url.includes("rows=1"))).toHaveLength(1);
    // Then the press, while that request is still in the air.
    const pressed = h.submit();
    await Promise.resolve();
    expect(h.button.classList.contains("busy")).toBe(true);
    // Now the tick answers, with the row exactly as it was before.
    releaseTick();
    await flush();
    // Writing that into #jobrows is what replaced the busy button with
    // the untouched one the server still believed in.
    expect(h.rows.innerHTML).toBe("");
    expect(h.button.classList.contains("busy")).toBe(true);
    releasePress();
    await pressed;
  });

  test("a tick's answer arriving after a refusal does not wipe the reason", async () => {
    let releaseTick: () => void = () => {};
    const tickHeld = new Promise<void>((r) => (releaseTick = r));
    const REFUSED = {
      ok: false,
      spec: "aide/129-the-merge-button-answers-the-press",
      error: "cannot fast-forward main in /repos/aide — resolve it first",
    };
    const h = harness((url) => {
      if (url.includes("/cancel")) return { ok: true, body: REFUSED };
      // The refusal's OWN swap asks with the reason in the query
      // string (`showRefusal` put it there): that answer is the current
      // one, and it is the one that must survive.
      if (url.includes("errorSpec")) return { ok: true, text: FRESH };
      return { ok: true, text: STALE, hold: tickHeld };
    });
    h.document.visibilityState = "visible";
    h.tick();
    await Promise.resolve();
    await h.submit();
    expect(h.rows.innerHTML).toBe(FRESH);
    // The tick finally answers — from before the press was even made.
    releaseTick();
    await flush();
    expect(h.rows.innerHTML).toBe(FRESH);
  });

  // The guard must discard a STALE answer and nothing else: a tick that
  // raced nobody still has to redraw the table, which is the whole
  // reason the tick exists.
  test("with no press racing it, the tick's answer lands as it always did", async () => {
    const h = harness(() => ({ ok: true, text: STALE }));
    h.document.visibilityState = "visible";
    h.tick();
    await flush();
    expect(h.rows.innerHTML).toBe(STALE);
  });
});

// --- spec 138: a successful Add has something to say -------------------------
//
// The Add form used to navigate on success, exactly like Remove, and the
// answer went with it: the server had worked out whether a run could
// start in the project just added, and the browser threw that away in
// `location.href = "/projects"`. Skjer was added on 2026-08-20 and looked
// added; the reasons it could not run were in a response body nobody ever
// saw.
describe("the Add form keeps the readiness answer on screen", () => {
  const READY = {
    ok: true,
    project: "skjer",
    results: [{ step: "name", ok: true }],
    readiness: { canRun: true, note: "skjer added — ready to run", checks: [] },
  };
  const BLOCKED = {
    ok: true,
    project: "skjer",
    results: [{ step: "name", ok: true }],
    readiness: {
      canRun: false,
      note:
        "skjer added — cannot run yet: the tree at /repos/skjer is dirty (.aide/); " +
        "no specs root at /repos/skjer/specs",
      checks: [],
    },
  };

  // Criterion 11, the JavaScript half: every blocker in the answer, on
  // the page the reader pressed Save on — which is also the page whose
  // Specs root and Worktree links fields are what usually fix it.
  test("every blocker in the answer is written beside the form, and the page stays put", async () => {
    const h = harness(() => ({ ok: true, body: BLOCKED }));
    await h.submitAdd();
    expect(h.addSlot.textContent).toContain("cannot run yet");
    expect(h.addSlot.textContent).toContain(".aide/");
    expect(h.addSlot.textContent).toContain("/repos/skjer/specs");
    expect(h.addSlot.className).toBe("refused rowmsg warn");
    expect(h.location.href).toBe("http://dash.test/");
  });

  test("a project that CAN run says so, in the same place", async () => {
    const h = harness(() => ({ ok: true, body: READY }));
    await h.submitAdd();
    expect(h.addSlot.textContent).toContain("ready to run");
    // Not the colour of a refusal: the project can run.
    expect(h.addSlot.className).toBe("refused rowmsg info");
    expect(h.location.href).toBe("http://dash.test/");
  });

  // A Remove carries no readiness — there is nothing to be ready — so it
  // still returns to the list it changed.
  test("a removal still returns to the list, because it has no such answer", async () => {
    const h = harness(
      () => ({ ok: true, body: { ok: true, results: [{ step: "confirm", ok: true }] } }),
      "actionform",
      "",
      { pathname: "/projects" },
    );
    await h.submitRemove();
    expect(h.location.href).toBe("/projects");
  });
});

// --- spec 160: a tail box posts on its own -------------------------------------

// While a job runs, the boxes for phases it has not reached stay live.
// There is no Run button on a busy row to submit them with — the row
// shows Cancel — and posting to `/api/queue` would ask for a SECOND
// job, which the clash check refuses outright. So the tick is the
// press: it goes to the running job's own route, the moment it happens.
describe("a tail box's tick posts itself (spec 160)", () => {
  const OK = { ok: true, job: { id: "job-1" } };

  test("it posts the tick to the job's own route, not to /api/queue", async () => {
    const h = harness(() => ({ ok: true, body: OK }));
    await h.changeTail(true);
    const posted = h.requests.find((r) => r.url.includes("/steps"))!;
    expect(posted.url).toContain("/api/queue/job-1/steps");
    expect(posted.init.method).toBe("POST");
    expect(String(posted.init.body)).toContain("step=archive");
    expect(String(posted.init.body)).toContain("checked=1");
    // The token rides in the query string, as every other press does.
    expect(posted.url).toContain("token=s3cret");
    // And never the create route.
    expect(h.requests.some((r) => r.url.endsWith("/api/queue"))).toBe(false);
  });

  test("unticking says so", async () => {
    const h = harness(() => ({ ok: true, body: OK }));
    await h.changeTail(false);
    expect(String(h.requests[0]!.init.body)).toContain("checked=0");
  });

  // Spec 151's rule, applied to a control that is not a button: the
  // whole row locks the instant the tick lands, and stays locked until
  // the row has been redrawn from the server's own answer.
  test("the row locks at once and is redrawn from the answer (criterion 7)", async () => {
    let atRequest = { run: false, box: false, tail: false, cancel: false, otherRow: false };
    let atRedraw = false;
    const h = harness((url) => {
      if (url.includes("/steps")) {
        atRequest = {
          run: h.runButton.disabled,
          box: h.stepBoxes[0]!.disabled,
          tail: h.tailBox.disabled,
          cancel: h.cancelButton.disabled,
          otherRow: h.otherRowSelect.disabled,
        };
      }
      if (url.includes("rows=1")) atRedraw = h.runButton.disabled;
      return { ok: true, body: OK };
    });
    await h.changeTail(true);
    expect(atRequest).toEqual({ run: true, box: true, tail: true, cancel: true, otherRow: false });
    // Still locked when the redraw is asked for — not merely until the
    // answer arrived.
    expect(atRedraw).toBe(true);
    expect(h.rows.innerHTML).not.toBe("");
    expect(h.runButton.disabled).toBe(false);
  });

  // A refusal has to be visible on the box itself: the tick showed the
  // step as added, and the server did not add it.
  test("a refused tick is put back, and the reason is shown (criterion 7)", async () => {
    let checkedWhenRedrawn: boolean | undefined;
    const h = harness((url) => {
      if (url.includes("/steps")) {
        return { ok: false, body: { error: "archive is not an editable step on this job" } };
      }
      if (url.includes("rows=1")) checkedWhenRedrawn = h.tailBox.checked;
      return { ok: true };
    });
    await h.changeTail(true);
    // Put back BEFORE the row is re-asked for, so a redraw that never
    // comes still leaves the box telling the truth.
    expect(checkedWhenRedrawn).toBe(false);
    expect(h.replaced.join("")).toContain(encodeURIComponent("not an editable step"));
    // And the row is live again.
    expect(h.tailBox.disabled).toBe(false);
    expect(h.runButton.disabled).toBe(false);
  });

  test("a request that cannot be sent reloads the page, as every other press does", async () => {
    const h = harness(() => ({ ok: false, throws: true }));
    await h.changeTail(true);
    expect(h.location.href).toBe("/");
  });
});

// --- spec 189: the page changes when something changes -----------------------

// The five-second timer is gone. The page holds one connection open and
// redraws when the server says something moved — so a reader with the
// browser's own tools open can hold still on a row, and a step that
// finishes shows up at once rather than up to five seconds later.
describe("the rows are redrawn on a push, not on a timer (spec 189)", () => {
  const rowFetches = (h: ReturnType<typeof harness>) =>
    h.requests.filter((r) => r.url.includes("rows=1"));

  const fresh = () => harness(() => ({ ok: true, text: "<tr>fresh</tr>" }));

  test("the page registers no repeating timer at all (criterion 1)", () => {
    const h = fresh();
    h.visibility("visible");
    expect(h.intervals).toEqual([]);
  });

  test("a visible page opens one connection to the event stream", () => {
    const h = fresh();
    h.visibility("visible");
    expect(h.sources).toHaveLength(1);
    expect(h.sources[0]!.url).toContain("/api/queue/events");
  });

  // The address bar carries the token on the first load of a bookmarked
  // page, and `EventSource` has no other way to send one — it cannot set
  // a header, and the cookie is not there yet.
  test("the connection carries the page's own query string", () => {
    const h = harness(() => ({ ok: true }), "actionform", "?token=abc&state=active");
    h.visibility("visible");
    expect(h.sources[0]!.url).toBe("/api/queue/events?token=abc&state=active");
  });

  // Criterion 1, said the only way it can be said: with the connection
  // open and nobody sending anything, the page does not fetch rows.
  test("an idle connected page fetches nothing and redraws nothing (criterion 1)", async () => {
    const h = fresh();
    h.visibility("visible");
    await flush();
    expect(rowFetches(h)).toHaveLength(0);
    expect(h.rows.innerHTML).toBe("");
  });

  test("a `changed` event redraws the rows (criterion 2)", async () => {
    const h = fresh();
    h.visibility("visible");
    h.live()!.emit("changed");
    await flush();
    expect(rowFetches(h)).toHaveLength(1);
    expect(h.rows.innerHTML).toBe("<tr>fresh</tr>");
  });

  // `open` fires on the first connect AND on every reconnect the
  // browser makes on its own — after a dropped network, after the
  // server was restarted under the page. Resyncing there is what makes
  // criteria 4 and 5 self-healing without anyone reloading.
  test("`open` resyncs, so a reconnect picks up what was missed", async () => {
    const h = fresh();
    h.visibility("visible");
    h.live()!.emit("open");
    await flush();
    expect(rowFetches(h)).toHaveLength(1);

    // The same connection object, opened again: what the browser does
    // after it has retried by itself.
    h.live()!.emit("open");
    await flush();
    expect(rowFetches(h)).toHaveLength(2);
  });

  // The guard the five-second tick had, for the reason it had it: the
  // server still shows the OLD state until the press answers, so a swap
  // in that window puts an untouched button back over the "cancelling…"
  // the press just drew.
  test("a `changed` event during a press does not swap the rows (criterion 6)", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const h = harness((url) =>
      url.includes("/cancel") ? { ok: true, body: OK_ACTION, hold: held } : { ok: true },
    );
    h.visibility("visible");
    const pressed = h.submit();
    await Promise.resolve();
    h.live()!.emit("changed");
    await flush();
    expect(rowFetches(h)).toHaveLength(0);
    expect(h.button.classList.contains("busy")).toBe(true);
    release();
    await pressed;
    // The press's own follow-up swap is what redraws the row.
    expect(rowFetches(h)).toHaveLength(1);
    // And a push after it is answered again.
    h.live()!.emit("changed");
    await flush();
    expect(rowFetches(h)).toHaveLength(2);
  });

  // Nobody is reading a hidden tab, and the mini has better things to do
  // than hold a socket for a closed laptop — the same reason the timer
  // used to skip while hidden, applied to the connection itself.
  test("a hidden tab holds no connection and fetches nothing (criterion 7)", async () => {
    const h = fresh();
    h.visibility("visible");
    const first = h.live()!;
    h.visibility("hidden");
    expect(first.closed).toBe(true);
    expect(h.live()).toBeNull();
    await flush();
    expect(rowFetches(h)).toHaveLength(0);
  });

  test("a page that loads hidden never opens one", () => {
    const h = fresh();
    expect(h.sources).toHaveLength(0);
  });

  test("becoming visible again opens a fresh connection and resyncs (criterion 8)", async () => {
    const h = fresh();
    h.visibility("visible");
    h.visibility("hidden");
    h.visibility("visible");
    expect(h.sources).toHaveLength(2);
    expect(h.live()).not.toBeNull();
    // The resync is the `open` the fresh connection reports.
    h.live()!.emit("open");
    await flush();
    expect(rowFetches(h)).toHaveLength(1);
    expect(h.rows.innerHTML).toBe("<tr>fresh</tr>");
  });

  test("a visible page told it is visible again does not stack connections", () => {
    const h = fresh();
    h.visibility("visible");
    h.visibility("visible");
    expect(h.sources).toHaveLength(1);
  });
});
