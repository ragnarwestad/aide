// The dialog a Deploy press stands behind from the press until the
// service runs the newest commit: the five steps, already in the
// reader's language, each in the state `waiting`. The script
// (`specs-client/deploy/`) opens it on submit and moves one line at a
// time. With no script, or no `<dialog>`, it stays closed and the form
// posts as it always did.

import { renderSentence } from "../../../i18n/message.ts";
import { t, type Language, type TranslationKey } from "../../../i18n";
import { rowMessage } from "../../ui/components";
import { esc } from "../../ui/html.ts";

/** The key of each step's label. */
export const STEP_LABEL: Record<string, TranslationKey> = {
  fetch: "deploy.stepFetch",
  install: "deploy.stepInstall",
  restart: "deploy.stepRestart",
  wait: "deploy.stepWait",
  check: "deploy.stepCheck",
};

export function deployDialog(lang: Language): string {
  const steps = Object.entries(STEP_LABEL).map(
    ([step, label]) =>
      `<li data-step="${step}" data-state="waiting">${esc(t(lang, label))} ` +
      `<span class="deploystate">${esc(t(lang, "deploy.stateWaiting"))}</span></li>`,
  ).join("");
  return (
    `<dialog class="confirmdialog" data-deploy-dialog data-finished="${esc(t(lang, "deploy.finished"))}" ` +
    `data-failed-at="${esc(t(lang, "deploy.failedAt"))}" ` +
    `data-no-answer="${esc(renderSentence(lang, { key: "landing.deployNoAnswer" }) ?? "")}">` +
    `<div class="confirmpanel"><h2>${esc(t(lang, "deploy.title"))}</h2>` +
    `<ol class="deploysteps" data-waiting="${esc(t(lang, "deploy.stateWaiting"))}" ` +
    `data-running="${esc(t(lang, "deploy.stateRunning"))}" data-done="${esc(t(lang, "deploy.stateDone"))}" ` +
    `data-failed="${esc(t(lang, "deploy.stateFailed"))}">${steps}</ol>` +
    `<div class="deploymessage"></div>` +
    `<template data-deploy-error>${rowMessage("failed", "", { tag: "p", hook: "deploy-error" })}</template>` +
    `</div></dialog>`
  );
}
