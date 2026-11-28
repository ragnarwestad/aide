import { bindListWindow, acceptListWindow } from "../list-window";
// What a page needs bound: the one list, run at load and again for every
// page drawn in place, whose `<main>` is new and has none of it. What is
// bound once for the whole document stays in the entry point
// (`specs-client/index.ts`). Kept in order: several bindings depend on an
// earlier one having run — the counts are drawn first, so a binding that
// reads or fills a field finds it already counted.

import { bindAddProjectForm } from "../add-project";
import { keepBack } from "../back-link";
import { applyAiPick, offerAgainAfterReset, offerEachToItsTool } from "../ai-sync";
import { startOriginCheck } from "../deploy/origin-check";
import { bindOneLineFields, settingsAnswer, submitCreate, submitProjectChange, submitProjectSettings, syncDependsOn } from "../forms";
import { drawLimits } from "../limits";
import { connect, disconnect } from "../live";
import { postForm } from "../press";
import { bindProviderAdd } from "../provider-add";
import { bindIconFile } from "../icon-file";
import { bindPushPanel } from "../push";
import { startReloadWhileIdle } from "../reload-while-idle";
import { bindReportFrame } from "../report-frame";
import { bindScheduleRuns, postScheduleEnabled, postScheduleRun, sandboxFollowsTool, scheduleCronPreview, submitScheduleForm } from "../schedule-actions";
import { placeNamedRow } from "../spec-detail";
import { NEW_SPEC_FORM } from "../state";
import { bindLists } from "./lists.ts";

/** A form's AI select fills in the model beside it. */
function onAiChange(event: Event): void {
  const ai = (event.target as Element | null)?.closest?.("select[data-ai]") as HTMLSelectElement | null;
  if (ai) return applyAiPick(ai);
}

/** The Projects pages' forms and dialogs, and the Settings page's Notifications tab. */
function mountProjectForms(doc: Document, cleanups: (() => void)[], options: { referrer: string; background?: boolean }): void {
  // The Providers page's Add dialog, when it is the one open.
  const providerAdd = doc.getElementById("provider-add") as HTMLDialogElement | null;
  if (providerAdd) bindProviderAdd(providerAdd);
  // The Config tab's Choose file dialog, which reads the picked file into its form.
  const iconFile = doc.getElementById("projecticon-file") as HTMLDialogElement | null;
  if (iconFile) cleanups.push(bindIconFile(iconFile));
  // The Settings page's Notifications tab, when it is the one open.
  const pushPanel = doc.querySelector("[data-push-panel]") as HTMLElement | null;
  if (pushPanel) bindPushPanel(pushPanel);
  for (const el of doc.querySelectorAll("form.addprojectform, form.removeform")) {
    const form = el as HTMLFormElement;
    form.addEventListener("submit", ((event: Event) => submitProjectChange(form, event)) as EventListener);
  }
  for (const el of doc.querySelectorAll("form.addprojectform")) bindAddProjectForm(el as HTMLFormElement);
  // The Deploy tab asks origin the moment it is open, and redraws itself from the answer.
  if (options.background !== false) startOriginCheck(doc);
  for (const el of doc.querySelectorAll("form.projectsettingsform")) {
    const form = el as HTMLFormElement;
    form.addEventListener("submit", ((event: Event) => submitProjectSettings(form, event)) as EventListener);
    cleanups.push(bindOneLineFields(form));
    // The Models per phase card pairs each row's AI and model, as Settings does.
    if (form.hasAttribute?.("data-project-models")) {
      form.addEventListener("change", onAiChange);
      offerAgainAfterReset(form);
    }
  }
}

/** The Settings page's Phases form. */
function mountSettingsForm(doc: Document): void {
  // `hasAttribute`: a stand-in document in the tests answers with a form of another page.
  const settingsCandidate = doc.querySelector("form[data-settings-form]") as HTMLFormElement | null;
  const settingsForm = settingsCandidate?.hasAttribute?.("data-settings-form") ? settingsCandidate : null;
  settingsForm?.addEventListener("change", onAiChange);
  settingsForm?.addEventListener("submit", (async (event: Event) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    await postForm(
      settingsForm,
      async () => settingsAnswer(settingsForm, "Defaults saved", true),
      (why) => settingsAnswer(settingsForm, why, false),
    );
  }) as EventListener);
}

/** The New spec form. */
function mountNewSpecForm(doc: Document): void {
  // The one listener that is NOT delegated: this form is the whole of its
  // own page, with no swapped container to hang a delegated one off.
  // The handler's promise is returned rather than dropped — a listener's
  // return value is ignored by the DOM, and it is what lets the test wait
  // for the request the press makes.
  const newSpec = doc.querySelector(NEW_SPEC_FORM) as HTMLFormElement | null;
  newSpec?.addEventListener("submit", ((event: Event) => submitCreate(newSpec, event)) as EventListener);
  // This page has no `#jobrows`, so the delegated model listener cannot hear its AI and model controls.
  newSpec?.addEventListener("change", onAiChange);
  // Spec and Options, switched in place, and Spec brought forward when the
  // browser finds one of its required fields empty.
  syncDependsOn();
  newSpec?.querySelector("select[name=project]")?.addEventListener("change", syncDependsOn);
}

function mountSchedule(doc: Document, cleanups: (() => void)[], options: { referrer: string; background?: boolean }): void {
  // The /schedule page's own controls: none of these sit inside `#jobrows`,
  // and nothing on this page is swapped from the server on a timer, so each
  // is bound here rather than delegated.
  // A switch is a button, which Enter would press too; the checkbox it
  // replaced toggled on Space alone, and so does the switch.
  for (const el of doc.querySelectorAll("button.scheduleenabled[data-post-to]")) {
    const sw = el as HTMLButtonElement;
    sw.addEventListener("click", () => postScheduleEnabled(sw));
    sw.addEventListener("keydown", (event) => { if ((event as KeyboardEvent).key === "Enter") event.preventDefault(); });
  }
  for (const el of doc.querySelectorAll("form.schedulerun")) {
    const form = el as HTMLFormElement;
    form.addEventListener("submit", ((event: Event) => {
      event.preventDefault();
      return postScheduleRun(form);
    }) as EventListener);
  }
  if (options.background !== false && doc.querySelector("form.schedulerun[data-project][data-entry]")) cleanups.push(bindScheduleRuns(doc));
  for (const el of doc.querySelectorAll("form.scheduleform")) {
    const form = el as HTMLFormElement;
    const cronInput = form.querySelector('input[name="cron"]') as HTMLInputElement | null;
    const target = form.querySelector("[data-cron-next]") as HTMLElement | null;
    if (cronInput && target) cronInput.addEventListener("input", () => scheduleCronPreview(cronInput, target));
    form.addEventListener("submit", ((event: Event) => submitScheduleForm(form, event)) as EventListener);
    // The AI and model pair, as the New spec form binds its own. Nothing is
    // remembered across a redraw here, so the pick lives in the select until
    // the form is posted.
    form.addEventListener("change", onAiChange);
    // After the AI pick has filled in its model, so the field reads the model it settled on.
    form.addEventListener("change", () => sandboxFollowsTool(form));
    sandboxFollowsTool(form);
  }
}

export function mountPage(doc: Document, options: { referrer: string; background?: boolean }): () => void {
  // `?.`: the page script's tests run it against a stand-in document with no root element.
  const root = doc.documentElement as HTMLElement | undefined;
  if (root?.dataset) root.dataset.pageMounted = "true";
  const cleanups: (() => void)[] = [];
  // The count under every bounded text field. Its listeners are on the
  // document, which outlives the page, and are bound once at load.
  drawLimits(doc);
  mountProjectForms(doc, cleanups, options);
  mountSettingsForm(doc);
  bindLists(doc);
  const jobrows = doc.getElementById("jobrows");
  if (jobrows) acceptListWindow(jobrows);
  cleanups.push(bindListWindow(doc));
  mountNewSpecForm(doc);
  mountSchedule(doc, cleanups, options);
  // A page that carries `data-reload-every` reloads from here, and waits while a dialog is open.
  if (options.background !== false) cleanups.push(startReloadWhileIdle(doc));
  // The server draws every model, and each select is narrowed to the tool its own value belongs to.
  offerEachToItsTool(doc);
  // `?live=0` leaves the page as the server drew it: the live connection is declined.
  if (options.background !== false) connect();
  for (const el of doc.querySelectorAll("iframe[data-report-frame]")) cleanups.push(bindReportFrame(el as HTMLIFrameElement));
  // A row the address names sits at the top of the list's box, the page at its top.
  const page = globalThis as unknown as Window;
  placeNamedRow(doc, page);
  // "← Back" on a page with tabs keeps where the page was opened from while
  // the reader switches tabs. Last, and throwing nothing, so no binding above
  // can be lost to it.
  keepBack(doc, {
    referrer: () => options.referrer,
    here: () => ({ href: location.href, host: location.host, pathname: location.pathname }),
    storage: () => sessionStorage,
  });
  return () => {
    if (root?.dataset) delete root.dataset.pageMounted;
    disconnect();
    for (const cleanup of cleanups) cleanup();
  };
}
