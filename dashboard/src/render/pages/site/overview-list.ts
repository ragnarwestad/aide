// The `/projects` list: the counts, then one row per project. Split
// out of site.ts by theme (split site.ts by theme).

import { rowMessage } from "../../ui/components.ts";
import { esc } from "../../ui/html.ts";
import type { ProjectView } from "./types.ts";

// `removeHref` only on the served page: a generated file has no token
// behind it, so its rows carry no control (asked for 2026-08-19 —
// Remove lives ON the row, at the right of the description).
function overviewRow(
  p: ProjectView,
  path: string,
  removeHref?: string,
  note?: string,
): string {
  const remove = removeHref ? `<a class="btn small proj-row-action" href="${esc(removeHref)}">Remove</a>` : "";
  const projectLink = `<a class="proj-row-link" href="${esc(path)}">${esc(p.name)}</a>`;
  // Spec 142: on the row, not floating above the list — a reader should
  // not have to work out which project a warning is about. An error row
  // gets it too: a checkout whose manifest will not parse is still a
  // checkout that can fall behind, and it is the one being worked on.
  const drift = note ? rowMessage("warn", note, { tag: "p" }) : "";
  if (!p.manifest.ok) {
    return (
      `<div class="proj-row error"><div>${projectLink}` +
      `<p class="error-text">Manifest failed to parse: ${esc(p.manifest.error)}</p>${drift}</div>${remove}</div>`
    );
  }
  const active = p.specs.filter((s) => !s.archived).length;
  const archived = p.specs.length - active;
  const desc = p.manifest.data.description
    ? `<p class="desc">${esc(p.manifest.data.description)}</p>`
    : "";
  return (
    `<div class="proj-row"><div>${projectLink}` +
    `<span class="counts">${active} active · ${archived} archived</span>` +
    desc +
    drift +
    `</div>${remove}</div>`
  );
}

/** The counts, and nothing else. Read on a phone the explanation filled
 *  the screen before anything the reader came for; it is documentation,
 *  and documentation has its own page in the menu.
 *
 *  Separate from the list since 2026-08-21: it rides on the list's own
 *  top line beside the Add button, the way the spec list's count and
 *  its New spec link share the filter row. The list itself then starts
 *  with a row, and the word "Projects" is said once — in the tab. */
export function projectSummary(projects: ProjectView[]): string {
  const active = projects.reduce((n, p) => n + p.specs.filter((s) => !s.archived).length, 0);
  const archived = projects.reduce((n, p) => n + p.specs.filter((s) => s.archived).length, 0);
  return (
    `<span class="summary">${projects.length} projects · ` +
    `${active} active · ${archived} archived</span>`
  );
}

/** The listing itself: the counts, then one row per project, linking to
 *  each project's generated page. Exported because the served
 *  `/projects` page draws exactly this (spec 115) — same rows, same
 *  data, one function, so "the same page plus two controls" is true by
 *  construction rather than by convention. */
export function projectListBody(
  projects: ProjectView[],
  opts: {
    /** Where a project's NAME goes: the page the server serves for it,
     *  which is the one carrying the settings and the readiness answer
     *  (spec 185). There is no other project page to link — the
     *  generated per-project files went on 2026-08-22. */
    pageHref: (name: string) => string;
    removeHref?: (name: string) => string | undefined;
    /** Spec 142: what to say on a project's row about its checkout, if
     *  anything. A callback like `removeHref`, and for the same reason:
     *  `ProjectView` is a pure disk scan the static generator shares,
     *  and a live git answer does not belong on it. */
    note?: (name: string) => string | undefined;
  },
): string {
  const ordered = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  return (
    ordered
      .map((p) =>
        overviewRow(
          p,
          opts.pageHref(p.name),
          opts.removeHref?.(p.name),
          opts.note?.(p.name),
        ),
      )
      .join("\n")
  );
}
