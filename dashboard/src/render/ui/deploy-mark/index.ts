// The header's Deploy mark: the deploy icon and the number of commits a
// Deploy would take in, beside the board's name. Its slot is drawn with nothing to deploy too,
// at the same width and empty, so the header never moves as it comes and goes.

import { t, type Language } from "../../../i18n";
import { deployAskDialog } from "../../pages/projects-page/deploy-dialog.ts";
import { KIND_ICONS } from "../components/icons.ts";
import { esc } from "../html.ts";

/** What the board has to deploy. */
export interface DeployWaiting {
  project: string;
  /** How many commits a Deploy pressed now would take in. */
  commits: number;
  /** The default branch the check compared with. */
  branch: string;
  underWay?: "queued" | "running";
}

let waitingNow: (() => DeployWaiting | undefined) | undefined;

/** The header's Deploy question; the Deploy tab uses `deployask`. */
export const DEPLOY_MARK_DIALOG = "deploymarkask";

/** Where the header reads what is waiting: the drift poll's last answer. */
export function setDeployWaiting(source: (() => DeployWaiting | undefined) | undefined): void {
  waitingNow = source;
}

/** What the drift poll last found, for a page that opens the event stream. */
export const currentDeployWaiting = (): DeployWaiting | undefined => waitingNow?.();

export function deployMark(lang: Language, waiting: DeployWaiting | undefined = waitingNow?.()): string {
  if (!waiting) return `<span class="deploymark" aria-hidden="true"></span>`;
  const activity = ` data-deploy-project="${esc(waiting.project)}" data-deploy-under-way="${!!waiting.underWay}" data-deploy-commits="${waiting.commits}"`;
  if (waiting.commits === 0) {
    const label = esc(t(lang, "shell.deployUpToDate", { project: waiting.project, branch: waiting.branch }));
    return `<span class="deploymark uptodate"${activity} role="img" title="${label} — ${esc(t(lang, "shell.deployHelpCurrent"))}" aria-label="${label}">${KIND_ICONS.deploy}</span>`;
  }
  const helpKey = waiting.underWay === "queued" ? "shell.deployHelpQueued"
    : waiting.underWay === "running" ? "shell.deployHelpRunning" : "shell.deployHelpPending";
  const key = waiting.commits === 1 ? "shell.deployWaitingOne" : "shell.deployWaiting";
  const label = esc(waiting.underWay
    ? t(lang, "project.deployUnderWay", { state: t(lang, `state.${waiting.underWay}`) })
    : t(lang, key, { project: waiting.project, count: waiting.commits }));
  return `<button class="deploymark iconlink"${activity} type="button"${waiting.underWay ? " disabled" : ` data-ask="${DEPLOY_MARK_DIALOG}"`} title="${label} — ${esc(t(lang, helpKey))}" aria-label="${label}">${KIND_ICONS.deploy}<span>(${waiting.commits})</span></button>`;
}

/** The Deploy tab's question, drawn by the same function for the header. */
export function deployMarkDialog(lang: Language, waiting: DeployWaiting | undefined = waitingNow?.()): string {
  return waiting && waiting.commits > 0 && !waiting.underWay ? deployAskDialog(lang, waiting.project, DEPLOY_MARK_DIALOG) : "";
}

/** The fragment an open page receives when the mark changes. */
export function deployMarkAnswer(lang: Language): string {
  const waiting = waitingNow?.();
  return deployMark(lang, waiting) + deployMarkDialog(lang, waiting);
}
