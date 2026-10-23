// The board's own Deploy: the dialog its button asks through, and the label
// of each step of the deploy job.

import { t, type Language, type TranslationKey } from "../../../i18n";
import { progressDialog } from "../../ui/components";

/** The key of each step's label. */
export const STEP_LABEL: Record<string, TranslationKey> = {
  fetch: "deploy.stepFetch",
  install: "deploy.stepInstall",
  restart: "deploy.stepRestart",
  wait: "deploy.stepWait",
  check: "deploy.stepCheck",
};

/** The board's own Deploy asks first, and its OK queues the deploy job; the
 *  page then goes to the Running tab, where the job is followed. */
export function deployAskDialog(lang: Language, project: string, id: string): string {
  return progressDialog(lang, {
    id,
    title: t(lang, "deploy.title"),
    ask: {
      title: t(lang, "deploy.askTitle", { project }),
      sentence: t(lang, "deploy.askSentence"),
      ok: { variant: "primary", pending: t(lang, "deploy.title") },
      post: { action: `/api/queue/projects/${encodeURIComponent(project)}/deploy` },
      queuesJob: true,
    },
  });
}
