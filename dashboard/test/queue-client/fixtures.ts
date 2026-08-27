// Shared DOM/fetch harness for the queue-client.test.ts split (3096
// lines, 20 describe blocks) into test/queue-client/, one file per
// theme. `queue-client.ts` cannot be imported the way an ordinary
// module is (the server bundles it into an inline classic <script>),
// so this harness bundles it the same way the server does
// (`queueClientScript` in serve-helpers.ts) and runs the result against
// a fake document instead — see the file this was cut from for the
// full rationale.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const RAW = readFileSync(join(import.meta.dir, "..", "..", "src", "queue-client.ts"), "utf-8");
const built = await Bun.build({
  entrypoints: [join(import.meta.dir, "..", "..", "src", "queue-client.ts")],
  target: "browser",
  format: "iife",
});
if (!built.success) throw new AggregateError(built.logs, "queue-client.ts failed to bundle for the test harness");
export const SOURCE = await built.outputs[0]!.text();

export interface Reply {
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
export const CONTROLS: Record<
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
export function classes(el: { className: string }) {
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

/** One `<tr>` of the fake `#jobrows` (spec 204). Only the surface the
 *  per-group diff actually calls — an anchor's id, the class that says
 *  where a group ends, the walk to the next row, and the two mutations
 *  that replace a group's range. */
export interface FakeRow {
  html: string;
  readonly id: string;
  readonly className: string;
  readonly nextElementSibling: FakeRow | null;
  readonly parentNode: { insertAdjacentHTML(where: string, html: string): void };
  remove(): void;
  insertAdjacentHTML(where: string, html: string): void;
}

/** The rows of `#jobrows` as OBJECTS, beside the string they came from.
 *  A row the redraw left alone is the same object afterwards, which is
 *  what a test asserts with `toBe` — the property that decides whether a
 *  reader's press survives a redraw, and the one thing a string could
 *  never carry.
 *
 *  `onMutate` is what a browser does for free: the selects in a replaced
 *  row are new elements drawn from the server's answer, so the fake's
 *  own selects go back to what the server would have rendered. */
export function fakeTbody(onMutate: () => void) {
  let prefix = "";
  let suffix = "";
  let list: FakeRow[] = [];

  const attr = (html: string, name: string): string =>
    new RegExp(`\\b${name}="([^"]*)"`).exec(html)?.[1] ?? "";

  const make = (html: string): FakeRow => {
    const row: FakeRow = {
      html,
      get id(): string {
        return attr(row.html, "id");
      },
      get className(): string {
        return attr(row.html, "class");
      },
      get nextElementSibling(): FakeRow | null {
        const at = list.indexOf(row);
        return at === -1 ? null : (list[at + 1] ?? null);
      },
      get parentNode() {
        return body;
      },
      remove(): void {
        const at = list.indexOf(row);
        if (at !== -1) list.splice(at, 1);
        onMutate();
      },
      insertAdjacentHTML(where: string, fragment: string): void {
        const at = list.indexOf(row);
        if (at === -1) return;
        list.splice(where === "beforebegin" ? at : at + 1, 0, ...cut(fragment));
        onMutate();
      },
    };
    return row;
  };

  /** A fragment of markup into rows, one per `</tr>`. */
  const cut = (html: string): FakeRow[] => {
    const out: FakeRow[] = [];
    let at = 0;
    for (;;) {
      const end = html.indexOf("</tr>", at);
      if (end === -1) break;
      out.push(make(html.slice(at, end + "</tr>".length)));
      at = end + "</tr>".length;
    }
    return out;
  };

  const body = {
    insertAdjacentHTML(where: string, fragment: string): void {
      const made = cut(fragment);
      if (where === "beforeend") list.push(...made);
      else list.unshift(...made);
      onMutate();
    },
  };

  return {
    /** The string `innerHTML` hands back — the one it was given, unless
     *  something has since moved a row. */
    html: (): string => prefix + list.map((r) => r.html).join("") + suffix,
    parse(html: string): void {
      const open = html.indexOf("<tbody>");
      const close = html.lastIndexOf("</tbody>");
      if (open === -1 || close === -1 || close < open) {
        // No table in it: the markup most of this file's tests use.
        // Kept whole, so they see the string they always saw.
        prefix = html;
        suffix = "";
        list = [];
        return;
      }
      const start = open + "<tbody>".length;
      prefix = html.slice(0, start);
      const content = html.slice(start, close);
      list = cut(content);
      // Whatever the split could not account for travels with the
      // suffix, so nothing is lost on the way back out.
      suffix = content.slice(list.map((r) => r.html).join("").length) + html.slice(close);
    },
    /** The FIRST row wearing this id, the way `getElementById` answers. */
    byId: (id: string): FakeRow | null => list.find((r) => r.id === id) ?? null,
    ids: (): string[] => list.map((r) => r.id),
  };
}

/** One button in one form in `#jobrows`, the New-spec form beside it,
 *  and the globals the file actually touches. Nothing here pretends to
 *  be a browser: it answers the handful of questions the code asks, and
 *  records what it was asked to do. */
export function harness(
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
  const modelSelect = (step: string, chosen: string, ran = false, live = false) => {
    const options = MODELS.map(([value, tool]) => ({
      value,
      dataset: { tool },
      hidden: false,
      // The client hides an option AND disables it: hidden so the list
      // does not offer it, disabled so a post cannot carry it.
      disabled: false,
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
      // Spec 225: a phase the running job has not reached keeps its
      // model select live, and the route it posts to is on the select
      // itself — the same attribute the tail box carries.
      getAttribute: (n: string) =>
        n === "form" ? ROW_FORM : n === "data-post-to" && live ? "/api/queue/job-1/model" : null,
      // A change lands on the select itself, and the handler walks up
      // with `closest`. A model select is NOT an AI select and not a
      // phase box, so it answers those selectors with null and its own
      // with itself. `data-post-to` is asked in two shapes: the tail
      // BOX's `input[data-post-to]` (never this) and, since spec 225,
      // a live model select's own `select[data-post-to]`.
      closest: (sel: string): unknown =>
        sel.includes("data-ai") || sel.includes('name="steps"')
          ? null
          : sel.includes("data-post-to")
            ? (live && sel.includes("select") ? self : null)
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
  // One phase with history and three still ahead — the mixed row
  // "set all" is scoped against (spec 169).
  const modelSelects = [
    modelSelect("create", "sonnet"),
    modelSelect("analyze", "fable", true),
    modelSelect("implement", "codex-fast"),
    // Spec 225: the phase the running job has not reached — the one
    // whose selects stay live, exactly where `tailBox` is.
    modelSelect("archive", "sonnet", false, true),
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
    aiSelect("implement", "codex"),
    aiSelect("archive", "claude"),
  ];
  // Spec 141: the row's phase boxes. They share one `name` — the step
  // is in the VALUE — which is why what is remembered about them is
  // keyed on three parts and not the two a select needs. `create` has
  // no box (a spec that exists cannot be created again), so the three
  // that can be run are the three that are here.
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
      // read off. Since spec 181 no step is called anything other than
      // its own value, so the two say the same thing.
      getAttribute: (n: string) =>
        n === "form" ? ROW_FORM : n === "aria-label" ? value : null,
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
    // Every real form element has one; spec 184's proposal binding reads
    // it, and an empty one is what a page with nothing to propose sends.
    dataset: {} as Record<string, string>,
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
    dataset: {} as Record<string, string>,
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
  const redrawControls = (): void => {
    for (const a of aiSelects) a.redraw();
    for (const m of modelSelects) m.redraw();
    otherRowSelect.redraw();
    for (const b of stepBoxes) b.redraw();
    tailBox.redraw();
  };
  // Spec 204: `#jobrows` is a STRING here and a tree of nodes in the
  // browser, and the difference is the whole of what this spec has to
  // prove — a row nobody's redraw touched is the same object before and
  // after, which is why the click a reader made on it is delivered. A
  // string has no identity to keep or lose, so the fake grows one:
  // every `<tr>` inside the fetched markup's `<tbody>` becomes an object
  // that survives until something removes it.
  //
  // Additive, deliberately. `innerHTML` still reads and writes the whole
  // string byte for byte (the parse below puts every character back
  // where it found it), so every assertion in this file that reads
  // `h.rows.innerHTML` keeps seeing exactly what it saw before.
  const table = fakeTbody(redrawControls);
  // Spec 208: the container itself carries the "something was clicked
  // and the answer is not here yet" look, so the fake grows the one
  // thing a class can be read off.
  const rowsClass = { className: "" };
  // Spec 226: the list scrolls in `.tablewrap`, and how far down it is
  // scrolled has to survive the five-second refresh. The wrapper is a
  // NEW element after a wholesale replace — the browser threw the old
  // subtree away — so the fake makes a new object with `scrollTop` back
  // at 0 whenever `innerHTML` is written. Without that, a test could
  // not tell "the position was restored" from "nothing ever moved it".
  let wrap = { scrollTop: 0 };
  const rows = {
    get className(): string {
      return rowsClass.className;
    },
    set className(v: string) {
      rowsClass.className = v;
    },
    classList: classes(rowsClass),
    get innerHTML(): string {
      return table.html();
    },
    set innerHTML(html: string) {
      table.parse(html);
      wrap = { scrollTop: 0 };
      redrawControls();
    },
    querySelector: (sel: string) => (sel.includes("tablewrap") ? wrap : null),
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
  type Listener = (e: unknown) => void | Promise<void>;
  const on: Record<string, Listener> = {};
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

  /** The running-phase marks the page's own clock rewrites (spec 199).
   *  Re-queried on every tick by the code under test, so a test can add
   *  or remove one between ticks and see the difference — which is what
   *  proves the clock survives `#jobrows` being swapped out under it. */
  const elapsed: { dataset: { elapsed: string }; textContent: string }[] = [];

  const document = {
    // Spec 204: a row's own anchor id resolves too. `rowAnchorId()` is
    // already on every head row for the sake of `href="#..."`, and the
    // per-group diff reaches a group through it — so a fake that
    // answered only `"jobrows"` could not run the code under test at
    // all.
    getElementById: (id: string) => (id === "jobrows" ? rows : table.byId(id)),
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
      // Asked FIRST: it names no form and no class, so every branch
      // below would answer it with the empty list.
      sel.includes("data-elapsed")
        ? elapsed
        : sel.includes("removeform")
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

  /** Every timer the page asks for, with the work it would do. Spec 189
   *  took the five-second POLL away and nothing may put it back; spec
   *  199 adds one that touches nothing but the text of the marks it
   *  owns, so what is recorded is both the cadence and the callback —
   *  a test can then run a tick by hand and say what it did. */
  const intervals: number[] = [];
  const ticks: (() => void)[] = [];

  /** The wall clock the page reads, so a tick's answer is a stated
   *  fact rather than whatever the machine's own clock said. `Date` is
   *  a global in the browser, which is exactly what makes it injectable
   *  here — the same trick `EventSource` and `FormData` already use. */
  const clock = { at: Date.parse("2026-08-23T12:00:00Z") };
  const FakeDate = { now: () => clock.at, parse: (iso: string) => Date.parse(iso) };

  // eslint-disable-next-line no-new-func -- the file under test IS a script
  new Function(
    "document", "location", "fetch", "setInterval", "history", "FormData", "EventSource", "Date",
    SOURCE,
  )(
    document,
    location,
    fetchStub,
    (fn: () => void, ms: number) => {
      intervals.push(ms);
      ticks.push(fn);
      return 0;
    },
    history,
    FakeFormData,
    FakeEventSource,
    FakeDate,
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
    return on[listener]!(event);
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
  /** A real navigation — the spec's own name, and the tab bar's links
   *  (spec 208). Both leave the page for a different document, so
   *  neither goes through `swapRows`; what they need is for the click
   *  to stop being invisible. `data-goto` is the marker, and the
   *  listener is on the DOCUMENT because the tab bar sits outside
   *  `#jobrows`. */
  const gotoLink = (href: string) => {
    const el = { className: "", getAttribute: (n: string) => (n === "href" ? href : null) } as {
      className: string;
      getAttribute: (n: string) => string | null;
      closest: (sel: string) => unknown;
      classList: ReturnType<typeof classes>;
    };
    el.closest = (sel: string) => (sel.includes("data-goto") ? el : null);
    el.classList = classes(el);
    return el;
  };
  const clickGoto = (el: ReturnType<typeof gotoLink>, extra: Partial<{ defaultPrevented: boolean }> = {}) => {
    let prevented = extra.defaultPrevented ?? false;
    const event = {
      target: el,
      button: 0,
      get defaultPrevented() {
        return prevented;
      },
      preventDefault: () => {
        prevented = true;
      },
    };
    on["doc:click"]?.(event);
    return prevented;
  };

  return {
    /** The row node wearing that anchor id, right now (spec 204). The
     *  same object across a redraw is what proves the redraw left it
     *  alone; a different one proves it was replaced. */
    rowFor: (id: string) => table.byId(id),
    /** Every row's anchor id in the order they stand in. */
    rowIds: () => table.ids(),
    /** The list's scroll box as it stands right now (spec 226) — a new
     *  object after every wholesale replace, exactly as the browser's
     *  own element is. */
    wrap: () => wrap,
    submit, submitCreate, click, clickFold, gotoLink, clickGoto,
    button, createButton, requests, location, rows, inserted,
    replaced, slot, resets, document, phases, otherPhases, rowQueries, tick,
    sources: FakeEventSource.made, live, visibility, intervals, ticks, elapsed, clock,
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
      return on["change"]?.({ target: tailBox });
    },
    runButton, cancelButton,
    /** An AI picked on ONE phase line (spec 179) — the action that
     *  fills that phase's model in, and no other phase's. */
    changeAi: (index: number, tool: string) => {
      const select = aiSelects[index]!;
      select.value = tool;
      // Returned rather than dropped: on a LIVE line the pick posts
      // (spec 225), and a test has to be able to wait for it.
      return on["change"]?.({ target: select });
    },
    changeCreateAi: (index: number, tool: string) => {
      const select = aiSelects[index]!;
      select.value = tool;
      return on["create:change"]?.({ target: select });
    },
    /** One phase's model, moved by hand — the other half of what a
     *  swap must not wash away. */
    changeModel: (index: number, value: string) => {
      const select = modelSelects[index]!;
      select.value = value;
      return on["change"]?.({ target: select });
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
export const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

export const OK_ACTION = { ok: true, job: { id: "job-1" } };
/** Where `swapRows` asked for the rows, which is where the refusal the
 *  page is about to show comes from. */
export const swapUrl = (h: { requests: { url: string }[] }): string =>
  h.requests.map((r) => r.url).find((u) => u.startsWith("/?") && u.includes("rows=1")) ?? "";
