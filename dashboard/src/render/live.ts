// /live: aide runs linked to their Claude Code sessions (spec 80).
// No page code — a meta refresh keeps it current.

import { esc } from "./html.ts";
import { pageShell, type NavEntry } from "./shell.ts";

export interface LiveRowView {
  spec?: string;
  command: string;
  /** The TDD phase an implement run last reported, when it reported
   *  one (spec 81 §2). */
  phase?: string;
  project?: string;
  sessionId: string;
  receivedAt: string;
  live: string;
  subagents: number | null;
  costUsd: number | null;
}

export function renderLivePage(
  rows: LiveRowView[],
  notice: string | null,
  generatedAt: string,
  entries: NavEntry[],
): string {
  const table =
    rows.length === 0
      ? `<p class="muted">No aide runs received yet.</p>`
      : `<table><thead><tr><th>Spec</th><th>Phase</th><th>Project</th><th>Session</th>` +
        `<th>Started</th><th>Live</th><th>Subagents</th><th>Cost so far</th></tr></thead><tbody>` +
        rows
          .map(
            (r) =>
              `<tr class="${esc(r.live === "not-live" ? "archived" : "active")}">` +
              `<td>${esc(r.spec ?? "–")}</td>` +
              `<td>${esc(r.phase ? `${r.command} · ${r.phase}` : r.command)}</td>` +
              `<td>${esc(r.project ?? "–")}</td><td>${esc(r.sessionId.slice(0, 8))}</td>` +
              `<td>${esc(r.receivedAt)}</td><td>${esc(r.live)}</td>` +
              `<td>${r.subagents === null ? "–" : r.subagents}</td>` +
              `<td>${r.costUsd === null ? "–" : `$${r.costUsd.toFixed(2)}`}</td></tr>`,
          )
          .join("") +
        `</tbody></table>`;
  const body =
    (notice ? `<p class="muted">${esc(notice)}</p>\n` : "") +
    `<p class="intro">aide runs linked to their sessions — liveness, subagents and ` +
    `cost so far come from claude-usage and lag a little for remote machines.</p>\n` +
    table;
  return pageShell("Live", entries, "/live", body, generatedAt, 10);
}
