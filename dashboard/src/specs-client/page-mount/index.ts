import { keepBack } from "../back-link";
import { applyAiPick } from "../ai-sync";
import { startOriginCheck } from "../deploy/origin-check";
import { bindOneLineFields, settingsAnswer, submitCreate, submitProjectChange, submitProjectSettings, syncDependsOn } from "../forms";
import { connect, disconnect } from "../live";
import { postForm } from "../press";
import { bindProviderAdd } from "../provider-add";
import { bindPushPanel } from "../push";
import { startReloadWhileIdle } from "../reload-while-idle";
import { bindReportFrame } from "../report-frame";
import { postScheduleEnabled, postScheduleRun, scheduleCronPreview, submitScheduleForm } from "../schedule-actions";
import { placeNamedRow } from "../spec-detail";
import { NEW_SPEC_FORM } from "../state";

export function mountPage(doc: Document, options: { referrer: string }): () => void {
  doc.documentElement.dataset.pageMounted = "true";
  const cleanups: (() => void)[] = [];
  const providerAdd = doc.getElementById("provider-add") as HTMLDialogElement | null;
  if (providerAdd) bindProviderAdd(providerAdd);
  const pushPanel = doc.querySelector("[data-push-panel]") as HTMLElement | null;
  if (pushPanel) bindPushPanel(pushPanel);
  startOriginCheck(doc);
  for (const el of doc.querySelectorAll("form.addprojectform, form.removeform")) {
    const form = el as HTMLFormElement;
    form.addEventListener("submit", ((event: Event) => submitProjectChange(form, event)) as EventListener);
  }
  for (const el of doc.querySelectorAll("form.projectsettingsform")) {
    const form = el as HTMLFormElement;
    form.addEventListener("submit", ((event: Event) => submitProjectSettings(form, event)) as EventListener);
    cleanups.push(bindOneLineFields(form));
  }
  const newSpec = doc.querySelector(NEW_SPEC_FORM) as HTMLFormElement | null;
  newSpec?.addEventListener("submit", ((event: Event) => submitCreate(newSpec, event)) as EventListener);
  const settingsForm = doc.querySelector("form[data-settings-form]") as HTMLFormElement | null;
  settingsForm?.addEventListener("change", ((event: Event) => {
    const ai = (event.target as Element | null)?.closest?.("select[data-ai]") as HTMLSelectElement | null;
    if (ai) return applyAiPick(ai);
  }) as EventListener);
  settingsForm?.addEventListener("submit", (async (event: Event) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    await postForm(
      settingsForm,
      async () => settingsAnswer(settingsForm, "Defaults saved", true),
      (why) => settingsAnswer(settingsForm, why, false),
    );
  }) as EventListener);
  for (const el of doc.querySelectorAll("input.scheduleenabled[data-post-to]")) {
    const box = el as HTMLInputElement;
    box.addEventListener("change", () => postScheduleEnabled(box));
  }
  for (const el of doc.querySelectorAll("form.schedulerun")) {
    const form = el as HTMLFormElement;
    form.addEventListener("submit", ((event: Event) => {
      event.preventDefault();
      return postScheduleRun(form);
    }) as EventListener);
  }
  for (const el of doc.querySelectorAll("form.scheduleform")) {
    const form = el as HTMLFormElement;
    const cronInput = form.querySelector('input[name="cron"]') as HTMLInputElement | null;
    const target = form.querySelector("[data-cron-next]") as HTMLElement | null;
    if (cronInput && target) cronInput.addEventListener("input", () => scheduleCronPreview(cronInput, target));
    form.addEventListener("submit", ((event: Event) => submitScheduleForm(form, event)) as EventListener);
    form.addEventListener("change", ((event: Event) => {
      const ai = (event.target as Element | null)?.closest?.("select[data-ai]") as HTMLSelectElement | null;
      if (ai) return applyAiPick(ai);
    }) as EventListener);
  }
  syncDependsOn();
  cleanups.push(startReloadWhileIdle(doc));
  connect();
  for (const el of doc.querySelectorAll("iframe[data-report-frame]")) cleanups.push(bindReportFrame(el as HTMLIFrameElement));
  const page = globalThis as unknown as Window;
  placeNamedRow(doc, page);
  keepBack(doc, {
    referrer: () => options.referrer,
    here: () => ({ href: location.href, host: location.host, pathname: location.pathname }),
    storage: () => sessionStorage,
  });
  return () => {
    delete doc.documentElement.dataset.pageMounted;
    disconnect();
    for (const cleanup of cleanups) cleanup();
  };
}
