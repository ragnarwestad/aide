// The frame every page sits in: the header, the two tabs under it, and
// the document around them. Self-contained by design — inline CSS, no
// external references — because the generated site is published as
// plain files.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CSS } from "./css.ts";
import { ICON_LINKS, WORDMARK } from "./brand.ts";
import { PWA_LINKS } from "./pwa.ts";
import { esc } from "./html.ts";
import { ICON_THEME_AUTO, ICON_THEME_DARK, ICON_THEME_LIGHT, rowMessage } from "./components.ts";

const DEFAULT_INSTALL_LOG = () => join(process.env.HOME ?? "", "Library/Logs/aide-dashboard/install.log");

// A tool the installer could not declare (spec 334) is otherwise
// visible only in a log file nobody has a reason to open — read here so
// it reaches every ordinary dashboard visit instead (REQ-5). Only the
// LAST run's block matters: an old warning a later run already cleared
// must not keep showing.
function lastInstallWarning(): string | undefined {
  const path = process.env.AIDE_INSTALL_LOG ?? DEFAULT_INSTALL_LOG();
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }
  const lastBlock = text.split(/^--- .* ---$/m).pop() ?? "";
  return lastBlock.includes("⚠️")
    ? `aide's last install found a problem — see ${path}`
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
const FORM_BUSY_SCRIPT = transpile("form-busy.ts");
// The sixth: a link that leaves the page says so the moment it is
// clicked, on every page (spec 312) — `queue-client.ts` used to own
// this for the one page it loads on.
const NAV_BUSY_SCRIPT = transpile("nav-busy.ts");
// The seventh: the same click nav-busy.ts marks also gets a covering
// layer, for the whole wait rather than only while the pointer sits
// still over the link (spec 314).
const NAV_OVERLAY_SCRIPT = transpile("nav-overlay.ts");

// Dark, Light, Auto. Not tabs: they are not a page to go to, so they
// sit inside the "…" menu rather than in the tab bar, and mark the
// chosen one with `aria-current` rather than the `current` class,
// which means "the page you are on".
const THEME_CHOICES: [string, string][] = [["dark", "Dark"], ["light", "Light"], ["auto", "Auto"]];

// Dollars or tokens. A CAP is always a dollar figure — the model
// dropdown's "$15 per step" is money the machine agreed to spend — so
// this flips consumption only, and dollars stays the default: it is the
// ABSENCE of the choice, which is what makes a page whose script never
// ran read the way it always did.
const UNIT_CHOICES: [string, string][] = [["usd", "$"], ["tokens", "Tokens"]];

// Icons keyed by choice — the header control below draws no text label
// of its own, so the icon is what says which button is which (the
// `aria-label`/`title` on each button carry the same word for anyone
// who cannot see the icon).
const THEME_ICONS: Record<string, string> = {
  dark: ICON_THEME_DARK, light: ICON_THEME_LIGHT, auto: ICON_THEME_AUTO,
};

function unitControl(): string {
  const buttons = UNIT_CHOICES.map(
    ([choice, label]) =>
      `<button type="button" data-unit-choice="${choice}"` +
      `${choice === "usd" ? ' aria-current="true"' : ""}>${label}</button>`,
  );
  // Wrapped in one `.row` so the label and its buttons share a line
  // instead of stacking under `.menupanel > * { display: block; }` —
  // css.ts carries a matching `.menupanel > .row` rule to keep the flex
  // gap once inside that panel.
  return `<span class="row"><span class="lbl">Units</span><span class="filters">${buttons.join("")}</span></span>`;
}

// The header-level switch (spec 243, moved out of the "…" menu; a
// popup of its own since PaceUp's own header is the reference for HOW,
// not just where — one icon that names the current choice, a dropdown
// underneath for the other two). Its own `.menu`, distinct from the
// "…" one, so it gets the same outside-click/Escape close for free:
// `menu-script.ts`'s `closeAll` already targets every `details.menu`,
// not one in particular.
function themeControl(): string {
  // Auto is marked here, on the row AND on the trigger's icon, because
  // the server has no way to know what this reader picked —
  // `theme-script.ts` moves both once it does, the same `mark()` call
  // doing the row's `aria-current` and the trigger's icon together.
  const trigger = THEME_CHOICES.map(
    ([choice]) =>
      `<span data-theme-icon="${choice}"${choice === "auto" ? "" : " hidden"}>${THEME_ICONS[choice]}</span>`,
  ).join("");
  const rows = THEME_CHOICES.map(
    ([choice, label]) =>
      `<button type="button" data-theme-choice="${choice}"` +
      `${choice === "auto" ? ' aria-current="true"' : ""}>${THEME_ICONS[choice]}<span>${label}</span></button>`,
  ).join("");
  return (
    `<details class="menu theme"><summary aria-label="Theme" title="Theme">${trigger}</summary>` +
    `<div class="menupanel">${rows}</div>` +
    `</details>`
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

function pageHeader(): string {
  return (
    `<header>${WORDMARK}` +
    // Theme sits beside the "…" trigger, both at the header's right-hand
    // end (spec 243) — a header-level control the reader reaches
    // without opening the menu first, not one more item behind it.
    `<span class="row">${themeControl()}` +
    // The trigger is a QUIET icon — no border, no button chrome; a round
    // hover flat is all (PaceUp's header menu is the reference).
    `<details class="menu"><summary aria-label="More">` +
    `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">` +
    `<circle cx="8" cy="3" r="1.4"></circle><circle cx="8" cy="8" r="1.4"></circle>` +
    `<circle cx="8" cy="13" r="1.4"></circle></svg></summary>` +
    // Units, then Settings, then About: reached-for-constantly first,
    // reached-for-rarely last (spec 243).
    `<div class="menupanel">${unitControl()}<a href="/settings">Settings</a><a href="about.html" data-about>About</a></div>` +
    `</details></span></header>`
  );
}

function tabBar(entries: NavEntry[], currentPath: string): string {
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
    tab("Specs", "/", currentPath === "/") +
    tab("Projects", projectsPage!.path, projectsPage!.path === currentPath || onAProject) +
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
  } = {},
): string {
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
  const installWarning = lastInstallWarning();
  const installBanner = installWarning ? rowMessage("warn", installWarning, { tag: "p" }) : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${refresh}
<title>${esc(opts.docTitle ?? `aide -board · ${title}`)}</title>
${ICON_LINKS}
${PWA_LINKS}
<style>${CSS}</style>
<script>${THEME_SCRIPT}${UNIT_SCRIPT}${MENU_SCRIPT}${SW_REGISTER_SCRIPT}${FORM_BUSY_SCRIPT}${NAV_BUSY_SCRIPT}${NAV_OVERLAY_SCRIPT}</script>
</head>
<body>
${pageHeader()}
${installBanner}
${aboutDialog(opts.buildStamp)}
${tabBar(entries, currentPath)}
<main>
${opts.hideHeading ? "" : `<div class="pagehead"><h1>${esc(title)}</h1></div>\n`}${body}
</main>${script}${scriptSrc}
</body>
</html>
`;
}
