// The whole stylesheet, in real .css files under css/, read and joined
// here into one string. It is INLINED into every page rather than
// served as a file: the generated site is published by rsync and has
// to work from a folder, with no server and no second request. That
// constraint is why this is joined into a plain string rather than
// linked with a <link>; it is no longer why the CSS itself lives in
// TypeScript (split css.ts into real .css files) — nothing here needed
// to be a template literal, since every ${…} it ever carried was
// static text (the light/dark colour blocks, the two SVG chevrons),
// never logic. Bun reads each file the same way `queueClientScript`
// reads `queue-client.ts` — synchronously, once, in-process, no build
// step and no bundle checked into the repo.
//
// One token block, six components, and nothing else. Every colour, type
// size, space and radius below is a `var(--…)` read from the block at
// the top — which is the ONLY place a literal may appear across these
// files. `test/css-token-guard.test.ts` enforces that by scanning them
// between the `tokens:start`/`tokens:end` sentinels, and refuses any
// class a render file emits that is not one of the components. A spec
// that wants a look it cannot build from these has to change the
// TOKENS, visibly, rather than add a colour beside them.
//
// The values come from the brand handoff and the design sheet
// (`specs/102-design-foundation/assets/`): warm neutrals, vermilion for
// the accent, and danger carried by the darkest bar of the mark — not
// by a shade of the accent, so "running" and "refused" never rest on
// hue alone.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One file per section, in the exact order they used to appear inside
 *  the single template literal — order matters for CSS specificity in
 *  a few places (`tokens.css`'s own header explains the one that most
 *  depends on it), so this list is not alphabetised. */
const SECTIONS = [
  "tokens.css",
  "page.css",
  "brand.css",
  "text-roles.css",
  "button.css",
  "status-badge.css",
  "phase-chip.css",
  "remaining-checks.css",
  "row-message.css",
  "field.css",
  "filter-pill.css",
  "list.css",
  "rows-and-forms.css",
  "job-page.css",
  "project-overview.css",
  "narrow.css",
];

export const CSS =
  "\n" + SECTIONS.map((file) => readFileSync(join(import.meta.dir, "css", file), "utf-8")).join("");
