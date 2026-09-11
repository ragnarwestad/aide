// The frame every page sits in: the header, the two tabs under it, and
// the document around them. Self-contained by design — inline CSS, no
// external references — because the generated site is published as
// plain files.

import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { CSS } from "./css.ts";
import { ICON_LINKS, WORDMARK } from "./brand.ts";
import { PWA_LINKS } from "./pwa.ts";
import { esc } from "./html.ts";
import { ICON_THEME_AUTO, ICON_THEME_DARK, ICON_THEME_LIGHT, rowMessage } from "./components.ts";
import { getBoardInfo } from "./board-info.ts";
import { specNumber } from "../../project/spec-folder.ts";
import { t, type Language, type TranslationKey } from "../../i18n";

const DEFAULT_INSTALL_LOG = () => join(process.env.HOME ?? "", "Library/Logs/aide-dashboard/install.log");

// A tool the installer could not declare (spec 334) is otherwise
// visible only in a log file nobody has a reason to open — read here so
// it reaches every ordinary dashboard visit instead (REQ-5). Only the
// LAST run's block matters: an old warning a later run already cleared
// must not keep showing.
function lastInstallWarning(lang: Language): string | undefined {
  const path = process.env.AIDE_INSTALL_LOG ?? DEFAULT_INSTALL_LOG();
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }
  const lastBlock = text.split(/^--- .* ---$/m).pop() ?? "";
  // Two tagged warnings only: the declared-tools step's (`[aide tools]`,
  // core/scripts/_install-bin.sh) and the serve job's (`[aide serve]`,
  // deploy/install-after-merge.sh — the launchd job passing an option
  // this build no longer accepts, which kills the board at its next
  // restart). The installers also print ⚠️ for things a machine may
  // legitimately not have — Codex, a browser MCP, a PATH line — and a
  // banner that fired on any of those was on after every merge, which
  // is the same as no banner.
  return /⚠️\s+\[aide (tools|serve)\]/.test(lastBlock)
    ? t(lang, "shell.installWarning", { path })
    : undefined;
}

export interface NavEntry {
  label: string;
  path: string;
}

// The theme switcher's own code is TypeScript like the rest of the
// repo; the browser needs JavaScript. Transpiled once, here, the way
// `serve.ts` does it for `queue-client.ts` — Bun has the transpiler
// in-process, so this needs no build step and no bundle in the repo.
const transpile = (file: string): string =>
  new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
    readFileSync(join(import.meta.dir, file), "utf-8"),
  );

const THEME_SCRIPT = transpile("../scripts/theme-script.ts");
// Spec 118's sibling to it: which UNIT the reader wants consumption in.
// Its own file and its own IIFE, concatenated into the one <script> tag
// below rather than given a second — the guard test counts tags, and
// what it is guarding against is page code drifting back onto the
// generated pages, not a second small setting sharing the allowance.
const UNIT_SCRIPT = transpile("../scripts/unit-script.ts");
// Close-on-outside-click and Escape for the "…" menu: what makes the
// disclosure BEHAVE as a menu rather than a box that stays open.
const MENU_SCRIPT = transpile("../scripts/menu-script.ts");
// Spec 173's fourth: the two lines that register the service worker,
// which is what a browser wants to see before it offers to install the
// page. It shares the one <script> tag for the reason UNIT_SCRIPT
// does — the guard counts tags, and what it guards against is page
// code drifting back onto the generated pages.
const SW_REGISTER_SCRIPT = transpile("../scripts/sw-register.ts");
// The fifth: a pressed Save that looks pressed on the pages that post a
// real form and wait — the spec editor's takes two or three seconds to
// commit and push. Same tag as the others, for the same reason.
const FORM_BUSY_SCRIPT = transpile("busy/form-busy.ts");
// The sixth: a link that leaves the page says so the moment it is
// clicked, on every page (spec 312) — `queue-client.ts` used to own
// this for the one page it loads on.
const NAV_BUSY_SCRIPT = transpile("busy/nav-busy.ts");
// The seventh: the same click nav-busy.ts marks also gets a covering
// layer, for the whole wait rather than only while the pointer sits
// still over the link (spec 314).
const NAV_OVERLAY_SCRIPT = transpile("busy/nav-overlay.ts");
// The eighth (spec 358): the PDF button opens a NEW tab, which neither
// form-busy.ts (no form) nor nav-busy.ts/nav-overlay.ts (both decline a
// target="_blank" link, since this document is never replaced) cover.
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

// Dark, Light, Auto. Not tabs: they are not a page to go to, so they
// sit inside the "…" menu rather than in the tab bar, and mark the
// chosen one with `aria-current` rather than the `current` class,
// which means "the page you are on".
const THEME_CHOICES: [string, string][] = [["dark", "Dark"], ["light", "Light"], ["auto", "Auto"]];

// Each language's own flag — PaceUp's own picker (`ViewControls.tsx`)
// draws every choice as a flag plus a name, never a bare two-letter
// code (REQ-1, spec 409). The name itself is translated into the
// reader's selected language, not each language's own native name
// (REQ-1..3, spec 413).
const LANGUAGE_FLAGS: Record<Language, string> = { en: "🇬🇧", nb: "🇳🇴" };
const LANGUAGE_NAME_KEYS: Record<Language, TranslationKey> = {
  en: "shell.languageEnglish",
  nb: "shell.languageNorwegian",
};

// Icons keyed by choice — the header control below draws no text label
// of its own, so the icon is what says which button is which (the
// `aria-label`/`title` on each button carry the same word for anyone
// who cannot see the icon).
const THEME_ICONS: Record<string, string> = {
  dark: ICON_THEME_DARK, light: ICON_THEME_LIGHT, auto: ICON_THEME_AUTO,
};

// Auto is marked here, on the row AND on the trigger's icon, because the
// server has no way to know what this reader picked — theme-script.ts
// moves both once it does, the same mark() call doing the row's
// aria-current and the trigger's icon together. Module-scoped (spec
// 436), not function-local: themeChoiceRows() needs to read it too, and
// a function-local const is invisible outside its own function.
const THEME_LABELS: Record<string, TranslationKey> = {
  dark: "shell.themeDark", light: "shell.themeLight", auto: "shell.themeAuto",
};

// The theme choice rows, shared (spec 436) by themeControl()'s own
// standalone panel (desktop) and the "…" menu's flat mobile copy — the
// same markup either way, so a reader's choice looks identical wherever
// it is reached from.
function themeChoiceRows(lang: Language): string {
  return THEME_CHOICES.map(
    ([choice]) =>
      `<button type="button" data-theme-choice="${choice}"` +
      `${choice === "auto" ? ' aria-current="true"' : ""}>${THEME_ICONS[choice]}<span>${t(lang, THEME_LABELS[choice]!)}</span></button>`,
  ).join("");
}

// The header-level switch (spec 243, moved out of the "…" menu; a
// popup of its own since PaceUp's own header is the reference for HOW,
// not just where — one icon that names the current choice, a dropdown
// underneath for the other two). Its own `.menu`, distinct from the
// "…" one, so it gets the same outside-click/Escape close for free:
// `menu-script.ts`'s `closeAll` already targets every `details.menu`,
// not one in particular.
function themeControl(lang: Language): string {
  const trigger = THEME_CHOICES.map(
    ([choice]) =>
      `<span data-theme-icon="${choice}"${choice === "auto" ? "" : " hidden"}>${THEME_ICONS[choice]}</span>`,
  ).join("");
  const theme = t(lang, "shell.theme");
  return (
    `<details class="menu theme"><summary aria-label="${theme}" title="${theme}">${trigger}</summary>` +
    `<div class="menupanel">${themeChoiceRows(lang)}</div>` +
    `</details>`
  );
}

// The header-level language switch (spec 350), beside the theme control
// (REQ-3) and built the same way: a `<details class="menu">` trigger +
// panel, so it gets the same outside-click/Escape close for free. Each
// link targets the CALLER's own current address — `pageShell`'s
// `currentUrl` opt — with only `lang` swapped, so switching language
// keeps the reader on the page, tab, sort and filter they were already
// on. Absent `currentUrl` (the two build-time pages in `site.ts`, which
// have no request to read one from) falls back to `/`.
function languageHref(currentUrl: string, target: Language): string {
  const [path, search = ""] = currentUrl.split("?");
  const kept = search.split("&").filter((pair) => pair && !pair.startsWith("lang="));
  kept.push(`lang=${target}`);
  return esc(`${path}?${kept.join("&")}`);
}

// The language choice links, shared (spec 436) by languageControl()'s own
// standalone panel (desktop) and the "…" menu's flat mobile copy — the
// same markup either way, each targeting `currentUrl` with only `lang`
// swapped (spec 435), so switching language keeps the reader on the
// page, tab, sort and filter they were already on, wherever the link is
// reached from.
function languageChoiceLinks(lang: Language, currentUrl: string): string {
  const other: Language = lang === "nb" ? "en" : "nb";
  const choice = (l: Language) => `${LANGUAGE_FLAGS[l]} ${t(lang, LANGUAGE_NAME_KEYS[l])}`;
  return (
    `<a href="${languageHref(currentUrl, lang)}" aria-current="true">${choice(lang)}</a>` +
    `<a href="${languageHref(currentUrl, other)}">${choice(other)}</a>`
  );
}

function languageControl(lang: Language, currentUrl: string): string {
  const langLabel = t(lang, "shell.language");
  return (
    `<details class="menu lang"><summary aria-label="${langLabel}" title="${langLabel}">${LANGUAGE_FLAGS[lang]}</summary>` +
    `<div class="menupanel">${languageChoiceLinks(lang, currentUrl)}</div></details>`
  );
}

// Relocated from settings-page.ts's own unitsBlock (spec 436), markup
// unchanged — unit-script.ts's mark() already targets every
// [data-unit-choice] on the page, however many copies exist, so this
// needs no script change of its own.
function unitChoiceRows(): string {
  return (
    `<label><input type="radio" name="unit" value="usd" data-unit-choice="usd" checked> $</label>` +
    `<label><input type="radio" name="unit" value="tokens" data-unit-choice="tokens"> Tokens</label>`
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
    `<div class="menupanel">${unitChoiceRows()}</div></details>`
  );
}

// The mark on the left, the "…" menu on the right. The wordmark is
// already a link home (`brand.ts`), so the logo IS the home button —
// there is no second control saying the same thing.
//
// The menu is a native <details>, the same disclosure `.newspec` and
// `.intro` already are: it opens with JavaScript off, and it keeps the
// promise that a generated page carries the theme switcher and no
// other script.
/** The About prose, one source for the dialog on every page and the
 *  about.html fallback a reader without JavaScript still lands on. */
export function aboutProse(): string {
  return (
    `<p class="intro">aide-dashboard is the read-only overview of ` +
    `AI-assisted development across the projects on this machine: every ` +
    `project with an <code>.aide/project.yaml</code> manifest gets a page ` +
    `showing what the project IS (stack, deployment, logging, statistics, ` +
    `docs) and where its specs stand (phase and progress, active and ` +
    `archived). The site is static — regenerate and publish with ` +
    `<code>make publish</code>.</p>`
  );
}

/** The build stamp, said in words. Only the static pages carry one —
 *  a served page is rendered per request, and stamping THAT time here
 *  would call it a build. */
export function buildStampLine(generatedAt: string): string {
  return (
    `<p class="stamp">Build: these static pages (Projects, About, the ` +
    `project pages) were last generated ${esc(generatedAt)}.</p>`
  );
}

// About is a DIALOG, not a page you navigate to (asked for 2026-08-19):
// the menu item opens it in place, the cross and a click outside close
// it. The <form method="dialog"> close is the platform's own — no
// script involved once the box is open; opening it modally is the one
// thing `menu-script.ts` does for it.
function aboutDialog(buildStamp?: string): string {
  return (
    `<dialog class="about"><div class="aboutpanel">` +
    `<form method="dialog"><button class="aboutclose" aria-label="Close">` +
    `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" ` +
    `stroke="currentColor" stroke-width="1.8" stroke-linecap="round">` +
    `<path d="M4 4l8 8M12 4l-8 8"></path></svg></button></form>` +
    `<h2>About</h2>` +
    aboutProse() +
    (buildStamp ? buildStampLine(buildStamp) : "") +
    `</div></dialog>`
  );
}

// Which board this page is served from, and — on a test board — the
// Stop control beside it (spec 424, REQ-1..5). `getBoardInfo()` is
// process-lifetime state, read directly here rather than threaded
// through `pageShell()`'s 17 call sites, the same shape
// `lastInstallWarning()` above already uses for `AIDE_INSTALL_LOG`.
//
// The machine name reads `AIDE_DASH_HOST` before `hostname()` for the
// same reason `main.ts generate` needs to at build time: the two
// STATICALLY generated pages (Projects, About) are typically built on
// one machine and published to another (`Makefile`'s `make publish`),
// and `renderSite()` calls this same function — so reading the real
// `hostname()` here would stamp the wrong machine's name onto them
// whenever the env var is not also set on the machine actually serving
// them. Harmless when unset: `hostname()` is then this same machine's
// own name anyway.
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
 *  is "Test" (2026-09-10) — a round started from a branch names the
 *  spec by number, a round started from a checkout says only Test. What
 *  KIND of test is a question left for later. */
function boardText(lang: Language): string {
  const board = getBoardInfo();
  const machine = esc(process.env.AIDE_DASH_HOST ?? hostname());
  if (!board) return `${machine} - Prod`;
  const which = isSpecFolder(board.specFolder) ? ` - ${esc(specNumber(board.specFolder))}` : "";
  return `${machine} - Test${which}${stopForm(lang)}${runForm(lang)}`;
}

/** A test board's Run control: the round's fixture specs through again
 *  on this same board (self-run.ts), the server left as it is. Nothing
 *  on a prod board. */
function runForm(lang: Language): string {
  if (!getBoardInfo()) return "";
  return (
    `<form class="actionform" method="post" action="/api/self-run">` +
    `<button class="btn" type="submit" data-pending="starting…">${t(lang, "shell.runTestRound")}</button></form>`
  );
}

/** A test board's Stop control; nothing on a prod board. */
function stopForm(lang: Language): string {
  if (!getBoardInfo()) return "";
  return (
    // No hidden token field (unlike `boardStatus()`'s own Stop form,
    // `overview.ts`): the reader is already past `queueGuard` to see
    // this page at all, which means the port-scoped cookie is already
    // set, and this form posts to the SAME port.
    `<form class="actionform" method="post" action="/api/self-stop">` +
    `<button class="btn" type="submit">${t(lang, "shell.stopTestServer")}</button></form>`
  );
}

function isSpecFolder(folder: string): boolean {
  return /^\d+(-|$)/.test(folder);
}

function pageHeader(lang: Language, currentUrl: string): string {
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
  const mobileRows =
    `<div class="morerows theme">${themeChoiceRows(lang)}</div>` +
    `<div class="morerows lang">${languageChoiceLinks(lang, currentUrl)}</div>` +
    `<div class="morerows unit">${unitChoiceRows()}</div>`;
  return (
    `<header>${WORDMARK}${boardLine(lang)}` +
    // Theme, language and unit sit beside the "…" trigger, all at the
    // header's right-hand end (spec 243, spec 350, spec 436) —
    // header-level controls the reader reaches without opening the menu
    // first, not one more item behind it.
    `<span class="row">${themeControl(lang)}${languageControl(lang, currentUrl)}${unitControl(lang)}` +
    // The trigger is a QUIET icon — no border, no button chrome; a round
    // hover flat is all (PaceUp's header menu is the reference).
    `<details class="menu"><summary aria-label="${t(lang, "shell.more")}">` +
    `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">` +
    `<circle cx="8" cy="3" r="1.4"></circle><circle cx="8" cy="8" r="1.4"></circle>` +
    `<circle cx="8" cy="13" r="1.4"></circle></svg></summary>` +
    // Settings, then the board-wide test-server overview (spec 425),
    // then About.
    `<div class="menupanel">${boardRow(lang)}${mobileRows}<a href="/settings">${t(lang, "shell.settings")}</a>` +
    `<a href="/test-servers">${t(lang, "shell.testServers")}</a>` +
    `<a href="about.html" data-about>${t(lang, "shell.about")}</a></div>` +
    `</details></span></header>`
  );
}

function tabBar(entries: NavEntry[], currentPath: string, lang: Language): string {
  // The first entry is the Projects page; the rest are the project
  // pages, which are NOT tabs — the Projects page lists them, and two
  // lists of the same projects were one too many. A project's own page
  // counts as being "in" Projects, so that tab is current there too.
  //
  // Except the sections (spec 163): a project page is a generated file,
  // `<slug>.html`, and anything among the rest with an ABSOLUTE path is
  // a half of the dashboard rather than a project — so it gets a tab of
  // its own and is not one of the pages Projects is current on. The
  // shape is what decides, not the label, and `navFromSite()`'s
  // fallback nav (all `.html`, no root, no archive to read) therefore
  // draws exactly the two tabs it always drew.
  const [projectsPage, ...rest] = entries;
  const sections = rest.filter((e) => e.path.startsWith("/"));
  const projects = rest.filter((e) => !e.path.startsWith("/"));
  const onAProject = projects.some((p) => p.path === currentPath);
  // The spec list is `/` for the list itself AND for every job detail
  // page — `job-page.ts` passes the literal `"/"` — so one check covers
  // both halves of Specs.
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
  const tab = (label: string, href: string, on: boolean) =>
    `<a class="tab" data-nav data-goto href="${href}"${on ? ` aria-current="page"` : ""}>${label}</a>`;
  return (
    `<nav class="tabbar">` +
    tab(t(lang, "shell.tabSpecs"), "/", currentPath === "/") +
    tab(t(lang, "shell.tabProjects"), projectsPage!.path, projectsPage!.path === currentPath || onAProject) +
    sections.map((e) => tab(e.label, e.path, e.path === currentPath)).join("") +
    `</nav>`
  );
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
  refreshSeconds?: number,
  opts: {
    refreshInNoscript?: boolean;
    script?: string;
    /** A second, distinct script tag (spec 315) — `src=` rather than
     *  inline text, for the one script this dashboard wants a browser
     *  to fetch once and reuse rather than re-send with every page. */
    scriptSrc?: string;
    docTitle?: string;
    hideHeading?: boolean;
    /** When this page is part of a static build: its generation time,
     *  shown labelled at the bottom of the About dialog. */
    buildStamp?: string;
    /** Spec 350. Absent (never required) on every page — every call site
     *  passes some real `lang` since spec 408 (REQ-1, guarded at runtime
     *  by `pageshell-lang-coverage.test.ts`, REQ-5), so absent still
     *  means "nothing chose otherwise" rather than an unwired page. */
    lang?: Language;
    /** The exact request address (path + query, `lang` included) the
     *  reader is ON right now — what the language links point at, `lang`
     *  swapped. Absent means `/`: the two build-time pages in `site.ts`
     *  have no request to read one from, and always link home exactly as
     *  every page already did before this field existed. */
    currentUrl?: string;
    /** REQ-2 (spec 408): Settings belongs to none of the tabs the bar
     *  offers, so it draws no tab bar at all. Absent (never required)
     *  on every other page. */
    hideTabBar?: boolean;
  } = {},
): string {
  const lang = opts.lang ?? "en";
  const currentUrl = opts.currentUrl ?? "/";
  // A meta refresh is fine on a page you only read. On a page with a
  // FORM it is hostile: it wipes what you were half-way through
  // filling in. The spec list therefore refreshes its table from
  // script and keeps the blunt refresh as the fallback for a browser
  // that did not run it.
  const meta = refreshSeconds ? `<meta http-equiv="refresh" content="${refreshSeconds}">` : "";
  const refresh = !meta ? "" : opts.refreshInNoscript ? `\n<noscript>${meta}</noscript>` : `\n${meta}`;
  // At the END of the body: a page's own code wires up elements, and an
  // inline script in the head runs before they exist, so every listener
  // it tries to attach silently attaches to nothing. (Which is exactly
  // what happened: the table still refreshed on its timer, so it looked
  // like the code was running.) THEME_SCRIPT above is in <head> for the
  // mirror-image reason — it has to decide a colour before the body is
  // parsed — and waits for DOMContentLoaded before touching an element.
  const script = opts.script ? `\n<script>${opts.script}</script>` : "";
  const scriptSrc = opts.scriptSrc ? `\n<script src="${esc(opts.scriptSrc)}"></script>` : "";
  const installWarning = lastInstallWarning(lang);
  const installBanner = installWarning ? rowMessage("waiting", installWarning, { tag: "p" }) : "";
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${refresh}
<title>${esc(opts.docTitle ?? `aide -board · ${title}`)}</title>
${ICON_LINKS}
${PWA_LINKS}
<style>${CSS}</style>
<script>${THEME_SCRIPT}${UNIT_SCRIPT}${MENU_SCRIPT}${SW_REGISTER_SCRIPT}${FORM_BUSY_SCRIPT}${NAV_BUSY_SCRIPT}${NAV_OVERLAY_SCRIPT}${PDF_BUSY_SCRIPT}${SPEC_FORM_ACTIONS_SCRIPT}${DEPENDS_LIFT_SCRIPT}${UNSAVED_CHANGES_SCRIPT}</script>
</head>
<body data-overlay-note="${esc(t(lang, "shell.overlayLoading"))}">
${pageHeader(lang, currentUrl)}
${installBanner}
${aboutDialog(opts.buildStamp)}
${opts.hideTabBar ? "" : tabBar(entries, currentPath, lang)}
<main>
${opts.hideHeading ? "" : `<div class="pagehead"><h1>${esc(title)}</h1></div>\n`}${body}
</main>${script}${scriptSrc}
</body>
</html>
`;
}
