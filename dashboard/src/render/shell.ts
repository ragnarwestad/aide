// The frame every page sits in: the left-column nav and the document
// around it. Self-contained by design — inline CSS, no external
// references — because the generated site is published as plain files.

import { CSS } from "./css.ts";
import { ICON_LINKS, WORDMARK } from "./brand.ts";
import { esc } from "./html.ts";

export interface NavEntry {
  label: string;
  path: string;
}

export function nav(entries: NavEntry[], currentPath: string): string {
  const link = (e: NavEntry) => {
    const cls = e.path === currentPath ? ' class="current"' : "";
    return `<li><a${cls} href="${esc(e.path)}">${esc(e.label)}</a></li>`;
  };
  const [overview, ...projects] = entries;
  const lis = [
    // The spec list leads: since spec 100 it IS the front page, and
    // everything else in this menu sits under it.
    link({ label: "Specs", path: "/" }),
    link(overview),
    link({ label: "About", path: "about.html" }),
    `<li class="lbl">Projects</li>`,
    ...projects.map(link),
  ];
  // The mark sits above the link list, per the brand handoff's step 2.
  return `<nav>${WORDMARK}<ul>${lis.join("")}</ul></nav>`;
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
  // At the END of the body, never in <head>: an inline script in the
  // head runs before the elements exist, so every listener it tries to
  // attach silently attaches to nothing. (Which is exactly what
  // happened: the table still refreshed on its timer, so it looked
  // like the code was running.)
  const script = opts.script ? `\n<script>${opts.script}</script>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${refresh}
<title>${esc(opts.docTitle ?? `aide · ${title}`)}</title>
${ICON_LINKS}
<style>${CSS}</style>
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
