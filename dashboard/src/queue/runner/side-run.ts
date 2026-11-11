// The review and the verification of an implement step, as the result file
// reports each: how the session ended, on which tool, how long it took, its
// own dollars and tokens, and the bytes it wrote in the step's transcript.
// Another process's JSON, so every part is a question and a malformed part
// is dropped alone.

import type { ResultTool } from "../providers/tools.ts";
import type { ProviderLimit, TokenUsage } from "../queue.ts";
import { asResultTool } from "../steps.ts";
import { providerError, providerLimit, timeLimit, tokenUsage, type ProviderError, type TimeLimit } from "./types.ts";

export interface SideRun {
  /** How the session ended, in the runner's own words (`completed`, `cli-error`, …). */
  outcome: string;
  tool?: ResultTool;
  durationSec?: number;
  /** Only when the tool reports a dollar figure and measured one. */
  costUsd?: number;
  tokens?: TokenUsage;
  sessionId?: string;
  modelId?: string;
  error?: string;
  errorSolution?: string;
  atCapacity?: string;
  providerLimit?: ProviderLimit;
  providerError?: ProviderError;
  timeLimit?: TimeLimit;
  /** Where the session's bytes begin and end in the step's transcript. */
  transcript?: { from: number; to: number };
}

const count = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

/** `outcome.review` or `outcome.verify`, or nothing when it names no outcome. */
export function sideRun(raw: unknown): SideRun | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.outcome !== "string" || r.outcome === "") return undefined;
  const out: SideRun = { outcome: r.outcome };
  const tool = asResultTool(r.tool);
  if (tool) out.tool = tool;
  const durationSec = count(r.durationSec);
  if (durationSec !== undefined) out.durationSec = durationSec;
  const costUsd = count(r.costUsd);
  if (costUsd !== undefined) out.costUsd = costUsd;
  const tokens = tokenUsage(r.tokens);
  if (tokens) out.tokens = tokens;
  const text = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
  const sessionId = text(r.sessionId);
  if (sessionId) out.sessionId = sessionId;
  const modelId = text(r.modelId);
  if (modelId) out.modelId = modelId;
  const error = text(r.error);
  if (error) out.error = error;
  const errorSolution = text(r.errorSolution);
  if (errorSolution) out.errorSolution = errorSolution;
  const atCapacity = text(r.atCapacity);
  if (atCapacity) out.atCapacity = atCapacity;
  const limit = providerLimit(r.providerLimit);
  if (limit) out.providerLimit = limit;
  const pError = providerError(r.providerError);
  if (pError) out.providerError = pError;
  const limitTime = timeLimit(r.timeLimit);
  if (limitTime) out.timeLimit = limitTime;
  const span = r.transcript;
  if (span !== null && typeof span === "object") {
    const { from, to } = span as Record<string, unknown>;
    if (Number.isInteger(from) && Number.isInteger(to) && (from as number) >= 0 && (from as number) <= (to as number)) {
      out.transcript = { from: from as number, to: to as number };
    }
  }
  return out;
}
