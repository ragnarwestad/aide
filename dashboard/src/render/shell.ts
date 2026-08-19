// The frame every page sits in: the left-column nav and the document
// around it. Self-contained by design — inline CSS, no external
// references — because the generated site is published as plain files.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CSS } from "./css.ts";
import { ICON_LINKS, WORDMARK } from "./brand.ts";
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

// Dark, Light, Auto. Not <li><a> entries: they are not a third page to
// go to, so they sit under the link list rather than in it, and mark
// the chosen one with `aria-current` rather than the `current` class,
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

export function nav(entries: NavEntry[], currentPath: string): string {
  const link = (e: NavEntry, current: boolean) => {
    const cls = current ? ' class="current"' : "";
    return `<li><a${cls} href="${esc(e.path)}">${esc(e.label)}</a></li>`;
  };
  // The first entry is the Projects page; the rest are the project
  // pages, which are NOT listed here — the Projects page lists them,
  // and two lists of the same projects were one too many. A project's
  // own page counts as being "in" Projects, so that entry is current
  // there too.
  const [projectsPage, ...projects] = entries;
  const onAProject = projects.some((p) => p.path === currentPath);
  const lis = [
    // No "Specs" entry: the spec list IS the front page (spec 100), and
    // the wordmark above this list is the way home — a second link to
    // `/` said the same thing twice.
    link(projectsPage, projectsPage.path === currentPath || onAProject),
    link({ label: "About", path: "about.html" }, currentPath === "about.html"),
  ];
  // The mark sits above the link list, per the brand handoff's step 2.
  return `<nav>${WORDMARK}<ul>${lis.join("")}</ul>${themeControl()}</nav>`;
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
<div class="layout">
${nav(entries, currentPath)}
<main>
<div class="pagehead"><h1>${esc(title)}</h1><span class="stamp">Generated ${esc(generatedAt)}</span></div>
${body}
</main>
</div>${script}
</body>
</html>
`;
}
