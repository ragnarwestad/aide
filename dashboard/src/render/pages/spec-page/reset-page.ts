// The reset confirmation page.

import { backLink, rowMessage, tokenField, typedConfirm } from "../../ui/components.ts";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { specPagePath } from "./tabs.ts";

export function renderResetSpecPage(
  project: string,
  specFolder: string,
  entries: NavEntry[],
  generatedAt: string,
  opts: { token?: string; error?: string; script?: string } = {},
): string {
  const back = specPagePath(project, specFolder);
  const title = `Reset ${specFolder}`;
  const body =
    backLink(back, title) +
    (opts.error ? rowMessage("failed", opts.error, { tag: "p" }) : "") +
    rowMessage(
      "info",
      "Reset keeps 0-README.md and 1-description.md byte for byte. It regenerates the analysis, plan and status, removes old local and remote spec branches, and keeps earlier jobs and commits as history. Project code and default-branch history are unchanged.",
      { tag: "p" },
    ) +
    `<form method="post" action="/api/queue${back}/reset" class="newspecform">` +
    tokenField(opts.token) +
    `<span class="frow">` +
    typedConfirm({
      target: specFolder,
      label: "Type the exact folder name to reset it",
      button: "Reset",
      pending: "resetting…",
    }) +
    `</span></form>`;
  return pageShell(title, entries, "/", body, generatedAt, undefined, { script: opts.script, hideHeading: true });
}
