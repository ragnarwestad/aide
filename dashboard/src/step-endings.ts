import data from "../../core/scripts/lib/step-endings/catalog.json" with { type: "json" };

export type StepEnding = string;
export type StepEndingRecord = Readonly<{
  name: StepEnding;
  jobStop: boolean;
  runStop: boolean;
  failure: boolean;
  guard: boolean;
  leavesStepUndone: boolean;
  mayRetry: boolean;
}>;

const BOOLEAN_FIELDS = [
  "jobStop", "runStop", "failure", "guard", "leavesStepUndone", "mayRetry",
] as const;

function parseRecords(value: unknown): readonly StepEndingRecord[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { reasons?: unknown }).reasons))
    throw new Error("step-endings.json must contain a reasons array");
  const seen = new Set<string>();
  return (value as { reasons: unknown[] }).reasons.map((item) => {
    if (!item || typeof item !== "object") throw new Error("step-ending records must be objects");
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || !record.name) throw new Error("step-ending records need a name");
    if (seen.has(record.name)) throw new Error(`duplicate step ending: ${record.name}`);
    seen.add(record.name);
    for (const field of BOOLEAN_FIELDS)
      if (typeof record[field] !== "boolean") throw new Error(`${record.name}.${field} must be boolean`);
    return record as StepEndingRecord;
  });
}

export const STEP_ENDINGS = parseRecords(data);
const BY_NAME = new Map(STEP_ENDINGS.map((record) => [record.name, record]));

export const isStepEnding = (value: unknown): value is StepEnding =>
  typeof value === "string" && BY_NAME.has(value);

export function requireStepEnding(value: string): StepEndingRecord {
  const record = BY_NAME.get(value);
  if (!record) throw new Error(`unknown step ending: ${value}`);
  return record;
}

const has = (reason: string | undefined, field: keyof StepEndingRecord): boolean =>
  reason !== undefined && BY_NAME.get(reason)?.[field] === true;

export type StopReason = StepEnding;
export const isJobStop = (reason: string | undefined): reason is StopReason => has(reason, "jobStop");
export const isRunStop = (reason: string | undefined): reason is StopReason => has(reason, "runStop");
export const isFailedEnding = (reason: string | undefined): boolean => has(reason, "failure");
export const isGuardEnding = (reason: string | undefined): boolean => has(reason, "guard");
export const leavesStepUndone = (reason: string | undefined): boolean => has(reason, "leavesStepUndone");
export const endingMayRetry = (reason: string | undefined): boolean => has(reason, "mayRetry");

export const NOT_IMPLEMENTED_YET = requireStepEnding("not-implemented-yet").name;
export const ACCEPTANCE_CRITERIA_UNTICKED = requireStepEnding("acceptance-criteria-unticked").name;
