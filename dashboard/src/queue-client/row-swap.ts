// Redrawing #jobrows from the server's own answer — only the specs
// whose rows actually differ, and never a row a press is mid-click on
// (spec 204). Split out of queue-client.ts (split queue-client.ts into
// a bundled folder).

import { offerEachToItsTool, syncAiToModel } from "./ai-sync.ts";
import { AWAITING, chosen, chosenSteps, checkboxKey, press, selectKey } from "./state.ts";

/** The row's button says what a press would run — and a press runs the
 *  BOXES, so the label has to follow them as they are clicked.
 *
 *  The server names the button from `preTicked`, which is its own
 *  suggestion (`queue-list.ts`). That is right for the row as drawn and
 *  wrong the instant a reader ticks something else: on 2026-08-21 a spec
 *  whose analyze was suggested, with only `archive` ticked by hand, went
 *  on offering "Analyze". The press was correct — an open row posts its
 *  boxes and no hidden steps — but the row said one thing and did
 *  another, which is the whole thing naming the button was for.
 *
 *  The display name comes off the box's own `aria-label`, which the
 *  server already sets to the phase's reader-facing name, so the
 *  step-label table is not spelled a second time in the browser.
 *
 *  Nothing ticked hides the button, as the server's own render does: a
 *  press that can do nothing must not be offered. Without this file the
 *  label simply stays as rendered, which is the same honest fallback
 *  every other thing here degrades to. */
export function relabelRunButton(body: Element, formId: string): void {
  // Quoted, so only a quote or a backslash could break out — and a form
  // id is `rowrun-<project>/<folder>`, both of which the route's own
  // regex limits to letters, digits, dot, dash and underscore. Escaped
  // anyway, and by hand: `CSS.escape` is a browser API the test harness
  // does not have (`ReferenceError: CSS is not defined`), and this file
  // is bundled and run there.
  const selector = `[form="${formId.replace(/["\\]/g, "\\$&")}"]`;
  // `querySelectorAll`, not `querySelector`: the harness's `#jobrows`
  // stub offers the plural and not the singular, and the two answer the
  // same question here — a form id names one button.
  const button = body.querySelectorAll(`button${selector}`)[0] as HTMLButtonElement | undefined;
  if (!button) return;
  // The BOXES and the BUTTON are tied by the form they name, not by the
  // row they sit in: a phase box is on a sub-row of its own and the
  // button is up in the head row's State cell, so no walk from one to
  // the other is as reliable as the id both already carry.
  const boxes = Array.from(body.querySelectorAll(`input[name="steps"]${selector}`)) as HTMLInputElement[];
  const first = boxes.find((b) => b.checked);
  if (!first) {
    button.hidden = true;
    return;
  }
  button.hidden = false;
  const name = first.getAttribute("aria-label") ?? first.value;
  button.textContent = `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** Every open row's button, after a redraw put the server's own label
 *  back over a reader's ticks. A row with no phase boxes on the page —
 *  every shut one — is left alone: its label is the server's and there
 *  is nothing on screen to disagree with it. */
export function relabelAll(body: Element): void {
  const seen = new Set<string>();
  for (const el of body.querySelectorAll('input[name="steps"][form]')) {
    const id = el.getAttribute("form");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    relabelRunButton(body, id);
  }
}

/** Put the hand-made choices back on the rows that were just drawn.
 *
 *  A remembered model is only put back if the fresh markup still offers
 *  it: a value no option carries is not a choice the row can honour. */
export function restoreChosen(body: Element): void {
  if (!chosen.size && !chosenSteps.size) return;
  for (const el of body.querySelectorAll('select[name^="model."]')) {
    const model = el as HTMLSelectElement;
    const want = chosen.get(selectKey(model));
    if (want === undefined) continue;
    for (const option of model.options) {
      if (option.value === want) model.value = want;
    }
    // The AI select this swap just redrew was drawn for the model the
    // SERVER chose, and the line above has put another one back over
    // it. It carries no memory of its own — it is set from the model,
    // every time, which is what stops the two disagreeing (spec 179).
    syncAiToModel(model);
  }
  for (const el of body.querySelectorAll('input[name="steps"]')) {
    const box = el as HTMLInputElement;
    const want = chosenSteps.get(checkboxKey(box));
    if (want === undefined) continue;
    box.checked = want;
  }
  // After the ticks, never before: the label is read off them.
  relabelAll(body);
}

// --- spec 204: a redraw never takes a press with it ------------------------
//
// Reported 2026-08-23: come back to the tab, click a row, nothing
// opens; the third press works. Coming back reconnects, the reconnect
// redraws, and the redraw used to be `body.innerHTML = html` — every
// `<tr>` on the page destroyed and rebuilt in one step, whether it had
// changed or not.
//
// A press is two events with human time between them. The browser
// synthesizes `click` only when `mousedown` and `mouseup` land on the
// SAME element, so a row torn out between the two swallows the press
// whole — nothing is broken, the click is simply never delivered. The
// existing guards do not reach this: `inFlight` and `pressGen` protect
// a press that has ALREADY fired, and there is no event at all for one
// that has begun.
//
// So the fix is to stop tearing out rows that did not change. A row
// this never touches cannot lose a click to it, however the timing
// falls.

/** One spec's rows, keyed by the anchor id the server already puts on
 *  its head row (`rowAnchorId`, `render/queue-list.ts`). */
interface RowGroup {
  key: string;
  html: string;
}

/** The fetched row list, cut where the diff can work on it: everything
 *  up to and including `<tbody>`, one entry per spec, and everything
 *  from `</tbody>` on. Concatenating the three gives back the string it
 *  was cut from, character for character. */
interface RowSplit {
  prefix: string;
  groups: RowGroup[];
  suffix: string;
}

/** The class the renderer puts on a spec's first row, and the only
 *  thing that says where one spec's rows end and the next spec's begin.
 *  Named once, and used both to cut the fetched markup up and to walk
 *  the page's own rows — two answers to that question could disagree. */
const SPEC_HEAD_CLASS = "spechead";

/** Where each spec's rows begin. Built from the constant rather than
 *  written out, so the class vocabulary has one spelling here. */
const SPEC_HEAD = new RegExp(`<tr class="${SPEC_HEAD_CLASS}\\b[^>]*?\\bid="([^"]+)"`, "g");

const OPEN_TBODY = "<tbody>";
const CLOSE_TBODY = "</tbody>";

/** The fetched markup as groups, or `null` when it cannot be accounted
 *  for exactly — no table, more than one, a row before the first spec
 *  (the empty and no-match states are one such row), or two specs
 *  wearing one id. `null` means "redraw the old way": failing open to
 *  the behaviour that has shipped for a year beats a diff that might be
 *  wrong about which rows are whose. */
function splitGroups(html: string): RowSplit | null {
  const open = html.indexOf(OPEN_TBODY);
  const close = html.lastIndexOf(CLOSE_TBODY);
  if (open === -1 || close === -1 || close < open) return null;
  const start = open + OPEN_TBODY.length;
  // A second table would put rows outside the range walked below.
  if (html.indexOf(OPEN_TBODY, start) !== -1) return null;
  const content = html.slice(start, close);
  const at: { key: string; index: number }[] = [];
  SPEC_HEAD.lastIndex = 0;
  for (let m = SPEC_HEAD.exec(content); m; m = SPEC_HEAD.exec(content)) {
    at.push({ key: m[1]!, index: m.index });
  }
  // The invariant: every row inside the table belongs to exactly one
  // spec. The first spec starting anywhere but the very beginning means
  // something else is in there.
  if (!at.length || at[0]!.index !== 0) return null;
  const groups: RowGroup[] = [];
  const seen: Record<string, true> = {};
  for (let i = 0; i < at.length; i++) {
    const key = at[i]!.key;
    if (seen[key]) return null; // no unique anchor to reach it by
    seen[key] = true;
    groups.push({ key, html: content.slice(at[i]!.index, at[i + 1]?.index ?? content.length) });
  }
  return { prefix: html.slice(0, start), groups, suffix: html.slice(close) };
}

const isSpecHead = (el: Element): boolean =>
  ` ${el.className} `.indexOf(` ${SPEC_HEAD_CLASS} `) !== -1;

/** A group's rows on the page: its head row and everything under it up
 *  to the next spec. `null` when the anchor is not there, which is the
 *  diff giving up and letting the caller redraw wholesale. */
function groupRange(key: string): Element[] | null {
  const head = document.getElementById(key);
  if (!head || !isSpecHead(head)) return null;
  const range: Element[] = [head];
  for (let el = head.nextElementSibling; el && !isSpecHead(el); el = el.nextElementSibling) range.push(el);
  return range;
}

/** Put a group's fresh markup where its old rows are, then take the old
 *  ones away. Collected BEFORE the insert on purpose: the new head row
 *  wears the same id, and `getElementById` would answer with it. */
function replaceGroup(g: RowGroup): boolean {
  const range = groupRange(g.key);
  if (!range) return false;
  range[0]!.insertAdjacentHTML("beforebegin", g.html);
  for (const el of range) el.remove();
  return true;
}

/** A spec that was not on the page a moment ago, put in its place:
 *  before whichever group now follows it, or at the end when none
 *  does. */
function insertGroup(groups: RowGroup[], at: number, held: Record<string, true>): boolean {
  for (let i = at + 1; i < groups.length; i++) {
    if (!held[groups[i]!.key]) continue;
    const next = groupRange(groups[i]!.key);
    if (!next) return false;
    next[0]!.insertAdjacentHTML("beforebegin", groups[at]!.html);
    return true;
  }
  // Nothing after it, so the table's own end. Reached through a row
  // that is already there rather than by looking the table up, which
  // keeps this to the one element the anchor already gives us.
  for (const g of groups) {
    const range = held[g.key] ? groupRange(g.key) : null;
    if (!range) continue;
    const table = range[0]!.parentNode as Element | null;
    if (!table) return false;
    table.insertAdjacentHTML("beforeend", groups[at]!.html);
    return true;
  }
  return false;
}

/** The redraw itself: only the specs whose rows actually differ are
 *  touched. `false` means it declined or could not finish, and the
 *  caller falls back to replacing the lot — which is also the repair
 *  for a diff that stopped half way.
 *
 *  It declines on anything outside the table changing — the filter
 *  bar's own counts, which is an everyday event: a chip counts one
 *  fewer the moment a job finishes — and on the specs being reordered,
 *  because both move rows the reader is looking at whatever this does.
 *  It also used to decline on the "N older specs not shown" line, which
 *  went with the cap in spec 226. */
function applyGroupDiff(prev: RowSplit, next: RowSplit): boolean {
  if (prev.prefix !== next.prefix || prev.suffix !== next.suffix) return false;
  const was: Record<string, string> = {};
  for (const g of prev.groups) was[g.key] = g.html;
  const now: Record<string, true> = {};
  for (const g of next.groups) now[g.key] = true;
  const kept = (list: RowGroup[], other: Record<string, unknown>): string =>
    list.filter((g) => other[g.key] !== undefined).map((g) => g.key).join("\n");
  if (kept(prev.groups, now) !== kept(next.groups, was)) return false;
  // The ones that are gone go first, so the anchors the inserts below
  // reach for are rows that are actually staying.
  const held: Record<string, true> = {};
  for (const g of prev.groups) {
    if (now[g.key]) held[g.key] = true;
    else if (!removeGroup(g.key)) return false;
  }
  for (let i = 0; i < next.groups.length; i++) {
    const g = next.groups[i]!;
    if (was[g.key] === g.html) continue; // untouched, and that is the point
    if (was[g.key] === undefined) {
      if (!insertGroup(next.groups, i, held)) return false;
      held[g.key] = true;
    } else if (!replaceGroup(g)) return false;
  }
  return true;
}

function removeGroup(key: string): boolean {
  const range = groupRange(key);
  if (!range) return false;
  for (const el of range) el.remove();
  return true;
}

/** What the last swap put on the page, kept here rather than read back
 *  off the DOM: the reader's own restored picks are written into those
 *  rows afterwards, so the DOM is no longer what the server sent. */
let lastRows: RowSplit | null = null;

// The filter and the sort live in the address bar, so the refresh has
// to ask for the same list the reader is looking at — otherwise every
// tick would quietly throw the filter away.
export async function swapRows(): Promise<void> {
  const body = document.getElementById("jobrows");
  if (!body) return;
  const gen = press.pressGen;
  const params = new URLSearchParams(location.search);
  params.delete("token");
  params.set("rows", "1");
  try {
    const res = await fetch(`/?${params}`, { headers: { accept: "text/html" } });
    if (!res.ok) return; // a blip is not worth a broken page
    const html = await res.text();
    // A press began while this was in the air, so this answer predates
    // it and is not the page's current one. The press's own follow-up
    // swap, or the next thing the server pushes, supplies that; what
    // must not happen is this one landing on top of what the press just
    // drew.
    if (press.pressGen !== gen) return;
    // Spec 226: how far down the list is scrolled, kept across the
    // redraw the way `restoreChosen` keeps a reader's own picks. The
    // wholesale replace below builds `.tablewrap` afresh, and a new
    // element starts at the top — so somebody reading the middle of the
    // archive would be thrown back to the first row.
    //
    // Unconditional, on both paths. The keyed diff never touches the
    // box, so putting the same number back is a no-op there; the
    // fallback is not the rare path it sounds like, because
    // `applyGroupDiff` declines whenever anything outside the rows
    // differs — a chip's count changing when a job starts or finishes
    // is exactly that.
    const scrolled = (body.querySelector(".tablewrap") as HTMLElement | null)?.scrollTop ?? 0;
    // Spec 204. The first paint has nothing to diff against, markup the
    // split cannot account for is redrawn the old way, and a diff that
    // could not finish is repaired by the same line.
    const next = splitGroups(html);
    if (!next || !lastRows || !applyGroupDiff(lastRows, next)) body.innerHTML = html;
    lastRows = next;
    const wrap = body.querySelector(".tablewrap") as HTMLElement | null;
    if (wrap) wrap.scrollTop = scrolled;
    restoreChosen(body);
    // After the restore, never before: a model put back by hand may
    // belong to the other tool, and the list has to follow the value
    // that ends up in the select.
    offerEachToItsTool(body);
  } catch {
    // offline, server restarting, tailnet hiccup: try again next tick
  } finally {
    // Spec 208. Whatever happened — swapped, refused, offline, or an
    // answer that arrived stale — the waiting look comes off. A
    // container left wearing it would say the page is still working on
    // something that is over. `finally`, because three of the paths
    // above are early returns.
    body.classList.remove(AWAITING);
  }
}
