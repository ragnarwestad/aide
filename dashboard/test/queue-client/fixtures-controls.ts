// Self-contained fake-DOM control builders, extracted out of harness()
// in fixtures.ts so that function can stay focused on wiring rather
// than construction. Each builder here takes the row-form id it
// belongs to as an explicit argument, rather than closing over
// harness()'s own ROW_FORM local.

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

/** One button as the DOM reports it. Two of them are needed since
 *  spec 151: the one pressed, and the siblings on the same row that
 *  must lock with it.
 *
 *  `form` is the attribute, and it is the whole point for Run: that
 *  button is written OUTSIDE `<form class="rowrun">` and reaches it
 *  by name alone (`queue-list.ts`, `stateAction`). */
export const makeButton = (label: string, pending: string, variant: string, form?: string) => {
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

// The five phase model selects, and (spec 179) the AI select each one
// is paired with. `<option>` collections are scaffolding a chip cannot
// stand in for: a select's value IS one of its options, which is the
// whole of what a write has to move.
export const MODELS: [string, string][] = [
  ["sonnet", "claude"],
  ["fable", "claude"],
  ["codex-fast", "codex"],
];

/** `ran` is the server's own "this phase has history" marker
 *  (`data-ran="1"`, `queue-list.ts`): the select is showing what the
 *  phase really ran on. `formId` is the row's run-form id, so a write
 *  on this select can be told apart from one on another row's. */
export const modelSelect = (formId: string, step: string, chosen: string, ran = false, live = false) => {
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
      n === "form" ? formId : n === "data-post-to" && live ? "/api/queue/job-1/model" : null,
    // A change lands on the select itself, and the handler walks up
    // with `closest`. A model select is NOT an AI select and not a
    // phase box, so it answers those selectors with null and its own
    // with itself. `data-post-to` is asked in two shapes: the tail
    // BOX's `input[data-post-to]` (never this) and, since spec 225,
    // a live model select's own `select[data-post-to]`.
    closest: (sel: string): unknown =>
      // `.aimodel` is the compact picker a NARROW screen draws around
      // the pair (2026-09-07). These rows are the wide layout, where
      // the two selects stand on their own, so the walk up finds none.
      sel.includes("data-ai") || sel.includes('name="steps"') || sel.includes("aimodel")
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

// Spec 179: one AI select per phase line, paired with that phase's
// model select by `data-ai` and the shared form id. The model it
// fills in per tool is worked out by the SERVER and carried on each
// option's `data-default` — the browser copies that value and never
// decides one, which is what these fixtures stand for.
export const AI_DEFAULT: Record<string, string> = { claude: "sonnet", codex: "codex-fast" };

export const aiSelect = (formId: string, step: string, tool: string) => {
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
      n === "form" ? formId : n === "data-ai" ? `model.${step}` : null,
    closest: (sel: string): unknown =>
      sel.includes('name="steps"') || sel.includes("data-post-to") || sel.includes("aimodel")
        ? null
        : self,
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

// Spec 141: the row's phase boxes. They share one `name` — the step
// is in the VALUE — which is why what is remembered about them is
// keyed on three parts and not the two a select needs. `create` has
// no box (a spec that exists cannot be created again), so the three
// that can be run are the three harness() builds.
export const stepCheckbox = (formId: string, value: string, served: boolean) => {
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
      n === "form" ? formId : n === "aria-label" ? value : null,
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

// Spec 160: a box for a phase the RUNNING job has not reached yet. It
// names the run form the way every other control on the row does —
// that is how a press finds the row to lock — but carries no `name`,
// so it is never posted with it. Its own route is in `data-post-to`,
// and a tick goes there on `change` rather than waiting for a submit
// this row does not offer.
export const tailBox = (formId: string) => {
  const self = {
    name: "",
    value: "archive",
    checked: false,
    tagName: "INPUT",
    disabled: false,
    isConnected: true,
    getAttribute: (n: string) =>
      n === "form" ? formId : n === "data-post-to" ? "/api/queue/job-1/steps" : null,
    closest: (sel: string): unknown => (sel.includes("data-post-to") ? self : null),
    /** What the SERVER draws after the swap: the tick the job's own
     *  step list justifies, which for a refused edit is the box
     *  exactly as it was. */
    redraw: () => void (self.checked = false),
  };
  return self;
};

/** Spec 110's Depends-on chips: one wrapper per active spec, each
 *  naming its own project. */
export const chip = (project: string) => {
  const input = { checked: true, disabled: false };
  return {
    dataset: { project },
    getAttribute: (name: string) => (name === "data-project" ? project : null),
    hidden: false,
    querySelector: (sel: string) => (sel.includes("input") ? input : null),
    input,
  };
};
