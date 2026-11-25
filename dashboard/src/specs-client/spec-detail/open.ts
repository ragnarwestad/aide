// A press on a shut › on the Specs list opens that row where it is. The page
// is not replaced: the loading dialog blocks page input, the spec's address is
// pushed, and the spec fills the row when the server has built it. Without
// this script, or for a click the browser should handle itself, the › is the
// link it is and loads the spec's address.

import { writeLine } from "../press.ts";
import { groupEnd } from "../row-refusal/index.ts";
import { placeSpecRows, swapRows, swapSpec } from "../row-swap/index.ts";
import { holdLoadingCover } from "../progress-dialog";
import { press } from "../state.ts";
import { SPEC_DETAIL_DRAWN, SPEC_HEAD_CLASS, SPEC_LOADING_ROW_ID } from "../../page-contract.ts";
export { SPEC_DETAIL_DRAWN, SPEC_LOADING_ROW_ID } from "../../page-contract.ts";

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
  const head = link?.closest(`tr.${SPEC_HEAD_CLASS}`) as HTMLElement | null;
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

/** Fetches the spec's detail and places its rows; true when it failed
 *  and the press is still the newest. */
async function drawDetail(url: URL, signal: AbortSignal, gen: number): Promise<boolean> {
  let failed = false;
  try {
    const res = await fetch(`${url.pathname}?${url.searchParams}`, {
      headers: { accept: "text/html" },
      signal,
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
  return failed;
}

/** Refreshes the rows for the new address, keeping the open spec where
 *  it stands unless the reader scrolled meanwhile. */
async function redrawRowsKeepingPlace(key: string, before: number, gen: number): Promise<void> {
  let readerScrolled = false;
  // Scroll events also come from restoring the row; only user input cancels restoration.
  const moved = (event: Event) => {
    if (event.type !== "keydown" || ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes((event as KeyboardEvent).key)) readerScrolled = true;
  };
  const scrollInputs = ["wheel", "touchmove", "pointerdown", "keydown"];
  for (const type of scrollInputs) document.addEventListener(type, moved, true);
  try {
    if (press.pressGen === gen) {
      await swapRows();
      const redrawnHead = specHead(key);
      if (!readerScrolled && redrawnHead) keepInPlace(redrawnHead, before);
    }
  } finally { for (const type of scrollInputs) document.removeEventListener(type, moved, true); }
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

  const release = holdLoadingCover();
  const href = link.getAttribute("href") ?? "";
  history.pushState(null, "", href);
  drawn = location.pathname;

  const url = new URL(href, location.href);
  url.searchParams.set("detail", "1");
  const shutPrevious = previousKey ? swapSpec(previousKey) : Promise.resolve();
  const failed = await drawDetail(url, controller.signal, gen);
  try {
    if (failed) await showFailure(body, key);
    await shutPrevious;
    keepInPlace(head, before);
  } finally {
    if (current?.controller === controller) current = null;
    release();
    press.inFlight--;
  }
  // Refresh address-dependent links while holding the open detail. A
  // reader who scrolls during this request keeps that new position.
  await redrawRowsKeepingPlace(key, before, gen);
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
export function addScripts(html: string): void {
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

export function onBack(): boolean {
  const path = location.pathname;
  if (path === drawn) return true;
  // A press still on its way is over: its request is dropped, and its own
  // ending lifts the lock and draws nothing.
  if (current) {
    current.controller.abort();
    press.pressGen++;
  }
  if (path !== LIST_PATH) {
    return false;
  }
  const row = document.getElementById("jobrows")?.querySelector(DETAIL);
  if (row?.querySelector(UNSAVED)) {
    return false;
  }
  if (row) {
    row.remove();
    shutChevron(specHead(row.getAttribute(KEY)!));
  }
  drawn = path;
  void swapRows();
  return true;
}
