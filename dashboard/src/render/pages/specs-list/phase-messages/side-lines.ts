// The Review and Verify lines under Implement: a session of their own beside
// the implement session, with its state, time, tokens and cost, and a › that
// folds out its own part of the step's transcript. A session that did not
// run keeps the pickers alone.

import { foldArrow, type ProgressStepState } from "../../../ui/components";
import { esc } from "../../../ui/html.ts";
import { durationLabel, type SideRunView } from "../../../ui/job-state";
import { t } from "../../../../i18n";
import type { SidePart } from "../../../../queue/providers/side-tools.ts";
import type { Phase, SpecGroup } from "../data-model";
import type { SpecsPageOptions } from "../";
import { costCell } from "../cell-helpers.ts";
import { queuePath } from "../filter-bar.ts";
import { LIST_COLUMNS } from "../row-shared.ts";
import { logBox, stepState } from "./index.ts";
import { parsePhaseKeys, phaseKey } from "./keys.ts";

/** What the newest implement attempt reports of one of its side sessions, or
 *  nothing when it ran without that session or has no result yet. */
export function sideRunOf(p: Phase, part: SidePart): SideRunView | undefined {
  return (p.attempts[0]?.results ?? []).find((r) => r.step === "implement")?.[
    part
  ];
}

/** A side session that completed is done; any other ending failed. */
export function sideState(run: SideRunView): ProgressStepState {
  return run.outcome === "completed" ? "done" : "failed";
}

/** The line of one side session, and its log row when it is folded out.
 *  `pickers` is the line's AI and model choice, drawn as it always was. */
export function sideLines(
  g: SpecGroup,
  p: Phase,
  opts: SpecsPageOptions,
  part: SidePart,
  pickers: string,
): { tag: string; cells: string }[] {
  const lang = opts.lang ?? "en";
  const label = t(lang, `settings.side.${part}`);
  const run = sideRunOf(p, part);
  const key = `${phaseKey(g.project, g.specFolder, "implement")}.${part}`;
  const unfolded = [...parsePhaseKeys(opts.filter?.phases)];
  const open = !!run && unfolded.includes(key);
  const arrow = run
    ? foldArrow({
        href: queuePath(
          opts.filter ?? {},
          {
            phases: (open
              ? unfolded.filter((k) => k !== key)
              : [...unfolded, key]
            ).join(","),
          },
          opts.listPath,
        ),
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
      `<td data-col="state">${run ? stepState(sideState(run), lang) : ""}</td>` +
      `<td data-col="started">${run?.durationSec !== undefined ? `<span class="muted small">${durationLabel(run.durationSec * 1000)}</span>` : ""}</td>` +
      `<td class="num" data-col="cost">${run ? costCell(run.costUsd ?? 0, run.tokens, "–", run.costUsd !== undefined) : ""}</td>`,
  };
  if (!open) return [line];
  const found = opts.sideMessages?.(
    p.attempts.map((a) => a.id),
    part,
  );
  const body = found
    ? logBox(found.logs, found.aiModel, lang)
    : `<p class="phasemsgempty muted">${esc(t(lang, "list.phaseNoneKept"))}</p>`;
  return [
    line,
    {
      tag: `<tr class="phasemsgs" data-msgs="implement.${part}">`,
      cells: `<td colspan="${LIST_COLUMNS}">${body}</td>`,
    },
  ];
}
