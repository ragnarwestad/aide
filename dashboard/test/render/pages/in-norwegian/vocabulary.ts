// The checker behind the Norwegian page tests: it reads every word a person
// reads inside a page's <main> and reports the ones the Norwegian catalogue
// does not hold, so a word written in the page code instead of read with
// `t()` fails and is named.

import { Window } from "happy-dom";
import { MESSAGES } from "../../../../src/messages/catalog.ts";
import { translations } from "../../../../src/i18n/translations.ts";
import { STEP_LABELS_NB } from "../../../../src/format/step-label.ts";
import { TOOL_NAMES } from "../../../../src/render/pages/specs-list";
import { INSTALL_TARGETS } from "../../../../src/render/pages/settings-page/places.ts";

/** Attributes whose value is read by a person. */
const WORD_ATTRIBUTES = ["placeholder", "title", "aria-label", "data-pending", "data-on", "data-off", "label"];

/** Names the board shows as they are, each under one of the
 *  description's Out of scope categories: tools and models, files, the
 *  settings keys shown beside a label. */
export const NAMES: readonly string[] = [
  // Names of tools and models.
  ...Object.values(TOOL_NAMES),
  "Claude Code", "Claude", "Codex", "Copilot", "OpenCode", "Fake-Claude",
  // Names of files and the settings keys: where each AI keeps what aide installs for it.
  ...INSTALL_TARGETS.flatMap((row) => [row.to, row.from]),
  ".aide/config", ".aide/project.yaml", "settings.yaml", "project.yaml",
  "AIDE_SPECS_PATH", "AIDE_TEST_CMD", "AIDE_INSTALL_CMD", "worktreeLinks", "acPrefix", "previewCmd",
  "codeLanding", "previewFrom", "specsPath", "installCmd", "testCmd", "gitUrl", "description",
];

const TIME_STAMP = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z| UTC)?/g;

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
  for (const text of Object.values(STEP_LABELS_NB)) for (const w of wordsIn(text)) vocabulary.add(w);
  const englishOnly = new Set([...english.keys()].filter((text) => !norwegian.has(text)));
  cached = { vocabulary, englishOnly };
  return cached;
}

/** Every text a person reads inside `<main>`: the text nodes outside
 *  script, style and template, and the words-carrying attributes. */
export function textsOf(html: string): string[] {
  const win = new Window();
  try {
    win.document.write(html);
    const main = win.document.querySelector("main");
    if (!main) return [];
    const texts: string[] = [];
    const walk = (node: any): void => {
      if (node.nodeType === 3) {
        const text = String(node.textContent ?? "").trim();
        if (text) texts.push(text);
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = String(node.tagName).toLowerCase();
      if (tag === "script" || tag === "style" || tag === "template") return;
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
export function wordsNotInCatalogue(html: string, data: readonly string[] = []): string[] {
  const { vocabulary, englishOnly } = catalogue();
  const cuts = [...data, ...NAMES].filter(Boolean).sort((a, b) => b.length - a.length);
  const found: string[] = [];
  for (const text of textsOf(html)) {
    if (englishOnly.has(text)) {
      found.push(text);
      continue;
    }
    let rest = text.replace(TIME_STAMP, " ");
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
export function assertInNorwegian(page: string, html: string, data: readonly string[] = []): void {
  const words = wordsNotInCatalogue(html, data);
  if (words.length) throw new Error(describeFailure(page, words));
}
