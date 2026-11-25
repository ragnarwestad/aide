// The AI and model pickers a phase line draws, and what the Review line
// under Analyze follows without a choice of its own.

import { groupKey, isArchivedRow, lockedAsArchived, type SpecGroup } from "../data-model";
import type { SpecsPageOptions } from "../";
import { pickerFor, type PickerOptions } from "../model-resolve.ts";
import { resolveProvider } from "../../../ui/ai-model";
import { aiPicker, compactAiModel, modelPicker, phaseAiModel } from "./index.ts";

/** The AI and the model a phase line offers, in one place.
 *
 *  Two shapes out of one DOM. Wide, the two selects stand side by side
 *  as they always have. Narrow, they do not fit — a 360px phone has
 *  room for one of them, not two — so a box eight characters wide says
 *  what the line is ON ("Claude/sonnet"), and a tap lays the two
 *  selects over it. The stylesheet decides which; the selects
 *  themselves are drawn once, with the same `name` and `form` they have
 *  always had, so nothing about what a press posts changes.
 *
 *  No JavaScript opens it: the box is a `<label>` for a checkbox, the
 *  same technique the phase fold used, and `menu-script.ts` closes it
 *  on a click outside or Escape the way it already closes the "…" menu.
 *  A locked line draws the box unpressable — its selects are a record,
 *  not a choice. */
export function aiModel(
  g: SpecGroup,
  opts: SpecsPageOptions,
  step: string,
  busy: boolean,
  live: boolean,
  used?: string,
  recordedModel?: string,
  alreadyRun = false,
  usedTool?: string,
  ranModelId?: string,
  usedProvider?: string,
  formIdOverride?: string,
): string {
  const lang = opts.lang ?? "en";
  // One set of facts for the button and the two selects inside it.
  const facts = { live, used, recordedModel, usedTool, usedProvider };
  const ai = aiPicker(g, opts, step, busy, facts, formIdOverride, alreadyRun);
  const model = modelPicker(g, opts, step, busy, facts, formIdOverride, alreadyRun, ranModelId);
  const locked = lockedAsArchived(g, step) || (busy && !live) || alreadyRun;
  // No "(?)" on a phase line: the State column already says what is
  // running, and an archived or already-run phase needs no sentence to
  // say it cannot run again. The column has no room for a mark.
  if (!model) return `<span class="aimodel">${ai}</span>`;
  const on = phaseAiModel(g, opts, step, facts);
  return compactAiModel({
    id: `aim-${groupKey(g.project, g.specFolder)}-${step}`,
    lang,
    ai,
    model,
    locked,
    on,
    ...(on?.fromProject && !locked ? { fromProject: on.model } : {}),
  });
}

/** What the Review line under Analyze follows without a choice of its own:
 *  the model and provider the Analyze line would run on next. */
export function analyzeRests(
  g: SpecGroup, board: PickerOptions,
): { model: string; provider?: string; fromProject?: boolean } | undefined {
  const opts = pickerFor(board, g.project);
  const on = phaseAiModel(g, opts, "analyze", { live: false });
  if (!on) return undefined;
  const pick = isArchivedRow(g) ? undefined : opts.pendingProviders?.[groupKey(g.project, g.specFolder)]?.analyze;
  return { model: on.model, provider: resolveProvider(opts, "analyze", on.model, [pick])?.key, ...(on.fromProject ? { fromProject: true } : {}) };
}
