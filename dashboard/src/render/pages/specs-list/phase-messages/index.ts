// A phase line unfolded to the model's latest messages: the ›
// that opens them and the row that lists them. The state is in the
// address (`?phases=`), like the row's own fold and the criteria's
// (`?checks=`), so it survives the live redraw and works with script off.

import { badge, foldArrow, rowMessage, stepLabel, type ProgressStepState } from "../../../ui/components";
import { esc, tokens } from "../../../ui/html.ts";
import { durationLabel } from "../../../ui/job-state";
import { withModelId } from "../../../ui/components/model-label.ts";
import { t, type Language } from "../../../../i18n";
import { specTabPath } from "../../spec-page";
import type { Phase, SpecGroup } from "../data-model";
import { queuePath } from "../filter-bar.ts";
import type { SpecsFilter, SpecsPageOptions } from "../";
import { phaseKey } from "./keys.ts";
import { LIST_COLUMNS } from "../row-shared.ts";
import type { LogPart } from "../../../../queue/parse-stream";
import { drawnParts } from "../../job-page/step-tabs.ts";
import { phaseExplanations } from "./explanations.ts";

export { phaseKey, parsePhaseKeys } from "./keys.ts";

/** One step of a job or of a phase: its state, how long it took once ended or when it started while it
 *  runs, the tokens the stream reported while it ran, and its own part of the Log once it is marked. */
export interface JobStep {
  key: string;
  label: string;
  state?: ProgressStepState;
  seconds?: number;
  since?: string;
  tokens?: number;
  /** The step's own part of the job's Log, once it is marked. */
  logs?: LogPart[];
}

/** What the server knows of one phase's log: the step's Log, part by part. */
export interface PhaseMessages {
  /** Oldest first, each part's lines already escaped: printed as given,
   *  never escaped again. The same parts the step's Log on the Logs tab
   *  draws, with the same separator line before each. */
  logs: LogPart[];
  /** The steps the log has marked, in the order marked, listed above the Log. */
  steps: JobStep[];
  /** The model the AI's parts name in their separator, when known. */
  aiModel?: string;
  /** The step's key on the Logs tab (`&step=`), when it has one there. */
  step?: string;
  running: boolean;
}

const unfoldedKeys = (raw: string | undefined): Set<string> => new Set((raw ?? "").split(",").filter(Boolean));

/** Whether this phase has run or is running, by what the line already
 *  knows. A phase that is only queued, or that nothing touched, has no
 *  messages to show. */
export function phaseHasRun(g: SpecGroup, p: Phase): boolean {
  return (
    p.step === "create" ||
    g.done.includes(p.step) ||
    p.fileResult !== undefined ||
    p.timeSpentMs !== undefined ||
    p.attempts.some(
      (a) => (a.results ?? []).some((r) => r.step === p.step) || (a.state !== "queued" && a.state !== "cancelled"),
    )
  );
}

/** Whether a phase line opens to a log: it has run, or it has something
 *  to explain about its state even with no run kept. */
const hasLog = (g: SpecGroup, p: Phase, ran: boolean, lang: Language): boolean =>
  ran || phaseExplanations(g, p, lang).length > 0;

/** The › at the head of a phase line that has a log. Adds or removes only
 *  this phase's key and keeps every other part of the view. */
export function phaseMessagesFold(g: SpecGroup, p: Phase, opts: SpecsPageOptions, ran: boolean): string {
  const lang = opts.lang ?? "en";
  if (!hasLog(g, p, ran, lang)) return "";
  const key = phaseKey(g.project, g.specFolder, p.step);
  const unfolded = unfoldedKeys(opts.filter?.phases);
  const shut = !unfolded.has(key);
  const next = shut ? [...unfolded, key] : [...unfolded].filter((k) => k !== key);
  return foldArrow({
    href: queuePath(opts.filter ?? {}, { phases: next.join(",") }, opts.listPath),
    open: !shut,
    lang,
    title: "list.phaseFoldTitle",
    params: { phase: stepLabel(p.step, lang) },
  });
}

/** The rows under an unfolded phase line, or none: the steps its log
 *  marked, then what explains the phase's state, then the Log. */
export function phaseMessagesRow(
  g: SpecGroup,
  p: Phase,
  opts: SpecsPageOptions,
  ran: boolean,
  now: number,
): { tag: string; cells: string }[] {
  const key = phaseKey(g.project, g.specFolder, p.step);
  const lang = opts.lang ?? "en";
  if (!unfoldedKeys(opts.filter?.phases).has(key) || !hasLog(g, p, ran, lang)) return [];
  const found = opts.phaseMessages?.(
    p.attempts.map((a) => a.id),
    p.step,
  );
  const tab = specTabPath(g.project, g.specFolder, "steps");
  const href = esc(found?.step ? `${tab}&step=${encodeURIComponent(found.step)}` : tab);
  // The model this phase ran on, first: from the newest attempt's result
  // while the queue remembers one, else from the phase's own file (an
  // archived phase names the recorded word, `opus`).
  const newest = p.attempts[0];
  const modelId = newest ? newest.modelId : p.modelId;
  const ranOn = withModelId(newest ? newest.model : p.model?.split(" ").slice(1).join(" ") || undefined, modelId);
  const modelLine = modelId ? `<p class="muted small" data-model-id>${esc(t(lang, "list.phaseModel", { model: ranOn ?? "" }))}</p>` : "";
  // Plain text, escaped once here: a log part's lines are already escaped,
  // so these are never put among them.
  const explained = phaseExplanations(g, p, lang).map((s) => rowMessage("info", s, { tag: "p" })).join("");
  const body = modelLine + explained + (!found
    ? `<p class="phasemsgempty muted">${esc(t(lang, "list.phaseNoneKept"))}</p>`
    : logBox(found.logs, found.aiModel, lang));
  return [
    ...(found ? stepRows(found.steps, { prefix: key, filter: opts.filter ?? {}, listPath: opts.listPath, lang, now, underPhase: true }) : []),
    {
      tag: `<tr class="phasemsgs" data-msgs="${esc(p.step)}">`,
      cells: `<td colspan="${LIST_COLUMNS}">${body}<a class="phasemsgopen" href="${href}">${esc(t(lang, "list.phaseOpenLog"))}</a></td>`,
    },
  ];
}

/** A step's state, in the badge a phase line uses; a step not reached yet in a muted word. */
function stepState(state: ProgressStepState | undefined, lang: Language): string {
  if (state === "done") return badge("done", t(lang, "dialog.stepDone"));
  if (state === "running") return badge("running", t(lang, "dialog.stepRunning"));
  if (state === "failed") return badge("refused", t(lang, "dialog.stepFailed"));
  return `<span class="muted small">${esc(t(lang, "dialog.stepWaiting"))}</span>`;
}

/** A step's time: its seconds once ended, counting from its start while it runs. */
function stepTime(s: JobStep, now: number): string {
  if (s.seconds !== undefined) return `<span class="muted small">${durationLabel(s.seconds * 1000)}</span>`;
  if (s.since) {
    return `<span class="muted small" data-elapsed="${esc(s.since)}">${durationLabel(Math.max(0, now - Date.parse(s.since)))}</span>`;
  }
  return "–";
}

/** A line per step, in the columns of a phase line, the name starting where a phase's does. A step its
 *  log has marked unfolds to its own part of the log: the unfolded steps are in the address (`phases`),
 *  each as `prefix` (the row's key) and the step's place. Its cost cell is the tokens the stream reported
 *  while it ran, and a dash where none can be attributed to it. `underPhase` marks the lines of a phase's
 *  steps, which stand one level in under the phase's name; a job's own steps stand under no phase. */
export function stepRows(
  steps: JobStep[],
  o: { prefix: string; filter: SpecsFilter; listPath?: string; lang: Language; now: number; underPhase?: boolean },
): { tag: string; cells: string }[] {
  const unfolded = [...unfoldedKeys(o.filter.phases)];
  return steps.flatMap((s, i) => {
    const key = `${o.prefix}.${i}`;
    const open = unfolded.includes(key);
    const next = open ? unfolded.filter((k) => k !== key) : [...unfolded, key];
    const arrow = s.logs?.length
      ? foldArrow({
          href: queuePath(o.filter, { phases: next.join(",") }, o.listPath),
          open,
          lang: o.lang,
          title: "list.phaseFoldTitle",
          params: { phase: s.label },
        })
      : "";
    const row = {
      tag: `<tr class="subrow" data-step="${esc(s.key)}" data-jobstep="1"${o.underPhase ? ' data-phasestep="1"' : ""}>`,
      cells:
        `<td class="phasecell" colspan="3">${arrow}${esc(s.label)}</td>` +
        `<td data-col="state">${stepState(s.state, o.lang)}</td>` +
        `<td data-col="started">${stepTime(s, o.now)}</td>` +
        `<td class="num" data-col="cost">${s.tokens !== undefined ? tokens(s.tokens) : "–"}</td>`,
    };
    return open && s.logs?.length
      ? [row, { tag: `<tr class="phasemsgs" data-msgs="${esc(s.key)}"${o.underPhase ? ' data-phasesteplog="1"' : ""}>`, cells: `<td colspan="${LIST_COLUMNS}">${logBox(s.logs, undefined, o.lang)}</td>` }]
      : [row];
  });
}

/** A step's Log in its box, part by part, or a line saying it has none. The
 *  box opens at its end, where the last thing the step did is. */
export function logBox(logs: LogPart[], aiModel: string | undefined, lang: Language): string {
  const parts = drawnParts(logs, aiModel, lang);
  if (parts.length === 0) return `<p class="phasemsgempty muted">${esc(t(lang, "list.phaseNoMessages"))}</p>`;
  return `<div class="logbox"><ul class="phasemsglist">${parts
    .map((part) => `<li class="muted">— ${esc(part.writer)} —</li>` + part.lines.map((m) => `<li>${m}</li>`).join(""))
    .join("")}</ul></div>`;
}
