// The frame every page sits in: the header, the two tabs under it, and
// the document around them. Self-contained by design — inline CSS, no
// external references — because the generated site is published as
// plain files.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CSS } from "./css.ts";
import { ICON_LINKS, WORDMARK } from "./brand.ts";
import { filterPills } from "./components.ts";
import { esc } from "./html.ts";

export interface NavEntry {
  label: string;
  path: string;
}

// The theme switcher's own code is TypeScript like the rest of the
// repo; the browser needs JavaScript. Transpiled once, here, the way
// `serve.ts` does it for `queue-client.ts` — Bun has the transpiler
// in-process, so this needs no build step and no bundle in the repo.
const THEME_SCRIPT = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(
  readFileSync(join(import.meta.dir, "theme-script.ts"), "utf-8"),
);

// Dark, Light, Auto. Not tabs: they are not a page to go to, so they
// sit inside the "…" menu rather than in the tab bar, and mark the
// chosen one with `aria-current` rather than the `current` class,
// which means "the page you are on".
const THEME_CHOICES: [string, string][] = [["dark", "Dark"], ["light", "Light"], ["auto", "Auto"]];

function themeControl(): string {
  // Auto is marked here because the server has no way to know what this
  // reader picked — `theme-script.ts` moves the marker once it does.
  const buttons = THEME_CHOICES.map(
    ([choice, label]) =>
      `<button type="button" data-theme-choice="${choice}"` +
      `${choice === "auto" ? ' aria-current="true"' : ""}>${label}</button>`,
  );
  return `<span class="lbl">Theme</span><span class="filters">${buttons.join("")}</span>`;
}

// The mark on the left, the "…" menu on the right. The wordmark is
// already a link home (`brand.ts`), so the logo IS the home button —
// there is no second control saying the same thing.
//
// The menu is a native <details>, the same disclosure `.newspec` and
// `.intro` already are: it opens with JavaScript off, and it keeps the
// promise that a generated page carries the theme switcher and no
// other script.
function pageHeader(): string {
  return (
    `<header>${WORDMARK}` +
    `<details class="menu"><summary aria-label="More">&hellip;</summary>` +
    `<div class="menupanel"><a href="about.html">About</a>${themeControl()}</div>` +
    `</details></header>`
  );
}

function tabBar(entries: NavEntry[], currentPath: string): string {
  // The first entry is the Projects page; the rest are the project
  // pages, which are NOT tabs — the Projects page lists them, and two
  // lists of the same projects were one too many. A project's own page
  // counts as being "in" Projects, so that tab is current there too.
  const [projectsPage, ...projects] = entries;
  const onAProject = projects.some((p) => p.path === currentPath);
  // The spec list is `/` for the list itself AND for every job detail
  // page — `job-page.ts` passes the literal `"/"` — so one check covers
  // both halves of Specs.
  const pills = filterPills(
    "toptab",
    "",
    [
      { label: "Specs", on: currentPath === "/", href: "/" },
      {
        label: "Projects",
        on: projectsPage!.path === currentPath || onAProject,
        href: projectsPage!.path,
      },
    ],
    "page",
  );
  // A bare <nav>: it is the page's navigation, and the pills inside it
  // are the same control the job page's own tabs are.
  return `<nav>${pills}</nav>`;
}

export function pageShell(
  title: string,
  entries: NavEntry[],
  currentPath: string,
  body: string,
  generatedAt: string,
  refreshSeconds?: number,
  opts: { refreshInNoscript?: boolean; script?: string; docTitle?: string } = {},
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
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${refresh}
<title>${esc(opts.docTitle ?? `aide · ${title}`)}</title>
${ICON_LINKS}
<style>${CSS}</style>
<script>${THEME_SCRIPT}</script>
</head>
<body>
${pageHeader()}
${tabBar(entries, currentPath)}
<main>
<div class="pagehead"><h1>${esc(title)}</h1><span class="stamp">Generated ${esc(generatedAt)}</span></div>
${body}
</main>${script}
</body>
</html>
`;
}
