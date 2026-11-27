// The header's Deploy mark: the deploy icon and the number of commits a
// Deploy would take in, beside the board's name. Its slot is drawn with nothing to deploy too,
// at the same width and empty, so the header never moves as it comes and goes.

import { t, type Language, type TranslationKey } from "../../../i18n";
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

/** What the mark says and offers for what is waiting: `current` with
 *  nothing to deploy, `pending` when a press asks the Deploy question, and
 *  `queued`/`running` for a Deploy under way, which offers none. */
export interface DeployMarkStatus {
  status: "current" | "pending" | "queued" | "running";
  /** The label's key. */
  label: TranslationKey;
  /** The key of the help line after the label. */
  help: TranslationKey;
  /** Whether the number of commits stands beside the icon. */
  showsCount: boolean;
}

export function deployMarkStatus(waiting: DeployWaiting): DeployMarkStatus {
  if (!waiting.underWay && waiting.commits === 0) {
    return { status: "current", label: "shell.deployUpToDate", help: "shell.deployHelpCurrent", showsCount: false };
  }
  return {
    status: waiting.underWay ?? "pending",
    label: waiting.underWay ? "project.deployUnderWay" : waiting.commits === 1 ? "shell.deployWaitingOne" : "shell.deployWaiting",
    help: waiting.underWay === "queued" ? "shell.deployHelpQueued"
      : waiting.underWay === "running" ? "shell.deployHelpRunning" : "shell.deployHelpPending",
    showsCount: waiting.commits > 0,
  };
}

export function deployMark(lang: Language, waiting: DeployWaiting | undefined = waitingNow?.()): string {
  if (!waiting) return `<span class="deploymark" aria-hidden="true"></span>`;
  const activity = ` data-deploy-project="${esc(waiting.project)}" data-deploy-under-way="${!!waiting.underWay}" data-deploy-commits="${waiting.commits}"`;
  const mark = deployMarkStatus(waiting);
  if (mark.status === "current") {
    const label = esc(t(lang, mark.label, { project: waiting.project, branch: waiting.branch }));
    return `<span class="deploymark uptodate" data-deploy-status="current"${activity} role="img" title="${label} — ${esc(t(lang, mark.help))}" aria-label="${label}">${KIND_ICONS.deploy}</span>`;
  }
  const label = esc(waiting.underWay
    ? t(lang, mark.label, { state: t(lang, `state.${waiting.underWay}`) })
    : t(lang, mark.label, { project: waiting.project, count: waiting.commits }));
  return `<button class="deploymark iconlink" data-deploy-status="${mark.status}"${activity} type="button"${mark.status === "pending" ? ` data-ask="${DEPLOY_MARK_DIALOG}"` : " disabled"} title="${label} — ${esc(t(lang, mark.help))}" aria-label="${label}">${KIND_ICONS.deploy}${mark.showsCount ? `<span>(${waiting.commits})</span>` : ""}</button>`;
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
