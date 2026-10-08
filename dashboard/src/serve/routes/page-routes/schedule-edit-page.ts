// The page that makes a schedule entry, as a response to its own GET.
// Also where a save goes back to afterwards.
import { isBoardPath } from "../../../format/board-path.ts";
import type { ScheduleEntry } from "../../../queue/schedule.ts";
import { projectScheduleTab, renderScheduleNewPage, schedulePagePath } from "../../../render";
import { languageChoice, modelChoiceOptions, specsClientScript } from "../../serve-helpers";
import type { RoutesContext } from "..";

export { projectScheduleTab };

/** The `back` a form sent, if it is a path on this board; the fallback
 *  otherwise. It comes from the browser, so anything that could leave
 *  the board — another host, a scheme, a header break — is not used. */
export function scheduleBackPath(raw: unknown, fallback: string): string {
  return isBoardPath(raw) ? raw : fallback;
}

/** A rename moves the entry's own page, so a `back` that pointed at the
 *  old one points at the new one instead of at a page that is gone. */
export function renamedBack(back: string, project: string, from: string, to: string): string {
  if (from === to) return back;
  const old = schedulePagePath(project, from);
  if (back === old || back.startsWith(`${old}?`)) return schedulePagePath(project, to) + back.slice(old.length);
  return back;
}

export async function scheduleNewPageResponse(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  page: {
    project: string;
    values: Pick<ScheduleEntry, "name" | "cron" | "prompt" | "model" | "notify">;
    back: string;
  },
): Promise<Response> {
  const langResult = languageChoice(url, req);
  const html = renderScheduleNewPage(ctx.nav(), new Date().toISOString(), {
    project: page.project,
    values: page.values,
    backHref: page.back,
    modelChoices: modelChoiceOptions(ctx.queue),
    defaultModels: ctx.queue.defaults.model,
    script: await specsClientScript(),
    lang: langResult.lang,
    currentUrl: langResult.currentUrl,
  });
  const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
  if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
  return new Response(html, { headers });
}
