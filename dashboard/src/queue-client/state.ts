// Shared mutable state and the small keys built from a control's own
// attributes — the pieces every other file in this split reaches for.
// Split out of queue-client.ts (split queue-client.ts into a bundled
// folder), which still says why each piece of state exists; this file
// only carries the declarations.

/** The New-spec form, and never the Add-project one. Both wear
 *  `newspecform` — the Add form borrows the look — and the two live on
 *  different pages: the real one is the whole of `/new` (spec 121),
 *  and `/projects` has only the Add form, which would otherwise answer
 *  in its place — bound twice, two POSTs for one press. */
export const NEW_SPEC_FORM = "form.newspecform:not(.addprojectform)";

/** The look a control wears between the click and the answer (spec
 *  208). One class for both kinds of waiting — an in-page swap and a
 *  real navigation — because they are the same promise to the reader:
 *  what has been pressed does not look untouched. */
export const AWAITING = "awaiting";

/** `inFlight`: presses whose request has not answered yet. A push
 *  waits for zero. `pressGen`: bumped the instant a press BEGINS.
 *  `swapRows` reads it before its own fetch and again after, and drops
 *  the answer if it moved.
 *
 *  `inFlight` is only half the guard: it stops a NEW swap from starting
 *  mid-press, and says nothing about one that was already in the air
 *  when the press began. That one carries the server's answer from
 *  BEFORE the press, and used to write it into #jobrows over the busy
 *  button — or over the refusal banner — whenever it finally resolved.
 *  A `/?rows=1` answer waits on `isMerged` for every branch of every
 *  listed job, and a cache miss there costs up to three git calls at
 *  four seconds each, so the window is ten seconds wide and more: it is
 *  the 10-15 seconds of a Merge button sitting unchanged that was
 *  measured on 2026-08-20.
 *
 *  A shared object rather than two exported `let`s: an importing module
 *  can only read a live binding on an exported `let`, never write it —
 *  mutating a field on a shared object is what every other file needs
 *  to do. */
export const press = { inFlight: 0, pressGen: 0 };

/** Every select on the rows a PERSON has moved, keyed by the form it
 *  names and its own name. Reported 2026-08-20: pick Codex on a row,
 *  and five seconds later the select is back on Claude Code.
 *
 *  The rows are replaced wholesale on every redraw, and the fresh markup
 *  is the server's answer: every phase select back on the CONFIGURED
 *  model rather than the one just picked. Nothing about that is
 *  visible in the moment it happens. The cost is the press afterwards:
 *  a row asked for Codex, left alone for six seconds and then Run,
 *  started the step on Claude without a word.
 *
 *  Only hand-made choices are kept. A select nobody touched belongs to
 *  the server — that is how a phase that has run shows the model it
 *  really ran on — so this map stays empty until somebody changes
 *  something, and the swap behaves exactly as it did before. */
export const chosen = new Map<string, string>();

export const selectKey = (el: HTMLSelectElement): string => `${el.getAttribute("form") ?? ""}|${el.name}`;

/** The same promise for the row's PHASE BOXES, which the select fix
 *  above left out — and they are the half a press actually runs.
 *  Reported 2026-08-20: tick implement and archive, wait six seconds,
 *  press Run, and the job started whatever the SERVER had ticked. The
 *  server re-derives the ticks from the spec's own history on every
 *  render (`preTicked`), so a swap does not leave them alone; it
 *  overwrites them.
 *
 *  Keyed on THREE parts, where a select needs two: every box on a row
 *  shares the one name `steps`, and only its value says which phase it
 *  is. A two-part key would file all of them together and let the last
 *  box touched answer for the row.
 *
 *  Same rule as the selects: only a box a hand moved is kept, and a
 *  hand-made "off" is kept exactly as a hand-made "on" is. */
export const chosenSteps = new Map<string, boolean>();

export const checkboxKey = (el: HTMLInputElement): string =>
  `${el.getAttribute("form") ?? ""}|${el.name}|${el.value}`;
