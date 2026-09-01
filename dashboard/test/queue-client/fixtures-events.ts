// Event-firing helpers extracted from queue-client/fixtures.ts's
// harness() — the delegated-listener simulation (submit, click, the
// fold chevron, a real navigation), parameterized on the harness state
// they need rather than closing over it.

type Listener = (e: unknown) => void | Promise<void>;

/** Every navigation/event-firing helper `harness()` returns, built
 *  against that call's own `on` map, button, form and create button. */
export function buildNavigation(
  on: Record<string, Listener>,
  button: { closest?: (s: string) => unknown },
  form: { closest: (s: string) => unknown },
  createButton: unknown,
) {
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
    button.closest = form.closest;
    return fire("submit", button, extra);
  };
  const submitCreate = (extra: Partial<{ defaultPrevented: boolean }> = {}) =>
    fire("create:submit", createButton, extra);
  /** A plain CLICK on the row's own button, through the delegated
   *  listener `#jobrows` carries. The fold's chevron is on that same
   *  listener, which is why a button that now sits on the head row
   *  (spec 157) has to be shown not to reach it. */
  const click = () => {
    button.closest = form.closest;
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

  return { submit, submitCreate, click, clickFold, fire };
}

/** `document.querySelectorAll`, as `harness()`'s fake document answers
 *  it: form-scoped selects, the AI/model pairs, and everything written
 *  outside a form and tied to it by name. Spec 112 binds the Projects
 *  panel's forms as a SET, so a form-scoped selector answers only the
 *  selects that name that form — the DOM's own answer, and the one
 *  thing a fake that handed back every select on the page could not
 *  tell apart. The `data-ai` branch is asked FIRST on purpose: an AI
 *  select's own selector names the model select it is paired with, so
 *  `select[data-ai="model.analyze"]` contains "model." too and the
 *  branch below would answer it with the model selects. */
export function resolveDocumentQuerySelectorAll(
  sel: string,
  ctx: {
    elapsed: unknown[];
    addForm: unknown;
    removeForm: unknown;
    aiSelects: { getAttribute: (n: string) => string | null; dataset: { ai?: string } }[];
    modelSelects: { getAttribute: (n: string) => string | null; name: string }[];
    otherRowSelect: { getAttribute: (n: string) => string | null; name: string };
    runButton: { getAttribute: (n: string) => string | null };
    stepBoxes: { getAttribute: (n: string) => string | null }[];
    tailBoxEl: { getAttribute: (n: string) => string | null };
  },
): unknown[] {
  const { elapsed, addForm, removeForm, aiSelects, modelSelects, otherRowSelect, runButton, stepBoxes, tailBoxEl } =
    ctx;
  // Asked FIRST: it names no form and no class, so every branch below
  // would answer it with the empty list.
  if (sel.includes("data-elapsed")) return elapsed;
  if (sel.includes("removeform")) return [addForm, removeForm];
  if (sel.includes("data-ai=")) {
    return aiSelects.filter(
      (a) => sel.includes(`form="${a.getAttribute("form")}"`) && sel.includes(`data-ai="${a.dataset.ai}"`),
    );
  }
  if (sel.includes("model.")) {
    return [...modelSelects, otherRowSelect].filter(
      (s) =>
        sel.includes(`form="${s.getAttribute("form")}"`) &&
        // `^=` asks for every model select on the form; a full
        // `name="model.analyze"` asks for exactly one, and a fake that
        // handed back all five would let a write that reached every
        // phase pass as one that reached its own.
        (sel.includes('name^="model."') || sel.includes(`name="${s.name}"`)),
    );
  }
  // Spec 151: everything written OUTSIDE a form and tied to it by
  // name — the Run button, the four phase boxes, the five model
  // selects and the five AI selects. Another row's select names
  // another form and is not answered here, which is what "the press
  // reaches its own row and no other" is proved against.
  if (sel.startsWith("[form=")) {
    return [runButton, ...stepBoxes, tailBoxEl, ...modelSelects, ...aiSelects, otherRowSelect].filter((el) =>
      sel.includes(`"${el.getAttribute("form")}"`),
    );
  }
  return [];
}
