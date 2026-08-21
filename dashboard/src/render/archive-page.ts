// `/archive` — every archived spec, grouped by project (spec 163).
//
// An archived spec's own page has worked since spec 150: `specDir()`
// resolves an archived folder because the scan loop records the
// directory of EVERY spec it finds, and only then drops the archived
// ones from the list. So the pages were there and nothing linked to
// one — reading an archived spec meant going to whichever specs
// repository it lives in and opening the files by hand.
//
// One page with a heading per project, not a tab per project. Four
// projects are allowlisted today and three of them have a handful of
// archived specs each; a tab would cost them a click and show nothing
// for it. The one project that IS long — aide, at 79 and counting —
// gets the jump-links at the top instead, which is the same answer
// this repo's own long markdown pages give. `/projects` is the only
// existing multi-project view here and it is one page too.

import { esc } from "./html.ts";
import { pageShell, type NavEntry } from "./shell.ts";
import { ARCHIVE_ROUTE } from "./site.ts";

export interface ArchivedSpecView {
  /** The spec's folder, which is also its number — what a person calls
   *  it when they go looking for it. */
  folder: string;
  /** Its H1, when `1-description.md` has one. */
  title?: string;
  /** When it was archived: the `4-status.md` stamp, or failing that the
   *  commit that last touched the folder. `null` when neither answers,
   *  and the row says so in words rather than leaving the cell blank. */
  archivedAt: string | null;
  /** Where the page that already worked lives. Built by the server from
   *  the same function the spec list links through. */
  href: string;
}

export interface ArchiveProjectView {
  name: string;
  /** Newest first, and the undated ones last: an archive only grows,
   *  and what someone came to look up is far more often recent. */
  specs: ArchivedSpecView[];
}

export interface ArchivePageView {
  projects: ArchiveProjectView[];
}

/** The anchor a project's jump-link points at. A project name is a
 *  directory name — letters, digits, dots and dashes — so it is already
 *  a usable id, and prefixing it keeps it from colliding with anything
 *  else on the page. */
const projectAnchor = (name: string): string => `project-${name}`;

/** What the date cell says when the spec carries no stamp and git
 *  cannot date its folder either — a folder copied in rather than
 *  committed. Spelled out here so the listing and its test cannot word
 *  the same absence differently. */
export const NO_DATE = "date unknown";

function specRow(spec: ArchivedSpecView): string {
  const title = spec.title ? `<p class="desc">${esc(spec.title)}</p>` : "";
  return (
    `<div class="proj-row"><div><a href="${esc(spec.href)}">${esc(spec.folder)}</a>` +
    `<span class="counts">${esc(spec.archivedAt ?? NO_DATE)}</span>` +
    title +
    `</div></div>`
  );
}

export function renderArchivePage(
  view: ArchivePageView,
  generatedAt: string,
  entries: NavEntry[],
): string {
  const withSpecs = view.projects.filter((p) => p.specs.length > 0);
  const total = withSpecs.reduce((n, p) => n + p.specs.length, 0);
  const body = !withSpecs.length
    ? `<p class="empty">Nothing has been archived yet.</p>`
    : `<p class="summary">${withSpecs.length} projects · ${total} archived</p>\n` +
      // The jump-links: what makes one long page workable rather than
      // four short ones. Skipped when there is only one project to jump
      // to, which is a link to the heading directly below it.
      (withSpecs.length > 1
        ? `<p class="listnote">` +
          withSpecs
            .map((p) => `<a href="#${esc(projectAnchor(p.name))}">${esc(p.name)}</a>`)
            .join(" · ") +
          `</p>\n`
        : "") +
      withSpecs
        .map(
          (p) =>
            `<h2 id="${esc(projectAnchor(p.name))}">${esc(p.name)}` +
            `<span class="counts">${p.specs.length} archived</span></h2>\n` +
            p.specs.map(specRow).join("\n"),
        )
        .join("\n");

  // No meta refresh: the archive is a record, and a record does not
  // change under the reader.
  //
  // And no heading: the tab says "Archive", and the shell's <h1> said it
  // again directly under it (2026-08-21). The page's own headings are
  // the project names, which is what a reader is actually scanning for.
  return pageShell("Archive", entries, ARCHIVE_ROUTE, body, generatedAt, undefined, {
    hideHeading: true,
  });
}
