// The Review and Verify lines under Implement: a session of their own beside
// the implement session, with its state, time, tokens and cost, and a › that
// folds out its own part of the step's transcript. The Review line under
// Analyze says only whether the plan was reviewed, or that a short analysis
// skipped it: its time and cost are Analyze's own. A line with nothing to say
// reads "–", as a phase not run does.

import { badge, foldArrow, type ProgressStepState } from "../../../ui/components";
import { esc } from "../../../ui/html.ts";
import { type SideRunView } from "../../../ui/job-state";
import { t } from "../../../../i18n";
import { PLAN_REVIEW, type PickPart } from "../../../../queue/providers/side-tools.ts";
import type { Phase, SpecGroup } from "../data-model";
import type { SpecsPageOptions } from "../";
import { costCell, phaseWordCell } from "../cell-helpers.ts";
import { lockedDuration } from "../model-picker/index.ts";
import { queuePath } from "../filter-bar.ts";
import { LIST_COLUMNS } from "../row-shared.ts";
import { logBox, stepState } from "./index.ts";
import { parsePhaseKeys, phaseKey } from "./keys.ts";

/** What the newest implement attempt reports of one of its side sessions, or
 *  nothing when it ran without that session or has no result yet. */
export function sideRunOf(p: Phase, part: PickPart): SideRunView | undefined {
  if (part === PLAN_REVIEW) return undefined;
  return (p.attempts[0]?.results ?? []).findLast((r) => r.step === "implement")?.[part];
}

/** A side session that completed is done; any other ending failed. */
export function sideState(run: SideRunView): ProgressStepState {
  return run.outcome === "completed" ? "done" : "failed";
}

/** The state a side line shows: Review under Analyze is done once the
 *  spec's plan review is written; a session under Implement says how it
 *  ended. Nothing before either has happened. */
export function sideLineState(p: Phase, part: PickPart): ProgressStepState | undefined {
  if (part === PLAN_REVIEW) return p.planReviewed ? "done" : undefined;
  const run = sideRunOf(p, part);
  return run ? sideState(run) : undefined;
}

/** A short analysis writes no plan, so the Review under Analyze has nothing
 *  to review and is skipped by design. */
export function planReviewSkipped(p: Pick<Phase, "fileAnalysis" | "planReviewed">): boolean {
  return p.fileAnalysis === "short" && !p.planReviewed;
}

/** The line of one side session, and its log row when it is folded out.
 *  `pickers` is the line's AI and model choice, drawn as it always was. */
export function sideLines(
  g: SpecGroup,
  p: Phase,
  opts: SpecsPageOptions,
  part: PickPart,
  pickers: string,
): { tag: string; cells: string }[] {
  const lang = opts.lang ?? "en";
  const label = t(lang, `settings.side.${part}`);
  const run = sideRunOf(p, part);
  const state = sideLineState(p, part);
  const key = `${phaseKey(g.project, g.specFolder, "implement")}.${part}`;
  const unfolded = [...parsePhaseKeys(opts.filter?.phases)];
  const open = !!run && unfolded.includes(key);
  const arrow = run
    ? foldArrow({
        href: queuePath(opts.filter ?? {}, { phases: (open ? unfolded.filter((k) => k !== key) : [...unfolded, key]).join(",") }, opts.listPath),
        open,
        lang,
        title: "list.phaseFoldTitle",
        params: { phase: label },
      })
    : "";
  const line = {
    tag: `<tr class="subrow" data-side="${part}">`,
    cells:
      `<td class="phasecell" colspan="2">${arrow}<span class="phasefold">${esc(label)}</span></td>` +
      `<td class="modelcell"><span class="row">${pickers}</span></td>` +
      `<td data-col="state">${state ? stepState(state, lang)
        : part === PLAN_REVIEW && planReviewSkipped(p) ? badge("idle", t(lang, "list.planReviewSkipped"), t(lang, "list.planReviewSkippedTitle"))
        : phaseWordCell({ pip: "todo" })}</td>` +
      `<td data-col="started">${lockedDuration(run?.durationSec === undefined ? undefined : run.durationSec * 1000)}</td>` +
      `<td class="num" data-col="cost">${run ? costCell(run.costUsd ?? 0, run.tokens, "–", run.costUsd !== undefined) : ""}</td>`,
  };
  if (!open || part === PLAN_REVIEW) return [line];
  const found = opts.sideMessages?.(p.attempts.map((a) => a.id), part);
  const body = found ? logBox(found.logs, found.aiModel, lang) : `<p class="phasemsgempty muted">${esc(t(lang, "list.phaseNoneKept"))}</p>`;
  return [line, { tag: `<tr class="phasemsgs" data-msgs="implement.${part}">`, cells: `<td colspan="${LIST_COLUMNS}">${body}</td>` }];
}
