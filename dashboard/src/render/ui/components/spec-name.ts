// A spec's name is written `project:folder` in a few places, and its
// project part is a link to that project's page wherever the name can
// be drawn as markup. One function makes that link, so its address and
// its escaping are the same everywhere.

import { capitalizeFirst } from "../../../format/error-sentence.ts";
import { t, type Language, type TranslationKey } from "../../../i18n";
// The page barrels import ui/components back, so these two stay direct.
// noinspection ES6PreferShortImport
import { projectPagePath } from "../../pages/projects-page/routes.ts";
// noinspection ES6PreferShortImport
import { specPagePath } from "../../pages/spec-page/tabs.ts";
import { esc } from "../html.ts";
import { isSpecFolder } from "../shell.ts";

/** The project's name as a link to its page. Every link carries
 *  `data-goto`: it leaves the page for another document, and a clicked
 *  one is marked waiting. */
export function projectLink(project: string, o: { className?: string } = {}): string {
  const cls = o.className ? ` class="${esc(o.className)}"` : "";
  return `<a${cls} data-goto href="${esc(projectPagePath(project))}">${esc(project)}</a>`;
}

/** A job's name as a sentence shows it: `project:<spec folder>` is
 *  cut to `project:<number>`, so a sentence naming several stays short.
 *  Anything else — a short id, a create job's `new-…` key, a scheduled
 *  job's `schedule-…` key — is shown whole. */
function shortJobName(name: string): string {
  const colon = name.indexOf(":");
  if (colon <= 0) return name;
  const folder = name.slice(colon + 1);
  if (!isSpecFolder(folder)) return name;
  return `${name.slice(0, colon)}:${folder.slice(0, folder.indexOf("-"))}`;
}

/** A job's name as markup: `project:<number>` is two links, the
 *  project's and the spec's (the colon stands in the spec's), and the
 *  spec's carries the whole folder as its title. Anything else has no
 *  spec page and stays escaped text. */
function jobName(name: string): string {
  const colon = name.indexOf(":");
  if (colon <= 0) return esc(name);
  const project = name.slice(0, colon);
  const folder = name.slice(colon + 1);
  if (!isSpecFolder(folder)) return esc(name);
  return (
    projectLink(project) +
    `<a data-goto href="${esc(specPagePath(project, folder))}" title="${esc(name)}">` +
    `:${esc(folder.slice(0, folder.indexOf("-")))}</a>`
  );
}

const JOBS_MARK = "\u0000jobs\u0000";

/** A sentence that names running jobs, as plain text and as markup.
 *  `html` is for `rowMessage`'s `html` option: every piece of it is
 *  escaped here — the message's own words and each name — so nothing a
 *  caller passes reaches the page as markup. Only the message with its
 *  `{jobs}` filled is built this way; hand `html` nothing else. */
export function jobsSentence(
  lang: Language,
  key: TranslationKey,
  values: Record<string, string | number>,
  names: string[],
): { text: string; html: string } {
  const text = t(lang, key, { ...values, jobs: names.map(shortJobName).join(", ") });
  const pieces = t(lang, key, { ...values, jobs: JOBS_MARK }).split(JOBS_MARK);
  const html = pieces
    .map((piece, i) => esc(i === 0 ? capitalizeFirst(piece) : piece))
    .join(names.map(jobName).join(", "));
  return { text, html };
}
