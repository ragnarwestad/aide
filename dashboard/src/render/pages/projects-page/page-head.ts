// The project page's head line: a breadcrumb back to the Projects list, and
// a picker that opens another project's page on the tab open now.

import { ICON_CHEVRON, projectIcon, type ProjectIconView } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import { orderProjects } from "./overview-list.ts";
import { PROJECTS_ROUTE, projectPagePath } from "./routes.ts";

type Listed = { name: string; icon: ProjectIconView };

/** "Projects / <name>", the name the page's `<h1>` and no link, with the
 *  picker at the far end. The picker is a `details.menu` of links, so it
 *  closes as every other menu does (`menu-script.ts`) and works without
 *  script. Its links are `projects` as given, so a hidden project is not
 *  offered even on its own page, where the trigger and the breadcrumb
 *  still name it. The current project, when listed, is marked
 *  `aria-current="true"`, so it is never taken for the open tab. */
export function projectPageHead(o: {
  name: string;
  icon: ProjectIconView;
  tab: string;
  projects: readonly Listed[];
  /** The pinned projects, listed first. Absent: none is. */
  pinned?: ReadonlySet<string>;
  lang: Language;
}): string {
  const label = esc(t(o.lang, "project.pickerLabel"));
  const links = orderProjects(o.projects, o.pinned)
    .map((p) =>
      `<a href="${esc(`${projectPagePath(p.name)}?tab=${encodeURIComponent(o.tab)}`)}"` +
      `${p.name === o.name ? ' aria-current="true"' : ""}>${projectIcon(p.name, p.icon)}<span>${esc(p.name)}</span></a>`,
    )
    .join("");
  return (
    `<div class="projecthead">` +
    `<nav class="breadcrumb" aria-label="${esc(t(o.lang, "project.breadcrumbAria"))}">` +
    `<a href="${PROJECTS_ROUTE}">${esc(t(o.lang, "shell.tabProjects"))}</a>` +
    `<span class="crumbsep" aria-hidden="true">/</span>` +
    `<h1>${esc(o.name)}</h1></nav>` +
    `<details class="menu projectpicker">` +
    `<summary aria-label="${label}">${projectIcon(o.name, o.icon)}<span class="pickername">${esc(o.name)}</span>${ICON_CHEVRON}</summary>` +
    `<div class="menupanel" role="group" aria-label="${label}">${links}</div>` +
    `</details></div>`
  );
}
