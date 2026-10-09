// The steps a job's log WILL mark, read before the job starts: what a Close
// or Reopen dialog lists, each waiting, from the moment it opens. The
// counterpart of `stepMarks`, and the two share `stepKey()`, so a mark moves
// the planned line that has its key.
//
// The plan is the skill's own `Step N of X` headings with Aide's two parts
// around the session's steps (see `aide-run-spec`), and the heading Aide
// writes itself after the session: the merge into main.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { capitalizeFirst } from "../../format/error-sentence.ts";
import { stepKey } from "./step-marks.ts";

/** The parts aide-run-spec marks itself: `aide_part_open "preparing"` (aide-run-spec), and
 *  `aide_part_open "tests and commit"` once the session is over (run-spec/turn/spec-paths.sh). */
export const AIDE_PARTS = { before: "preparing", after: "tests and commit" } as const;

/** The steps aide-run-spec runs with no model turn, whatever the job asks (spec-paths.sh's reopen branch):
 *  the skill's own steps are never marked for them, only Aide's parts and the merge. */
export const NO_MODEL_TURN: ReadonlySet<string> = new Set(["reopen"]);

const SKILLS_DIR = join(import.meta.dir, "../../../../core/skills");

const HEADING = /^#{2,} Step (\d+ of \d+): (.+)$/gm;

export interface PlannedStep {
  key: string;
  label: string;
}

/** A read skill, kept while its file's modification time is unchanged: a landing does not restart the
 *  board, and a list of archived rows draws one dialog per row. */
const kept = new Map<string, { mtimeMs: number; plan: PlannedStep[] }>();

/** Every step `step`'s log marks, in the order it marks them, each a line the dialog draws waiting.
 *  A skill that is missing, unreadable or without a `Step N of X:` heading gives `[]`. */
export function stepPlan(step: string, skills = SKILLS_DIR): PlannedStep[] {
  const file = join(skills, `aide-${step}`, "SKILL.md");
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return [];
  }
  const hit = kept.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.plan;
  let text: string;
  try {
    text = readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  const plan = planFrom(text, !NO_MODEL_TURN.has(step));
  kept.set(file, { mtimeMs, plan });
  return plan;
}

function planFrom(text: string, hasModelTurn: boolean): PlannedStep[] {
  const session: PlannedStep[] = [];
  const aide: PlannedStep[] = [];
  for (const match of text.matchAll(HEADING)) {
    const [, place, title] = match as unknown as [string, string, string];
    const under = text.slice(match.index + match[0].length).split("\n").find((l) => l.trim() !== "") ?? "";
    (under.startsWith("Aide writes") ? aide : session).push({ key: stepKey(place, title), label: capitalizeFirst(title) });
  }
  if (session.length + aide.length === 0) return [];
  return [part(AIDE_PARTS.before), ...(hasModelTurn ? session : []), part(AIDE_PARTS.after), ...aide];
}

const part = (name: string): PlannedStep => ({ key: stepKey("Aide", name), label: capitalizeFirst(name) });
