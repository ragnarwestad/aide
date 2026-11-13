// The checker behind the Norwegian page tests: it reads every word a person
// reads inside a page's <main>, or its whole <body> with the shell, and reports the ones the Norwegian catalogue
// does not hold, so a word written in the page code instead of read with
// `t()` fails and is named.

import { Window } from "happy-dom";
import { MESSAGES } from "../../../../src/messages/catalog.ts";
import { translations } from "../../../../src/i18n/translations.ts";
import { STEP_LABELS_NB } from "../../../../src/format/step-label.ts";
import { GERUND_NB } from "../../../../src/format/gerund.ts";
import { TOOL_NAMES } from "../../../../src/render/pages/specs-list";
import { INSTALL_TARGETS } from "../../../../src/render/pages/settings-page/places.ts";
import { LANGUAGE_NATIVE_NAMES } from "../../../../src/render/ui/header-controls.ts";

/** Attributes whose value is read by a person. */
const WORD_ATTRIBUTES = ["placeholder", "title", "aria-label", "data-pending", "data-on", "data-off", "label"];

/** Names the board shows as they are, each under one of the
 *  description's Out of scope categories: tools and models, files, the
 *  settings keys shown beside a label. */
export const NAMES: readonly string[] = [
  // Names of tools and models.
  ...Object.values(TOOL_NAMES),
  "Claude Code", "Claude", "Codex", "Copilot", "OpenCode", "Fake-Claude",
  // The board's own name, and each language's own name in the language menu.
  "aide -board", ...Object.values(LANGUAGE_NATIVE_NAMES),
  // Names of files and the settings keys: where each AI keeps what aide installs for it.
  ...INSTALL_TARGETS.flatMap((row) => [row.to, row.from]),
  // Commands and a heading of a spec's own files, written as code.
  "/aide-analyze", "/aide-implement", "## Acceptance criteria",
  ".aide/config", ".aide/project.yaml", "settings.yaml", "project.yaml",
  "AIDE_SPECS_PATH", "AIDE_TEST_CMD", "AIDE_INSTALL_CMD", "worktreeLinks", "acPrefix", "previewCmd",
  "codeLanding", "previewFrom", "specsPath", "installCmd", "testCmd", "gitUrl", "description",
];

const TIME_STAMP = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z| UTC)?/g;
/** A duration: figures with unit symbols, `29m 00s`, `249h 02m`, `5s`. */
const DURATION = /\b\d+[hms](?: \d+[ms])?\b/g;

const blanks = (text: string): string => text.replace(/\{[A-Za-z0-9_.]+\}/g, " ");
const wordsIn = (text: string): string[] => text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);

interface Catalogue {
  vocabulary: Set<string>;
  /** English texts whose Norwegian differs, and that are not a Norwegian text themselves. */
  englishOnly: Set<string>;
}

let cached: Catalogue | undefined;

/** The Norwegian words of the catalogue, and the English texts that must
 *  not stand alone on a page. */
export function catalogue(): Catalogue {
  if (cached) return cached;
  const vocabulary = new Set<string>();
  const norwegian = new Set<string>();
  const english = new Map<string, string>();
  const take = (en: string, nb: string) => {
    for (const w of wordsIn(blanks(nb))) vocabulary.add(w);
    norwegian.add(nb.trim());
    if (en.trim() !== nb.trim()) english.set(en.trim(), nb.trim());
  };
  const nbTexts = translations.nb as Record<string, string>;
  for (const [key, en] of Object.entries(translations.en)) take(en, nbTexts[key]!);
  for (const entry of Object.values(MESSAGES)) take(entry.en, entry.nb);
  for (const text of [...Object.values(STEP_LABELS_NB), ...Object.values(GERUND_NB)]) for (const w of wordsIn(text)) vocabulary.add(w);
  const englishOnly = new Set([...english.keys()].filter((text) => !norwegian.has(text)));
  cached = { vocabulary, englishOnly };
  return cached;
}

/** Every text a person reads inside `<main>`, or the whole `<body>` with the
 *  page shell, and the page's `<title>`: the text nodes outside script, style and template, and the
 *  words-carrying attributes. A one-letter text inside an `aria-hidden`
 *  element is a pip's mark, the first letter of its title, which is read
 *  in full; it is skipped. */
export function textsOf(html: string, read: "main" | "body" = "main"): string[] {
  const win = new Window();
  try {
    win.document.write(html);
    const main = win.document.querySelector(read);
    if (!main) return [];
    // The page's title, which the browser shows on its tab.
    const title = String(win.document.querySelector("head > title")?.textContent ?? "").trim();
    const texts: string[] = title ? [title] : [];
    const walk = (node: any): void => {
      if (node.nodeType === 3) {
        const text = String(node.textContent ?? "").trim();
        if (text.length === 1 && node.parentElement?.closest("[aria-hidden=true]")) return;
        if (text) texts.push(text);
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = String(node.tagName).toLowerCase();
      if (tag === "script" || tag === "style" || tag === "template") return;
      // A name the page marks as one, such as the board's wordmark.
      if (node.getAttribute?.("translate") === "no") return;
      for (const name of WORD_ATTRIBUTES) {
        const value = node.getAttribute?.(name);
        if (value && value.trim()) texts.push(value.trim());
      }
      for (const child of node.childNodes) walk(child);
    };
    walk(main);
    return texts;
  } finally {
    void win.happyDOM.close();
  }
}

/** The words of a page not read from the catalogue, in the order the page
 *  shows them. `data` is what the fixture wrote itself: names, titles,
 *  paths, tool output. */
export function wordsNotInCatalogue(html: string, data: readonly string[] = [], read: "main" | "body" = "main"): string[] {
  const { vocabulary, englishOnly } = catalogue();
  const cuts = [...data, ...NAMES].filter(Boolean).sort((a, b) => b.length - a.length);
  const found: string[] = [];
  for (const text of textsOf(html, read)) {
    if (englishOnly.has(text)) {
      found.push(text);
      continue;
    }
    let rest = text.replace(TIME_STAMP, " ").replace(DURATION, " ");
    for (const cut of cuts) rest = rest.split(cut).join(" ");
    for (const word of wordsIn(rest)) if (!vocabulary.has(word) && !found.includes(word)) found.push(word);
  }
  return found;
}

/** The message a failing page test shows: the page, then each word. */
export function describeFailure(page: string, words: readonly string[]): string {
  return `${page}: ${words.map((w) => `"${w}"`).join(", ")}`;
}

/** Throws, naming the page and the words, when the page holds a word the
 *  Norwegian catalogue does not. */
export function assertInNorwegian(page: string, html: string, data: readonly string[] = [], read: "main" | "body" = "main"): void {
  const words = wordsNotInCatalogue(html, data, read);
  if (words.length) throw new Error(describeFailure(page, words));
}
