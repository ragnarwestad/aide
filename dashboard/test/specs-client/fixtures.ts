// Shared DOM/fetch harness for the specs-client.test.ts split (3096
// lines, 20 describe blocks) into test/specs-client/, one file per
// theme. `specs-client.ts` cannot be imported the way an ordinary
// module is (the server bundles it into an inline classic <script>),
// so this harness bundles it the same way the server does
// (`specsClientScript` in serve-helpers.ts) and runs the result against
// a fake document instead — see the file this was cut from for the
// full rationale.

import { join } from "node:path";
import { aiSelect, chip, classes, makeButton, modelSelect, stepCheckbox, tailBox, failedCheckbox, tickCheckbox, unverifiedCheckbox } from "./fixtures-controls.ts";
import { fakeTbody, type FakeRow } from "./fixtures-tbody.ts";
import { makeFakeDate, makeFakeEventSource, makeFakeFormData, makeFakeTimers } from "./fixtures-runtime.ts";
import { buildCreateForm, buildProjectsPanel } from "./fixtures-panels.ts";
import { buildNavigation, resolveDocumentQuerySelectorAll } from "./fixtures-events.ts";
import { followFakes } from "./fixtures-follow.ts";

const built = await Bun.build({
  entrypoints: [join(import.meta.dir, "..", "..", "src", "specs-client", "index.ts")],
  target: "browser",
  format: "iife",
});
if (!built.success) throw new AggregateError(built.logs, "specs-client/index.ts failed to bundle for the test harness");
export const SOURCE = await built.outputs[0]!.text();

export interface Reply {
  ok: boolean;
  body?: unknown;
  throws?: boolean;
  /** Hold the request open until this settles — for what happens
   *  WHILE a press is in flight. */
  hold?: Promise<void>;
  /** What a row-refresh answers with. Named per reply because the test
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
    label: "Run", pending: "Starting…", formClass: "rowrun", variant: "primary",
    action: "http://dash.test/api/queue",
  },
  actionform: {
    label: "Cancel", pending: "cancelling…", formClass: "actionform", variant: "primary",
    action: "http://dash.test/api/queue/job-1/cancel",
  },
};

export { classes };

export type { FakeRow };

/** One button in one form in `#jobrows`, the New-spec form beside it,
 *  and the globals the file actually touches. Nothing here pretends to
 *  be a browser: it answers the handful of questions the code asks, and
 *  records what it was asked to do. */
export function harness(
  reply: (url: string) => Reply,
  control_ = "actionform",
  search = "",
  o: { offRow?: boolean; pathname?: string; formId?: string; follow?: Record<string, string> } = {},
) {
  const control = CONTROLS[control_]!;
  const formClass = control.formClass;
  /** The run form's id. Every control on the row that is written
   *  outside its tags names it — the Run button, the phase boxes, the
   *  five model selects and the AI picker — and it is what a press has
   *  to follow to reach them. */
  const ROW_FORM = "rowrun-aide/127-one-ai";
  const button = makeButton(
    control.label,
    control.pending,
    control.variant,
    formClass === "rowrun" ? ROW_FORM : undefined,
  );
  // The row's phase boxes — the space this spec's spinner takes over
  // while the press is out. A COLLAPSED row has none: it
  // renders Approve or Merge alone, with no run form and no boxes.
  const boxes = "<label class=\"phase\">analyze</label>";
  // `offsetWidth` is the one thing a hand-built object cannot honestly
  // report — nothing here lays anything out. It is a stated number, and
  // what the test proves is that the code READS it and holds the space
  // it names, not how many pixels a browser would have said.
  const phases = { innerHTML: boxes, isConnected: true, offsetWidth: 168, style: { minWidth: "" } };
  const otherPhases = { innerHTML: boxes, isConnected: true, offsetWidth: 168, style: { minWidth: "" } };
  /** A press's lock is the spec's rows, so the controls sit in a row
   *  after the head row, as the caption and phase lines hold them. Every
   *  selector it does ask for is recorded, so a lookup creeping back
   *  into the "also touches" chips beside the button is a failed test
   *  rather than a spinner appearing there. */
  const rowQueries: string[] = [];
  const row = {
    className: "subrow",
    // Declared before `spechead`, so a getter. A form on no spec's rows
    // has no head row to walk back to.
    get previousElementSibling(): unknown {
      return o.offRow ? null : spechead;
    },
    nextElementSibling: null,
    parentElement: null,
    // Spec A's controls as its caption and phase lines hold them, and
    // never the other spec's select.
    querySelectorAll: () => [...new Set([runButton, cancelButton, button, ...stepBoxes, ...modelSelects, ...aiSelects, tailBoxEl])],
    querySelector: (sel: string) => {
      rowQueries.push(sel);
      return null;
    },
  };
  // A hidden `token` field on a page served before the token was removed:
  // no press reads it any more (`no-token-param.test.ts`).
  const tokenInput = { value: "s3cret" };
  type Listener = (e: unknown) => void | Promise<void>;
  const on: Record<string, Listener> = {};
  // The OTHER controls on the same spec. A press locks the spec's
  // rows, so a fake with one button on it could not tell a spec-wide
  // lock from the single-button one it replaced.
  const runButton = formClass === "rowrun" ? button : makeButton("Run", "Starting…", "primary", ROW_FORM);
  const cancelButton = formClass === "actionform" ? button : makeButton("Cancel", "cancelling…", "danger");
  /** The run form as the State cell holds it: hidden fields only, and
   *  an id every control outside its tags names. */
  const runFormEl = {
    id: ROW_FORM,
    className: "rowrun",
    // What `rowControls` asks any form: which row am I on. And what a
    // press asks: where is this row's token.
    closest: (sel: string) => (sel === "tr" ? row : null),
    querySelector: (sel: string) => (sel.includes("token") ? tokenInput : null),
    querySelectorAll: () => [],
  };
  /** The `<tr class="spechead">` that opens the spec's rows. It holds
   *  the fold link and the name, no control; the rows after it do. */
  const spechead = {
    className: "spechead",
    previousElementSibling: null,
    nextElementSibling: row,
    querySelectorAll: () => [],
  };
  const form = {
    action: control.action,
    className: formClass,
    // The run form is the only one with an id, because it is the only
    // one whose controls are written outside it.
    id: o.formId ?? (formClass === "rowrun" ? ROW_FORM : ""),
    // The phase boxes ARE the Run form's fields — a real `FormData`
    // reads the checkboxes that are in the form at that moment. So the
    // fake reads them out of the same element the press overwrites: a
    // spinner put there before the form was serialised would post a job
    // with no phases at all, and a fixed list could not tell.
    //
    // And a DISABLED control posts nothing — the browser's own rule,
    // and the reason the row is locked only after the form has been
    // serialised. A fake that ignored `disabled` could not
    // tell the two orders apart.
    get fields(): [string, string][] {
      const live = phases.innerHTML.includes("phase") && !stepBoxes.some((b) => b.disabled);
      return live ? [["steps", "analyze"]] : [];
    },
    // Empty for the run form, and that is the markup: its button is
    // written after its closing tag and reaches it by `form="…"`, so
    // `querySelectorAll` — descendants only — finds nothing at all.
    querySelectorAll: () => (formClass === "rowrun" ? [] : [button]),
    querySelector: (sel: string) => (sel.includes("token") ? tokenInput : null),
    closest: (sel: string) => (sel === "tr" ? row : sel.includes(`.${formClass}`) ? form : null),
  };

  const chips = [chip("aide"), chip("aide-dashboard")];
  const { createButton, slot, resets, projectSelect, createForm } = buildCreateForm(chips, tokenInput, on);

  // One phase with history and three still ahead — the mixed row
  // "set all" is scoped against.
  const modelSelects = [
    modelSelect(ROW_FORM, "create", "sonnet"),
    modelSelect(ROW_FORM, "analyze", "fable", true),
    modelSelect(ROW_FORM, "implement", "codex-fast"),
    // The phase the running job has not reached — the one
    // whose selects stay live, exactly where `tailBox` is.
    modelSelect(ROW_FORM, "archive", "sonnet", false, true),
  ];
  /** A model select belonging to ANOTHER row: a write must reach the
   *  five that share its form id and no others. */
  const otherRowSelect = { ...modelSelect(ROW_FORM, "analyze", "fable"), getAttribute: () => "rowrun-aide/99-other" };
  /** One per phase line, resting on the tool of the model that line's
   *  select is drawn on. */
  const aiSelects = [
    aiSelect(ROW_FORM, "create", "claude"),
    aiSelect(ROW_FORM, "analyze", "claude"),
    aiSelect(ROW_FORM, "implement", "codex"),
    aiSelect(ROW_FORM, "archive", "claude"),
  ];
  const stepBoxes = [
    stepCheckbox(ROW_FORM, "analyze", true),
    stepCheckbox(ROW_FORM, "implement", false),
    stepCheckbox(ROW_FORM, "archive", false),
  ];
  // Two specs' unfolded lists, one criterion text in common.
  const TICK_FORM = "rowchecks-aide/493-a";
  const TICK_ROW = "| AC-1: it folds | ⬜ | |";
  // The first criterion also has its Not verified box, in the same `li`.
  const firstLi = {
    querySelector: (sel: string): unknown =>
      sel.includes('name="unverified"') ? unverifiedBoxes[0] : sel.includes('name="failed"') ? failedBoxes[0] : tickBoxes[0],
  };
  const tickBoxes = [
    tickCheckbox(TICK_FORM, TICK_ROW, false, firstLi),
    tickCheckbox(TICK_FORM, "| AC-2: it saves | ✅ | |", true),
    tickCheckbox("rowchecks-aide/493-b", TICK_ROW, false),
  ];
  const unverifiedBoxes = [unverifiedCheckbox(TICK_FORM, TICK_ROW, false, firstLi)];
  // An archived criterion's third box.
  const failedBoxes = [failedCheckbox(TICK_FORM, TICK_ROW, false, firstLi)];
  const tailBoxEl = tailBox(ROW_FORM);
  const { removeButton, removeSlot, removeDialog, addButton, addSlot, addForm, removeForm } =
    buildProjectsPanel(tokenInput, on);

  const inserted: { id: string; className: string; textContent: string }[] = [];
  const parentNode = {
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
    for (const b of tickBoxes) b.redraw();
    for (const b of unverifiedBoxes) b.redraw();
    for (const b of failedBoxes) b.redraw();
    tailBoxEl.redraw();
  };
  // `#jobrows` is a STRING here and a tree of nodes in the
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
  // The container itself carries the "something was clicked
  // and the answer is not here yet" look, so the fake grows the one
  // thing a class can be read off.
  const rowsClass = { className: "" };
  // The list scrolls in `.tablewrap`, and how far down it is
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
          ? sel.includes('name="tick"')
            ? [...stepBoxes, ...tickBoxes, ...(sel.includes('name="unverified"') ? unverifiedBoxes : []), ...(sel.includes('name="failed"') ? failedBoxes : [])]
            : stepBoxes
          : sel.startsWith("button")
            ? [runButton]
            : [],
    parentNode,
    addEventListener: (type: string, fn: (e: unknown) => void) => void (on[type] = fn),
  };
  const requests: { url: string; init: Record<string, unknown> }[] = [];
  // `pathname` because the page's own reloads go back to the page they
  // are on — the Projects panel is served at `/projects`,
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

  /** The running-phase marks the page's own clock rewrites.
   *  Re-queried on every tick by the code under test, so a test can add
   *  or remove one between ticks and see the difference — which is what
   *  proves the clock survives `#jobrows` being swapped out under it. */
  const elapsed: { dataset: { elapsed: string }; textContent: string }[] = [];

  /** The type of every event the script dispatches on the document. */
  const dispatched: string[] = [];
  /** The same events with the `detail` each one carried. */
  const dispatchedEvents: { type: string; detail?: unknown }[] = [];
  /** The list's own line above the rows, where a refusal naming no spec
   *  on the list is written (`row-refusal/`); its words are the span. */
  const listRefused = { textContent: "" };
  const listRefusedLine = { querySelector: (sel: string) => (sel === "span" ? listRefused : null) };
  // A page that follows its job has a marker.
  const followed = followFakes(o.follow);
  const document = {
    createElement: followed.createElement,
    // A row's own anchor id resolves too. `rowAnchorId()` is
    // already on every head row for the sake of `href="#..."`, and the
    // per-group diff reaches a group through it — so a fake that
    // answered only `"jobrows"` could not run the code under test at
    // all.
    getElementById: (id: string) => (id === "jobrows" ? rows : id === "list-refused" ? listRefusedLine : table.byId(id)),
    // `.phases` answers with ANOTHER row's boxes on purpose: a press
    // must reach its own row's boxes and no others, so a document-wide
    // lookup has to be visibly wrong rather than accidentally right.
    querySelector: (sel: string) =>
      sel === "[data-follow]"
        ? followed.find()
        : sel.includes("newspecform")
        ? createForm
        : // A tail box is on a phase LINE, and the row it
          // belongs to is reached through the form it names — the same
          // id every other control outside that form carries.
          sel.startsWith("form[id=")
          ? (sel.includes(ROW_FORM) ? runFormEl : null)
          : sel.includes("phases")
            ? otherPhases
            : null,
    // See resolveDocumentQuerySelectorAll (fixtures-events.ts) for the
    // form-scoping rules this answers with.
    querySelectorAll: (sel: string) =>
      resolveDocumentQuerySelectorAll(sel, {
        elapsed, addForm, removeForm, aiSelects, modelSelects, otherRowSelect, runButton, stepBoxes, tailBoxEl,
      }),
    // Recorded: `visibilitychange` is what opens and
    // closes the page's connection now, so a fake that swallowed it
    // could not tell a tab going quiet from one that never connected.
    addEventListener: (type: string, fn: (e: unknown) => void) => void (on[`doc:${type}`] = fn),
    dispatchEvent: (e: { type: string; detail?: unknown }) => {
      dispatched.push(e.type);
      dispatchedEvents.push({ type: e.type, detail: e.detail });
    },
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
  const FakeFormData = makeFakeFormData();
  const { FakeEventSource, made: sourcesMade, live } = makeFakeEventSource();

  /** Every timer the page asks for, with the work it would do. There
   *  is no five-second POLL and nothing may put it back; the one timer
   *  there is touches nothing but the text of the marks it
   *  owns, so what is recorded is both the cadence and the callback —
   *  a test can then run a tick by hand and say what it did. */
  const intervals: number[] = [];
  const ticks: (() => void)[] = [];

  const { clock, FakeDate } = makeFakeDate();
  const { timeouts, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout } = makeFakeTimers();

  // eslint-disable-next-line no-new-func -- the file under test IS a script
  new Function(
    "document", "location", "fetch", "setInterval", "history", "FormData", "EventSource", "Date",
    "setTimeout", "clearTimeout",
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
    fakeSetTimeout,
    fakeClearTimeout,
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
  /** A `changed` event that carries data, as a queue move sends it. */
  const tickWith = (data: string) => {
    if (!live()) visibility(document.visibilityState as "visible" | "hidden");
    live()?.emit("changed", data);
  };

  const { submit, submitCreate, click, clickFold, clickHref, fire, foldLink, foldAttrs } = buildNavigation(
    on,
    button as unknown as { closest?: (s: string) => unknown },
    form,
    createButton,
  );

  return {
    /** The words in the list's own refusal line. */
    listRefused,
    /** The row node wearing that anchor id, right now. The
     *  same object across a redraw is what proves the redraw left it
     *  alone; a different one proves it was replaced. */
    rowFor: (id: string) => table.byId(id),
    /** Every row's anchor id in the order they stand in. */
    rowIds: () => table.ids(),
    /** The list's scroll box as it stands right now — a new
     *  object after every wholesale replace, exactly as the browser's
     *  own element is. */
    wrap: () => wrap,
    submit, submitCreate, click, clickFold, clickHref, foldLink, foldAttrs,
    button, createButton, requests, location, rows, inserted,
    replaced, slot, resets, document, phases, otherPhases, rowQueries, tick, tickWith,
    /** Whether the page still carries its follow marker. */
    marked: followed.marked,
    sources: sourcesMade, live, visibility, intervals, ticks, timeouts, elapsed, clock,
    projectSelect, chips,
    removeButton, removeSlot, removeDialog, dispatched, dispatchedEvents,
    addButton, addSlot,
    submitRemove: (extra: Partial<{ defaultPrevented: boolean }> = {}) =>
      fire("remove:submit", removeButton, extra),
    submitAdd: (extra: Partial<{ defaultPrevented: boolean }> = {}) =>
      fire("add:submit", addButton, extra),
    changeProject: (value: string) => {
      projectSelect.value = value;
      on["select:change"]?.({ target: projectSelect });
    },
    modelSelects, otherRowSelect, aiSelects, stepBoxes, tailBox: tailBoxEl,
    /** A tail box ticked or unticked by hand — the tick that posts on
     *  its own, without a Run press behind it. */
    changeTail: (checked: boolean) => {
      tailBoxEl.checked = checked;
      return on["change"]?.({ target: tailBoxEl });
    },
    runButton, cancelButton,
    /** An AI picked on ONE phase line — the action that
     *  fills that phase's model in, and no other phase's. */
    changeAi: (index: number, tool: string) => {
      const select = aiSelects[index]!;
      select.value = tool;
      // Returned rather than dropped: on a LIVE line the pick posts
      // and a test has to be able to wait for it.
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
    /** An acceptance criterion's box ticked or unticked by hand. */
    tickBoxes, unverifiedBoxes, failedBoxes, TICK_FORM,
    /** The first criterion's Failed box checked or cleared by hand. */
    changeFailed: (index: number, checked: boolean) => {
      const box = failedBoxes[index]!;
      box.checked = checked;
      on["change"]?.({ target: box });
    },
    /** The first criterion's Not verified box checked or cleared by hand. */
    changeUnverified: (index: number, checked: boolean) => {
      const box = unverifiedBoxes[index]!;
      box.checked = checked;
      on["change"]?.({ target: box });
    },
    changeTick: (index: number, checked: boolean) => {
      const box = tickBoxes[index]!;
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
  h.requests.map((r) => r.url).find((u) => u.includes("rows=1")) ?? "";
