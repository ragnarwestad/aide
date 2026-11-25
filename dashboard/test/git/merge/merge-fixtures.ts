// The branch, the root and the readers the branch-merge tests share.
import type { GitCall } from "../../helpers/fake-git.ts";
import { formatSentence } from "../../../src/messages/format.ts";

export const BRANCH = "aide/89-merge-from-the-dashboard";
export const ROOT = "/repos/aide";

/** A wait that returns at once, so a retry loop costs no wall-clock time. */
export const noWait = async (_ms: number): Promise<void> => {};

/** What a reader would see: a message is stored as its key and the values
 *  that fill its blanks, and composed when the page is drawn. */
export function sentence(s: unknown): string {
  return formatSentence("en", s as Parameters<typeof formatSentence>[1]) ?? "";
}

/** The whole argv of every call, in order — the sequence is the thing
 *  under test, not any single command. */
export const argv = (calls: GitCall[]): string[] => calls.map((c) => c.args.join(" "));

/** Whether any call's argv starts with `prefix`. */
export const ran = (calls: GitCall[], prefix: string): boolean => argv(calls).some((a) => a.startsWith(prefix));
