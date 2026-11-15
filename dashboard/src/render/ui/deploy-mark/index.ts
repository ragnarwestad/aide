// The header's Deploy mark: the deploy icon and the number of commits a
// Deploy would take in, beside the board's name, linking to the Deploy tab
// of the board's own project. Its slot is drawn with nothing to deploy too,
// at the same width and empty, so the header never moves as it comes and goes.

import { t, type Language } from "../../../i18n";
import { KIND_ICONS } from "../components/icons.ts";
import { esc } from "../html.ts";

/** What the board has to deploy. */
export interface DeployWaiting {
  project: string;
  /** How many commits a Deploy pressed now would take in. */
  commits: number;
}

let waitingNow: (() => DeployWaiting | undefined) | undefined;

/** Where the header reads what is waiting: the drift poll's last answer. */
export function setDeployWaiting(source: (() => DeployWaiting | undefined) | undefined): void {
  waitingNow = source;
}

/** What the drift poll last found, for a page that opens the event stream. */
export const currentDeployWaiting = (): DeployWaiting | undefined => waitingNow?.();

export function deployMark(lang: Language, waiting: DeployWaiting | undefined = waitingNow?.()): string {
  if (!waiting) return `<span class="deploymark" aria-hidden="true"></span>`;
  const key = waiting.commits === 1 ? "shell.deployWaitingOne" : "shell.deployWaiting";
  const label = esc(t(lang, key, { project: waiting.project, count: waiting.commits }));
  const href = `/projects/${encodeURIComponent(waiting.project)}?tab=deploy`;
  return `<a class="deploymark" href="${href}" title="${label}" aria-label="${label}">${KIND_ICONS.deploy}<span>(${waiting.commits})</span></a>`;
}
