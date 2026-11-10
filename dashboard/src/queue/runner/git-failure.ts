// A step whose work did not reach origin, whose base could not be
// fetched, or whose branch could not be brought up to date with the base,
// in the board's own words: which repo,
// which branch, and why — from what the runner sorted out of git's own
// output (`core/scripts/lib/git-error.sh`) and the files a conflict named
// (`update_branch_to_base`, `run-spec/checkout/worktree.sh`). The runner's
// own English, with git's lines, stays the row's (?) detail.

import type { Sentence } from "../../messages/types.ts";
import { type GitError } from "../../format/git-error.ts";
import { getGitPushMessage, getGitFetchMessage } from "../../messages/git/get.ts";
import type { StepOutcome } from "./types.ts";

type Repo = "code" | "specs";

export interface PushFailure {
  repo: Repo;
  branch: string;
  error: GitError;
}

export interface Conflict {
  repo: Repo;
  branch: string;
  base: string;
  files: string[];
  more: number;
}

const repoOf = (raw: unknown): Repo | undefined => (raw === "code" || raw === "specs" ? raw : undefined);
const text = (raw: unknown): string | undefined => (typeof raw === "string" && raw.trim() ? raw.trim() : undefined);

/** One entry of `outcome.pushFailures`, read as defensively as any other
 *  field another process wrote: a kind the runner does not write, or a
 *  `refused`/`other` with no words, is nothing at all. */
function gitErrorOf(r: Record<string, unknown>): GitError | undefined {
  if (r.kind === "auth" || r.kind === "github" || r.kind === "none") return { kind: r.kind };
  const message = text(r.message);
  if ((r.kind === "network" || r.kind === "no-write" || r.kind === "https-auth" || r.kind === "refused" || r.kind === "other") && message) return { kind: r.kind, message };
  return undefined;
}

export function pushFailures(raw: unknown): PushFailure[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((one): PushFailure[] => {
    if (one === null || typeof one !== "object") return [];
    const r = one as Record<string, unknown>;
    const repo = repoOf(r.repo);
    const branch = text(r.branch);
    const error = gitErrorOf(r);
    return repo && branch && error ? [{ repo, branch, error }] : [];
  });
}

export function conflictOf(raw: unknown): Conflict | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const repo = repoOf(r.repo);
  const branch = text(r.branch);
  const base = text(r.base);
  const files = Array.isArray(r.files) ? r.files.filter((f): f is string => typeof f === "string" && f !== "") : [];
  if (!repo || !branch || !base || files.length === 0) return undefined;
  const more = typeof r.more === "number" && r.more > 0 ? Math.floor(r.more) : 0;
  return { repo, branch, base, files, more };
}

/** A step that ended `unpushed`: one sentence per repo whose push failed,
 *  naming the repo and the branch, with why as its inner sentence. A
 *  refusal because the base could not be fetched (`fetchFailure`, the
 *  same shape as one push failure): the repo, the base and why. A
 *  refusal for a conflict: the repo, the branch, the base and the files.
 *  Undefined for every other ending, or when the runner named none. */
export function gitFailureMessage(outcome: Partial<StepOutcome>): Sentence | Sentence[] | undefined {
  if (outcome.terminalReason === "unpushed") {
    const failed = pushFailures(outcome.pushFailures);
    if (failed.length === 0) return undefined;
    const sentences = failed.map(
      (f): Sentence => ({
        key: f.repo === "code" ? "runner.notPushedCode" : "runner.notPushedSpecs",
        values: { branch: f.branch },
        inner: getGitPushMessage(f.error),
      }),
    );
    return sentences.length === 1 ? sentences[0] : sentences;
  }
  if (outcome.terminalReason === "refused" && outcome.fetchFailure !== undefined) {
    const [f] = pushFailures([outcome.fetchFailure]);
    if (!f) return undefined;
    return {
      key: f.repo === "code" ? "runner.notFetchedCode" : "runner.notFetchedSpecs",
      values: { base: f.branch },
      inner: getGitFetchMessage(f.error),
    };
  }
  if (outcome.terminalReason === "refused" && outcome.errorReason === "conflict") {
    const c = conflictOf(outcome.conflict);
    if (!c) return undefined;
    return {
      key: c.repo === "code" ? "runner.conflictCode" : "runner.conflictSpecs",
      values: { branch: c.branch, base: c.base, files: [...c.files, ...(c.more ? ["…"] : [])] },
    };
  }
  return undefined;
}
