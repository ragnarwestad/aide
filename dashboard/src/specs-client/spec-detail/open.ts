// A press on a shut › on the Specs list opens that row where it is. The page
// is not replaced: the row says "Loading …" in its own detail row, the rest of
// the page is drawn as it was and cannot be pressed, the spec's address is
// pushed, and the spec fills the row when the server has built it. Without
// this script, or for a click the browser should handle itself, the › is the
// link it is and loads the spec's address.

import { writeLine } from "../press.ts";
import { groupEnd } from "../row-refusal/index.ts";
import { placeSpecRows, swapRows, swapSpec } from "../row-swap.ts";
import { press } from "../state.ts";

/** Hand-paired with `render/pages/specs-list/notice-row.ts`, which draws the
 *  row this copies; the bundle imports nothing from outside it. */
export const SPEC_LOADING_ROW_ID = "spec-loading-row";
/** Sent on `document` once a spec is in its row; hand-paired with
 *  `render/ui/forms/spec-form-actions.ts`, a head script that can import
 *  nothing and binds Save and Cancel when it hears this. */
export const SPEC_DETAIL_DRAWN = "spec-detail-drawn";

const LIST_PATH = "/specs";
const DETAIL = "tr[data-spec-detail]";
const KEY = "data-spec-detail";
/** A Save an edit has switched on (`spec-form-actions.ts` keeps it off until then). */
const UNSAVED = "#specform-save:not([disabled])";
const DETAIL_ROW = /<tr[^>]*\sdata-spec-detail=/;

/** The press in flight, if any. */
let current: { controller: AbortController } | null = null;
/** The address the page last drew: the pathname Back is compared with, and the
 *  whole address to put back when Back is refused. */
let drawn = "";
let drawnAt = "";

const specHead = (key: string): Element | null => document.getElementById(`spec-${key}`);

/** A row's chevron drawn shut. Its link is made right by the redraw that follows. */
function shutChevron(head: Element | null): void {
  const link = head?.querySelector("a.fold");
  link?.setAttribute("aria-expanded", "false");
  link?.classList.add("shut");
}

/** Takes the press when it is a plain click on a shut › of a spec on the Specs
 *  list, and the spec can be opened without losing something the reader has
 *  typed. `false` leaves the press to the browser, which loads the page. */
export function openSpecInPlace(event: MouseEvent): boolean {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
    return false;
  }
  const link = (event.target as Element | null)?.closest?.("a.fold[data-goto]") as HTMLAnchorElement | null;
  const head = link?.closest("tr.spechead") as HTMLElement | null;
  const body = document.getElementById("jobrows");
  if (!link || !head || !body?.contains(head) || link.getAttribute("aria-expanded") !== "false") return false;
  if (!document.getElementById(SPEC_LOADING_ROW_ID)) return false;
  // A press while another is on its way does nothing, as the page's presses
  // do not answer while a row loads.
  if (current) {
    event.preventDefault();
    return true;
  }
  // The leave-page question is the browser's to ask, so an open spec with an
  // edit not yet saved is left to the page load.
  if (body.querySelector(DETAIL)?.querySelector(UNSAVED)) return false;
  event.preventDefault();
  void open(link, head, body);
  return true;
}

async function open(link: HTMLAnchorElement, head: HTMLElement, body: HTMLElement): Promise<void> {
  const key = head.id.slice("spec-".length);
  const controller = new AbortController();
  current = { controller };
  press.pressGen++;
  press.inFlight++;
  const gen = press.pressGen;

  // The spec open until now is shut where it stands, its rows drawn again for
  // the new address once the page is settled.
  const previous = body.querySelector(DETAIL);
  const previousKey = previous?.getAttribute(KEY) ?? null;
  const before = head.getBoundingClientRect().top;
  if (previous) {
    previous.remove();
    shutChevron(specHead(previousKey!));
  }
  link.setAttribute("aria-expanded", "true");
  link.classList.remove("shut");
  drawLoadingRow(head, key);
  keepInPlace(head, before);

  document.body.setAttribute("inert", "");
  const href = link.getAttribute("href") ?? "";
  history.pushState(null, "", href);
  drawn = location.pathname;
  drawnAt = drawn + location.search + location.hash;

  const url = new URL(href, location.href);
  url.searchParams.set("detail", "1");
  const shutPrevious = previousKey ? swapSpec(previousKey) : Promise.resolve();
  let failed = false;
  try {
    const res = await fetch(`${url.pathname}?${url.searchParams}`, {
      headers: { accept: "text/html" },
      signal: controller.signal,
    });
    const html = res.ok ? await res.text() : "";
    if (press.pressGen === gen) {
      if (DETAIL_ROW.test(html) && placeSpecRows(html, false)) {
        addScripts(html);
        document.dispatchEvent(new Event(SPEC_DETAIL_DRAWN));
      } else failed = true;
    }
  } catch {
    // Back aborts the request and bumps the generation: nothing is drawn then.
    failed = press.pressGen === gen;
  }
  if (failed) await showFailure(body, key);
  await shutPrevious;

  if (current?.controller === controller) {
    current = null;
    document.body.removeAttribute("inert");
  }
  press.inFlight--;
  // The links that depend on the address (the Reopen dialogs' way back) are
  // drawn for the new one, the open row held across it.
  if (press.pressGen === gen) void swapRows();
}

/** The row the spec will be drawn in, copied from the template the page
 *  carries, where the server draws a detail row: before the spec's gap row. */
function drawLoadingRow(head: Element, key: string): void {
  const template = document.getElementById(SPEC_LOADING_ROW_ID) as HTMLTemplateElement;
  const row = template.content.querySelector("tr")!.cloneNode(true) as Element;
  row.setAttribute(KEY, key);
  const end = groupEnd(head);
  if ("before" in end) end.before.insertAdjacentElement("beforebegin", row);
  else end.after.insertAdjacentElement("afterend", row);
}

/** The pressed row stays where it was on the screen when the row that was open
 *  above it went: the list's own box scrolls where it scrolls, the page where
 *  the box does not. */
function keepInPlace(head: Element, before: number): void {
  const delta = head.getBoundingClientRect().top - before;
  if (!delta) return;
  const wrap = document.querySelector(".tablewrap") as HTMLElement | null;
  if (wrap && wrap.scrollHeight > wrap.clientHeight && /auto|scroll/.test(getComputedStyle(wrap).overflowY)) {
    wrap.scrollTop += delta;
  } else {
    globalThis.scrollBy?.(0, delta);
  }
}

/** A script a parsed answer names never runs, so each is added as a new one:
 *  the editor or viewer bundle mounts in the row it finds. */
function addScripts(html: string): void {
  for (const match of html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)) {
    const script = document.createElement("script");
    script.src = match[1]!;
    document.body.appendChild(script);
  }
}

/** The row says the spec could not be loaded, in its own area. The spec's rows
 *  are drawn again for the new address, with this row held in place. */
async function showFailure(body: HTMLElement, key: string): Promise<void> {
  const row = Array.from(body.querySelectorAll(DETAIL)).find((el) => el.getAttribute(KEY) === key);
  row?.querySelector("p.muted")?.remove();
  writeLine(row?.querySelector(".refused"), row?.getAttribute("data-failed") ?? "");
  await swapSpec(key);
}

/** Back, Forward and the address bar: the page is told only of a change of
 *  address. To the list it shuts the open row where it stands; to another
 *  spec's address it loads the page, since opening a spec from the browser's
 *  history is not done in place. */
export function bindBack(win: {
  location: { pathname: string };
  addEventListener: (type: "popstate", listener: () => void) => void;
}): void {
  // Optional, as `placeNamedRow`'s window is: a page script run under a stand-in window has neither.
  drawn = win.location?.pathname ?? "";
  win.addEventListener?.("popstate", onBack);
}

function onBack(): void {
  const path = location.pathname;
  if (path === drawn) return;
  // A press still on its way is over: its request is dropped, and its own
  // ending lifts the lock and draws nothing.
  if (current) {
    current.controller.abort();
    press.pressGen++;
  }
  if (path !== LIST_PATH) {
    location.reload();
    return;
  }
  const row = document.getElementById("jobrows")?.querySelector(DETAIL);
  if (row?.querySelector(UNSAVED)) {
    // The address goes back to what is shown, and the list is loaded: the
    // browser asks the leave-page question, and staying keeps both.
    const list = path + location.search + location.hash;
    history.pushState(null, "", drawnAt);
    location.assign(list);
    return;
  }
  if (row) {
    row.remove();
    shutChevron(specHead(row.getAttribute(KEY)!));
  }
  drawn = path;
  void swapRows();
}
