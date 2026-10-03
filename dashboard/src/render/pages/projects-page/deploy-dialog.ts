// The dialog a Deploy press stands behind from the press until the
// service runs the newest commit: the board's one progress dialog, with
// the five steps in its step list, already in the reader's language, each
// in the state `waiting`. The script (`specs-client/deploy/`) opens it on
// submit and moves one line at a time.

import { renderSentence } from "../../../i18n/message.ts";
import { t, type Language, type TranslationKey } from "../../../i18n";
import { progressDialog, rowMessage } from "../../ui/components";

/** The key of each step's label. */
export const STEP_LABEL: Record<string, TranslationKey> = {
  fetch: "deploy.stepFetch",
  install: "deploy.stepInstall",
  restart: "deploy.stepRestart",
  wait: "deploy.stepWait",
  check: "deploy.stepCheck",
};

export function deployDialog(lang: Language): string {
  return progressDialog(lang, {
    title: t(lang, "deploy.title"),
    data: {
      "deploy-dialog": "",
      finished: t(lang, "deploy.finished"),
      "failed-at": t(lang, "deploy.failedAt"),
      "no-answer": renderSentence(lang, { key: "landing.deployNoAnswer" }) ?? "",
    },
    steps: Object.entries(STEP_LABEL).map(([key, label]) => ({ key, label: t(lang, label) })),
    body:
      `<div class="deploymessage"></div>` +
      `<template data-deploy-error>${rowMessage("failed", "", { tag: "p", hook: "deploy-error" })}</template>`,
  });
}
