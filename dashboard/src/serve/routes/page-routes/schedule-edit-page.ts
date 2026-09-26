// The page that makes or changes a schedule entry, as a response: drawn
// for its own GET, and drawn again by the save routes when a save with
// no script is refused, holding what was typed and the reason. Also where
// a save goes back to afterwards.
import type { ScheduleEntry } from "../../../queue/schedule.ts";
import { projectPagePath, renderScheduleEditPage, schedulePagePath } from "../../../render";
import { languageChoice, specsClientScript } from "../../serve-helpers";
import type { RoutesContext } from "..";

/** The project's own Schedule tab: where New and Edit are pressed, and
 *  where a save goes when nothing better is known. */
export const projectScheduleTab = (project: string): string => `${projectPagePath(project)}?tab=schedule`;

/** The `back` a form sent, if it is a path on this board; the fallback
 *  otherwise. It comes from the browser, so anything that could leave
 *  the board — another host, a scheme, a header break — is not used. */
export function scheduleBackPath(raw: unknown, fallback: string): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  return raw;
}

/** A rename moves the entry's own page, so a `back` that pointed at the
 *  old one points at the new one instead of at a page that is gone. */
export function renamedBack(back: string, project: string, from: string, to: string): string {
  if (from === to) return back;
  const old = schedulePagePath(project, from);
  if (back === old || back.startsWith(`${old}?`)) return schedulePagePath(project, to) + back.slice(old.length);
  return back;
}

export async function scheduleEditPageResponse(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  page: {
    project: string;
    editing?: string;
    values: Pick<ScheduleEntry, "name" | "cron" | "prompt" | "model" | "notify">;
    back: string;
    error?: string;
    status?: number;
  },
): Promise<Response> {
  const langResult = languageChoice(url, req);
  const html = renderScheduleEditPage(ctx.nav(), new Date().toISOString(), {
    project: page.project,
    ...(page.editing ? { editing: page.editing } : {}),
    values: page.values,
    backHref: page.back,
    error: page.error,
    modelChoices: Object.entries(ctx.queue.defaults.modelChoices ?? {}).map(([name, choice]) => ({
      name, ...(choice.tool ? { tool: choice.tool } : {}),
    })),
    defaultModels: ctx.queue.defaults.model,
    script: await specsClientScript(),
    lang: langResult.lang,
    currentUrl: langResult.currentUrl,
  });
  const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
  if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
  return new Response(html, { status: page.status ?? 200, headers });
}
