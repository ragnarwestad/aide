// The `/projects` list: the counts, then one card with a row per project,
// and the hidden projects in a fold of their own under it.

import { ICON_WARN, askButton, cardRow, cardSection, foldDisclosure, progressDialog, projectIcon, rowMessage, type ProjectIconView } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import { pinnedFirst } from "../../../project/project-admin/pinned.ts";
import type { ProjectView } from "./types.ts";

/** The project's own description, from its manifest — the
 *  `.desc` paragraph both the projects list and a project's own page
 *  draw, empty wherever there is none to show. */
export function projectDescription(p: ProjectView): string {
  return p.manifest.ok && p.manifest.data.description
    ? `<p class="desc">${esc(p.manifest.data.description)}</p>`
    : "";
}

/** Remove, at the far right of a project's row: the
 *  danger button a schedule entry's row has, opening the dialog Remove
 *  project has always asked in. One dialog per row, its id naming the
 *  project; a refusal is written in the dialog's own line, and success
 *  draws the list again (`submitProjectChange`). */
function projectRemoveControl(name: string, lang: Language): string {
  const id = `removeask-${name}`;
  const label = t(lang, "project.remove");
  return (
    askButton({ label, dialogId: id, variant: "danger", ariaLabel: `${label} ${name}` }) +
    progressDialog(lang, {
      id,
      title: t(lang, "dialog.removing"),
      ask: {
        title: t(lang, "project.removeTitle", { name }),
        sentence: t(lang, "project.removeSentence", { name }),
        ok: { variant: "danger", pending: t(lang, "dialog.removing") },
        post: { action: `/api/queue/projects/${encodeURIComponent(name)}/remove`, hook: "removeform" },
      },
    })
  );
}

function overviewRow(
  p: ProjectView,
  path: string,
  icon: ProjectIconView,
  note?: string,
  warnHref?: string,
  lang: Language = "en",
  removable = false,
): string {
  // The readiness sentence itself is on the project's own page — this is
  // only a pointer to it, so it rises above the row's link.
  const warn = warnHref
    ? `<a class="cardrowwarn" href="${esc(warnHref)}" title="${esc(t(lang, "project.cannotRunTitle"))}" aria-label="${esc(t(lang, "project.cannotRunAria"))}">${ICON_WARN}</a>`
    : "";
  const del = removable ? projectRemoveControl(p.name, lang) : "";
  // On the row, not floating above the list — a reader should
  // not have to work out which project a warning is about. An error row
  // gets it too: a checkout whose manifest will not parse is still a
  // checkout that can fall behind, and it is the one being worked on.
  const drift = note ? rowMessage("waiting", note, { tag: "p" }) : "";
  const common = {
    lead: projectIcon(p.name, icon),
    link: { href: path, text: p.name },
    trailing: warn + del,
    data: { project: p.name },
  };
  if (!p.manifest.ok) {
    return cardRow({
      ...common,
      error: true,
      explain: `<p class="error-text">${esc(t(lang, "project.manifestFailed", { error: p.manifest.error }))}</p>${drift}`,
    });
  }
  const active = p.specs.filter((s) => !s.archived).length;
  const archived = p.specs.length - active;
  return cardRow({
    ...common,
    title: `<span class="counts">${active} ${t(lang, "project.active")} · ${archived} ${t(lang, "project.archived")}</span>`,
    explain: projectDescription(p) + drift,
  });
}

/** The counts, and nothing else. Read on a phone the explanation filled
 *  the screen before anything the reader came for; it is documentation,
 *  and documentation has its own page in the menu.
 *
 *  Separate from the list since 2026-08-21: it rides on the list's own
 *  top line beside the Add button, the way the spec list's count and
 *  its New spec link share the filter row. The list itself then starts
 *  with a row, and the word "Projects" is said once — in the tab. */
export function projectSummary(projects: ProjectView[], lang: Language = "en"): string {
  const active = projects.reduce((n, p) => n + p.specs.filter((s) => !s.archived).length, 0);
  const archived = projects.reduce((n, p) => n + p.specs.filter((s) => s.archived).length, 0);
  return (
    `<span class="summary">${t(lang, "project.count", { n: projects.length })} · ` +
    `${active} ${t(lang, "project.active")} · ${archived} ${t(lang, "project.archived")}</span>`
  );
}

/** The Projects list's order: the pinned projects first, each group by
 *  name. The list and the project page's picker both draw in it. */
export function orderProjects<T extends { name: string }>(list: readonly T[], pinned: ReadonlySet<string> = new Set()): T[] {
  return pinnedFirst([...list].sort((a, b) => a.name.localeCompare(b.name)), pinned, (p) => p.name);
}

/** The listing itself: one card, a row per shown project, linking to
 *  each project's page. Exported because the served
 *  `/projects` page draws exactly this — same rows, same
 *  data, one function, so "the same page plus two controls" is true by
 *  construction rather than by convention. */
export function projectListBody(
  projects: ProjectView[],
  opts: {
    /** Where a project's NAME goes: the page the server serves for it,
     *  which is the one carrying the settings and the readiness answer
     *  There is no other project page to link — the
     *  generated per-project files went on 2026-08-22. */
    pageHref: (name: string) => string;
    /** What to say on a project's row about its checkout, if
     *  anything. A callback, because `ProjectView` is a pure disk scan
     *  the static generator shares, and a live git answer does not
     *  belong on it. */
    note?: (name: string) => string | undefined;
    /** Where the row's warning mark points, or undefined for
     *  no mark at all — a callback of the same shape as `note`, not a
     *  change to how the row is composed. */
    warnHref?: (name: string) => string | undefined;
    /** Whether the row offers Remove: a project on the allowlist. */
    removable?: (name: string) => boolean;
    /** Where the project's icon image is served, or null for a project
     *  with none, which draws its initials. Absent: initials for all. */
    icon?: (name: string) => ProjectIconView;
    /** The pinned projects, drawn first. Absent: none is. */
    pinned?: ReadonlySet<string>;
    /** The hidden projects, drawn in a shut "Hidden" fold after the
     *  others' card. Absent: none is. */
    hidden?: ReadonlySet<string>;
    lang?: Language;
  },
): string {
  const lang = opts.lang ?? "en";
  const ordered = orderProjects(projects, opts.pinned);
  const isHidden = (p: ProjectView): boolean => opts.hidden?.has(p.name) ?? false;
  const card = (list: ProjectView[]): string =>
    cardSection({
      body: list
        .map((p) =>
          overviewRow(
            p,
            opts.pageHref(p.name),
            opts.icon?.(p.name) ?? null,
            opts.note?.(p.name),
            opts.warnHref?.(p.name),
            lang,
            opts.removable?.(p.name) ?? false,
          ),
        )
        .join("\n"),
    });
  const shown = ordered.filter((p) => !isHidden(p));
  const hidden = ordered.filter(isHidden);
  return (
    (shown.length ? card(shown) : "") +
    (hidden.length
      ? foldDisclosure({ summary: `<span>${esc(t(lang, "project.hiddenGroup", { count: String(hidden.length) }))}</span>`, body: card(hidden) })
      : "")
  );
}
