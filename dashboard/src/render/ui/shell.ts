// The frame every page sits in: the header, the two tabs under it, and
// the document around them. Self-contained by design — inline CSS, no
// external references — because the generated site is published as
// plain files.

import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { CSS } from "./css";
import { ICON_LINKS, WORDMARK } from "./brand.ts";
import { PWA_LINKS } from "./pwa.ts";
import { esc } from "./html.ts";
import { tabBar } from "./tabs.ts";
import { buttonForm, confirmDialog, messageSlot } from "./components";
import { capitalizeFirst } from "../../format/error-sentence.ts";
import { themeControl, languageControl, menuSettingRows } from "./header-controls.ts";
import { getBoardInfo, isRoundBoard } from "./board-info.ts";
import { headerNotices } from "./header-notices.ts";
import { specNumber } from "../../project/spec-folder.ts";
import { t, type Language, type TranslationKey } from "../../i18n";

export interface NavEntry {
  label: string;
  path: string;
  /** Resolved per request, in `siteTabs()` below, in preference to `label`
   *  (spec 482) — `navEntries()` builds this list at server start,
   *  before any reader's language is known, so a tab whose word can
   *  change per language names the catalogue KEY here instead of
   *  baking in English. Absent for every entry with nothing to
   *  translate (a project's own name), which keeps rendering `label`
   *  exactly as before — a widening, not a breaking change to this
   *  type. */
  labelKey?: TranslationKey;
}

// The theme switcher's own code is TypeScript like the rest of the
// repo; the browser needs JavaScript. Transpiled once, here, the way
// `serve.ts` does it for `specs-client.ts` — Bun has the transpiler
// in-process, so this needs no build step and no bundle in the repo.
const transpile = (file: string): string =>
  new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
    readFileSync(join(import.meta.dir, file), "utf-8"),
  );

const THEME_SCRIPT = transpile("../scripts/theme-script.ts");
// Spec 118's sibling to it: which UNIT the reader wants consumption in.
// Its own file and its own IIFE, concatenated into the one <script> tag
// below rather than given a second: the rule is page code kept off the
// generated pages, not a second small setting sharing the allowance.
const UNIT_SCRIPT = transpile("../scripts/unit-script.ts");
// Close-on-outside-click and Escape for the "…" menu: what makes the
// disclosure BEHAVE as a menu rather than a box that stays open.
const MENU_SCRIPT = transpile("../scripts/menu-script.ts");
// Spec 173's fourth: the two lines that register the service worker,
// which is what a browser wants to see before it offers to install the
// page. It shares the one <script> tag for the reason UNIT_SCRIPT
// does.
const SW_REGISTER_SCRIPT = transpile("../scripts/sw-register.ts");
// The sixth: a link that leaves the page says so the moment it is
// clicked, on every page (spec 312) — `specs-client.ts` used to own
// this for the one page it loads on.
const NAV_BUSY_SCRIPT = transpile("busy/nav-busy.ts");
// The seventh: the same click nav-busy.ts marks also gets a covering
// layer, for the whole wait rather than only while the pointer sits
// still over the link (spec 314).
const NAV_OVERLAY_SCRIPT = transpile("busy/nav-overlay.ts");
// The eighth (spec 358): the PDF button opens a NEW tab, which neither
// nav-busy.ts nor nav-overlay.ts covers (both decline a target="_blank"
// link, since this document is never replaced).
const PDF_BUSY_SCRIPT = transpile("busy/pdf-busy.ts");
// The ninth (spec 391): Save and Cancel enable together the instant a
// spec form has an edit, and disable together again once Cancel puts it
// back — one script for every `.specform` on the page rather than one
// per tab.
const SPEC_FORM_ACTIONS_SCRIPT = transpile("forms/spec-form-actions.ts");
/** Ticking a dependency moves its chip between the two blocks at
 *  once, rather than only when the form comes back saved. */
const DEPENDS_LIFT_SCRIPT = transpile("forms/depends-lift.ts");
// The tenth (spec 438): a page with an unsaved edit in one of the
// tracked forms warns before it is left, by any means — an in-app
// link, the browser's Back/Forward, a closed tab, a typed address —
// since it rides `beforeunload` rather than intercepting any one of
// those individually.
const UNSAVED_CHANGES_SCRIPT = transpile("forms/unsaved-changes.ts");
// Loads the page again once a Deploy's held restart has happened, so the
// notice saying it waits does not outlive it.
const RESTART_WATCH_SCRIPT = transpile("../scripts/restart-watch.ts");

// Relocated from settings-page.ts's own unitsBlock (spec 436), markup
// unchanged — unit-script.ts's mark() already targets every
// [data-unit-choice] on the page, however many copies exist, so this
// needs no script change of its own.
function unitChoiceRows(scope: string): string {
  return (
    `<label><input type="radio" name="unit-${scope}" value="usd" data-unit-choice="usd" checked> $</label>` +
    `<label><input type="radio" name="unit-${scope}" value="tokens" data-unit-choice="tokens"> Tokens</label>`
  );
}

// The header-level unit switch (spec 436), built the same way as
// themeControl()/languageControl(). A static "$", not a live icon:
// unlike theme's three-way choice, where the trigger's own icon is the
// only way to see which of three is active, a two-way choice does not
// need the trigger to track it.
function unitControl(lang: Language): string {
  const unit = t(lang, "shell.unit");
  return (
    `<details class="menu unit"><summary aria-label="${unit}" title="${unit}">$</summary>` +
    `<div class="menupanel">${unitChoiceRows("menu")}</div></details>`
  );
}

// The mark on the left, the "…" menu on the right. The wordmark is
// already a link home (`brand.ts`), so the logo IS the home button —
// there is no second control saying the same thing.
//
// The menu is a native <details>, the same disclosure `.intro` already
// is: it opens with JavaScript off, and it keeps the promise that a
// generated page carries the theme switcher and no other script.
/** The About prose, shown in the dialog the "…" menu opens. */
export function aboutProse(): string {
  return (
    `<p class="intro">aide -board runs spec-driven development across ` +
    `every project on this machine. Write a spec, and the board takes it ` +
    `through create, analyze, implement and archive — each phase a real ` +
    `run of an AI you choose, in a worktree of its own, ending in a branch ` +
    `merged and the spec filed away.</p>` +
    `<p class="intro">A spec's own files live in a specs repository; the ` +
    `code it changes lives in the project's. The board owns neither: it ` +
    `keeps its own checkouts, runs the project's tests before anything ` +
    `merges, and stops rather than guess when they go red.</p>` +
    `<p class="intro">Every project it knows about declares itself in an ` +
    `<code>.aide/project.yaml</code> manifest. What each page means is ` +
    `behind the "?" on that page.</p>`
  );
}

// About is a DIALOG, not a page you navigate to (asked for 2026-08-19):
// the menu item opens it in place, the cross and a click outside close
// it. The <form method="dialog"> close is the platform's own — no
// script involved once the box is open; opening it modally is the one
// thing `menu-script.ts` does for it.
function aboutDialog(): string {
  return (
    `<dialog class="about"><div class="aboutpanel">` +
    buttonForm({ method: "dialog", button: { cross: "Close" } }) +
    `<h2>About</h2>` +
    aboutProse() +
    `</div></dialog>`
  );
}

// The board's one confirmation dialog, written once per page like About
// rather than stamped out per row: this guard is a property of the whole
// app, not of any one row (spec 478). It has no button — the
// unsaved-changes guard opens it from a dirty page's link click, finds it
// by id, and reads OK's `leave` as its answer. A real <dialog>, unlike the
// native beforeunload prompt it replaces for an in-app link, is positioned
// by the browser inside the document's own viewport — always the app
// window, never the screen.
function leaveAppDialog(lang: Language): string {
  return confirmDialog(lang, {
    id: "leaveapp",
    title: t(lang, "shell.leaveAppTitle"),
    sentence: t(lang, "shell.leaveAppBody"),
    ok: { variant: "danger", value: "leave" },
  });
}

// Which board this page is served from, and — on a test board — the
// Stop control beside it (spec 424, REQ-1..5). `getBoardInfo()` is
// process-lifetime state, read directly here rather than threaded
// through `pageShell()`'s 17 call sites, the same shape
// `lastInstallWarning()` (header-notices.ts) already uses for `AIDE_INSTALL_LOG`.
//
// The machine name reads `AIDE_DASH_HOST` before `hostname()` because a
// test board (`test/round/run`) can run its process on one machine while
// serving on another's behalf — reading the real `hostname()` here would
// stamp the wrong machine's name onto the header. Harmless when unset:
// `hostname()` is then this same machine's own name anyway.
function boardLine(lang: Language): string {
  return `<span class="row muted small boardline"${boardTitle()}>${boardText(lang)}</span>`;
}

/** The Stop and Run controls again as the first row of the "…" menu: at phone
 *  width the header keeps the board's name but has no room for the
 *  button beside it — "aide -dashboard" wrapped under it — so the menu
 *  carries the button there and the header's own hides (narrow.css,
 *  2026-09-11). Two Stop forms is fine: neither has an id, and only the
 *  visible one can be pressed. A prod board has no Stop, and no row. */
function boardRow(lang: Language): string {
  const stop = stopForm(lang);
  return stop ? `<div class="boardrow muted small">${stop}${runForm(lang)}</div>` : "";
}

function boardTitle(): string {
  const board = getBoardInfo();
  if (!board || !isSpecFolder(board.specFolder)) return "";
  return ` title="${esc(board.specFolder)} : ${esc(board.branch)}"`;
}

/** "Prod" is the service on main with the real specs; everything else
 *  is "Test" (2026-09-10) — a board started from a spec's branch names
 *  the spec by number, a board started from a checkout is the round's
 *  own and says so (2026-09-11). */
function boardText(lang: Language): string {
  const board = getBoardInfo();
  const machine = esc(process.env.AIDE_DASH_HOST ?? hostname());
  if (!board) return `${machine} - Prod`;
  const which = isSpecFolder(board.specFolder)
    ? ` - ${esc(specNumber(board.specFolder))}`
    : ` - ${esc(t(lang, "shell.testRound"))}`;
  return `${machine} - Test${which}${stopForm(lang)}${runForm(lang)}`;
}

/** A round board's Run control: the round's fixture specs through again
 *  on this same board (self-run.ts), the server left as it is. Only on
 *  a board started from a checkout — never on one started from a spec's
 *  branch, which previews that spec and is not re-run — and nothing on
 *  a prod board. The page script posts it and loads the page again;
 *  `actionform` is what the phone layout hides the header's copy by. */
function runForm(lang: Language): string {
  if (!isRoundBoard()) return "";
  return buttonForm({
    action: "/api/self-run",
    hook: "actionform reloadform",
    button: { label: t(lang, "shell.runTestRound"), pending: "starting…" },
    after: messageSlot("refused"),
  });
}

/** A test board's Stop control; nothing on a prod board. */
function stopForm(lang: Language): string {
  if (!getBoardInfo()) return "";
  return buttonForm({ action: "/api/self-stop", hook: "actionform", button: { label: t(lang, "shell.stopTestServer") } });
}

export function isSpecFolder(folder: string): boolean {
  return /^\d+(-|$)/.test(folder);
}

/** `tabs` is the tab bar again, shown in the header's own row on a phone
 *  held sideways only (narrow.css) — the height a row of its own costs
 *  is what that screen has least of. Hidden everywhere else, where the
 *  bar under the header is the one shown. */
function pageHeader(lang: Language, currentUrl: string, tabs = ""): string {
  // Theme, language and unit repeat here flat, with no second `<details>`
  // wrapper (spec 436): the "…" menu's own `closeAll()` behaviour
  // (menu-script.ts) closes every open `details.menu`/`details.intro`
  // except the innermost the click landed in, and a nested `<details>`
  // here would make its own trigger close this outer menu instead of
  // opening. narrow.css hides the three standalone triggers and reveals
  // this block only at phone width.
  //
  // Three blocks, one per control, since they come into the menu one at
  // a time as the page narrows — unit first, then language, then theme
  // — at the same widths the specs list drops its figure columns.
  return (
    `<header>${WORDMARK}${tabs}${boardLine(lang)}` +
    // Theme, language and unit sit beside the "…" trigger, all at the
    // header's right-hand end (spec 243, spec 350, spec 436) —
    // header-level controls the reader reaches without opening the menu
    // first, not one more item behind it.
    // A <div>, not a <span>: a <details> is flow content, which a span cannot hold.
    `<div class="row">${themeControl(lang)}${languageControl(lang, currentUrl)}${unitControl(lang)}` +
    // The trigger is a QUIET icon — no border, no button chrome; a round
    // hover flat is all (PaceUp's header menu is the reference).
    `<details class="menu"><summary aria-label="${t(lang, "shell.more")}">` +
    `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">` +
    `<circle cx="8" cy="3" r="1.4"></circle><circle cx="8" cy="8" r="1.4"></circle>` +
    `<circle cx="8" cy="13" r="1.4"></circle></svg></summary>` +
    // Settings, then the board-wide test-server overview (spec 425),
    // then About.
    `<div class="menupanel">${boardRow(lang)}${menuSettingRows(lang, currentUrl)}<a href="/settings">${t(lang, "shell.settings")}</a>` +
    `<a href="/test-servers">${t(lang, "shell.testServers")}</a>` +
    `<button type="button" data-about>${t(lang, "shell.about")}</button></div>` +
    `</details></div></header>`
  );
}

/** The header's tab keys in order — Running, Specs, the Projects page, then the
 *  sections — and the one that is current for `currentPath`.
 *
 *  The first entry is the Projects page; the rest are the project pages, which
 *  are NOT tabs — the Projects page lists them, and two lists of the same
 *  projects were one too many. A project's own page counts as being "in"
 *  Projects, so that tab is current there too.
 *
 *  Except the sections (spec 163): anything among the rest with an ABSOLUTE
 *  path is a half of the dashboard rather than a project — so it gets a tab of
 *  its own and is not one of the pages Projects is current on. The shape is
 *  what decides, not the label. A RELATIVE `<slug>.html` is read as a project
 *  page, which no build writes any more (spec 185 served it instead).
 *
 *  Running is current on `/` and on every job's page, which passes `/`; Specs on
 *  `/specs`, which the list, New spec and the spec page pass. */
export function siteTabKeys(
  entries: NavEntry[],
  currentPath: string,
): { keys: string[]; sections: NavEntry[]; current: string | undefined } {
  const [projectsPage, ...rest] = entries;
  const sections = rest.filter((e) => e.path.startsWith("/"));
  const projects = rest.filter((e) => !e.path.startsWith("/"));
  const onAProject = projects.some((p) => p.path === currentPath);
  const current =
    currentPath === "/" || currentPath === "/specs"
      ? currentPath
      : projectsPage!.path === currentPath || onAProject
        ? projectsPage!.path
        : sections.find((e) => e.path === currentPath)?.path;
  return { keys: ["/", "/specs", projectsPage!.path, ...sections.map((e) => e.path)], sections, current };
}

function siteTabs(entries: NavEntry[], currentPath: string, lang: Language): string {
  // Real tabs, not filter pills: a hairline the row sits on, and the
  // current tab marked by an underline in the accent colour (asked for
  // 2026-08-19, with PaceUp's tab bar as the reference).
  // `data-goto` (spec 208): these are real page loads, and were the
  // literal case 1-description.md measured — five seconds from Projects
  // to Specs with nothing on the screen saying anything had happened.
  // `data-nav` stays and is still inert for them: the only listener
  // that reads it is bound to `#jobrows`, and this row sits outside it.
  // `navigate()` would be the wrong fix even if it did reach here —
  // `swapRows()` always fetches the Specs list, never the tab's own
  // target.
  //
  // Each tab's key is its own path, so the shared bar links a tab to its key.
  const { keys, sections, current } = siteTabKeys(entries, currentPath);
  const words = new Map<string, string>([
    ["/", t(lang, "shell.tabRunning")],
    ["/specs", t(lang, "shell.tabSpecs")],
    [entries[0]!.path, t(lang, "shell.tabProjects")],
    ...sections.map((e): [string, string] => [e.path, e.labelKey ? t(lang, e.labelKey) : e.label]),
  ]);
  return tabBar(keys, (path) => path, current, {}, "", { label: (path) => words.get(path)!, site: true });
}

/** Everything `pageShell` takes beyond the title, the tabs and the body. */
export interface PageShellOpts {
  script?: string;
  /** A second, distinct script tag (spec 315) — `src=` rather than
   *  inline text, for the one script this dashboard wants a browser
   *  to fetch once and reuse rather than re-send with every page. */
  scriptSrc?: string;
  docTitle?: string;
  hideHeading?: boolean;
  /** When this page is part of a static build: its generation time,
   *  shown labelled at the bottom of the About dialog. */
  /** Spec 350. Absent (never required) on every page — every call site
   *  passes some real `lang` since spec 408 (REQ-1, guarded at runtime
   *  by `pageshell-lang-coverage.test.ts`, REQ-5), so absent still
   *  means "nothing chose otherwise" rather than an unwired page. */
  lang?: Language;
  /** The exact request address (path + query, `lang` included) the
   *  reader is ON right now — what the language links point at, `lang`
   *  swapped. Absent means `/`: the two build-time pages in
   *  `projects-page.ts` have no request to read one from, and always link
   *  home exactly as every page already did before this field existed. */
  currentUrl?: string;
  /** REQ-2 (spec 408): Settings belongs to none of the tabs the bar
   *  offers, so it draws no tab bar at all. Absent (never required)
   *  on every other page. */
  hideTabBar?: boolean;
}

/** The document up to and including `<body …>`: what a streamed page can
 *  send before it knows anything about its content (spec 515). */
export function shellHead(
  title: string,
  opts: { lang?: Language; docTitle?: string } = {},
): string {
  const lang = opts.lang ?? "en";
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.docTitle ?? `aide -board · ${title}`)}</title>
${ICON_LINKS}
${PWA_LINKS}
<style>${CSS}</style>
<script>${THEME_SCRIPT}${UNIT_SCRIPT}${MENU_SCRIPT}${SW_REGISTER_SCRIPT}${UNSAVED_CHANGES_SCRIPT}${NAV_BUSY_SCRIPT}${NAV_OVERLAY_SCRIPT}${PDF_BUSY_SCRIPT}${SPEC_FORM_ACTIONS_SCRIPT}${DEPENDS_LIFT_SCRIPT}${RESTART_WATCH_SCRIPT}</script>
</head>
<body data-overlay-note="${esc(capitalizeFirst(t(lang, "shell.overlayLoading")))}">`;
}

/** The rest of the document, from the header to `</html>`. `afterMain` is
 *  written right after `</main>`, for a streamed page's second half;
 *  `pageShell` passes none. */
export function shellRest(
  entries: NavEntry[],
  currentPath: string,
  title: string,
  body: string,
  opts: PageShellOpts & { afterMain?: string } = {},
): string {
  const lang = opts.lang ?? "en";
  const currentUrl = opts.currentUrl ?? "/";
  // At the END of the body: a page's own code wires up elements, and an
  // inline script in the head runs before they exist, so every listener
  // it tries to attach silently attaches to nothing. (Which is exactly
  // what happened: the table still refreshed on its timer, so it looked
  // like the code was running.) THEME_SCRIPT above is in <head> for the
  // mirror-image reason — it has to decide a colour before the body is
  // parsed — and waits for DOMContentLoaded before touching an element.
  const script = opts.script ? `\n<script>${opts.script}</script>` : "";
  const scriptSrc = opts.scriptSrc ? `\n<script src="${esc(opts.scriptSrc)}"></script>` : "";
  const tabs = opts.hideTabBar ? "" : siteTabs(entries, currentPath, lang);
  return `
${pageHeader(lang, currentUrl, tabs)}
${headerNotices(lang)}
${aboutDialog()}
${leaveAppDialog(lang)}
${tabs}
<main>
${opts.hideHeading ? "" : `<div class="pagehead"><h1>${esc(title)}</h1></div>\n`}${body}
</main>${opts.afterMain ?? ""}${script}${scriptSrc}
</body>
</html>
`;
}

export function pageShell(
  title: string,
  entries: NavEntry[],
  currentPath: string,
  body: string,
  // Kept in the signature for the callers' sake; the stamp itself moved
  // to the About page (2026-08-19) — an unlabelled ISO timestamp in the
  // corner of every page read as noise.
  _generatedAt: string,
  opts: PageShellOpts = {},
): string {
  return shellHead(title, { lang: opts.lang, docTitle: opts.docTitle }) + shellRest(entries, currentPath, title, body, opts);
}
