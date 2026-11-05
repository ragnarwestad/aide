// What git said when a push failed, sorted for the board, so a row says
// "GitHub does not accept the machine's SSH key" rather than git's own
// lines cut off at a byte count.
//
// `git_error_json` and `git_error_detail` in core/scripts/lib/git-error.sh
// sort a run's own pushes the same way; core/tests/fixtures/git-errors.json
// pins both. Sorted in this order: an SSH key fault is followed by "Could
// not read from remote repository", which a network failure prints too,
// and GitHub's 500 arrives on a `[remote rejected]` line.

import type { BoardMessage } from "../i18n/message.ts";

/** `auth`: GitHub does not take the machine's SSH key or login. `github`:
 *  GitHub had an error (a 5xx), or the network failed. `refused`: origin
 *  turned the push down, and `message` is origin's own first line.
 *  `other`: anything else, with git's own first line. `none`: git said
 *  nothing. */
export type GitError =
  | { kind: "auth" }
  | { kind: "github" }
  | { kind: "refused"; message: string }
  | { kind: "other"; message: string }
  | { kind: "none" };

const AUTH =
  /permission denied \(publickey|authentication failed|could not read (username|password)|invalid username or password|permission to \S+ denied|returned error: 40[13]\b/i;
const GITHUB =
  /internal server error|returned error: 5[0-9][0-9]\b|http 5[0-9][0-9]\b|\b5[0-9][0-9] (bad gateway|service unavailable|gateway time-?out)|bad gateway|service unavailable|could not resolve host|connection (timed out|refused|reset|closed)|operation timed out|network is unreachable|no route to host|temporary failure in name resolution|the remote end hung up unexpectedly/i;
const REFUSED = /\[(remote )?rejected\]|non-fast-forward|protected branch|\bGH[0-9]{3}\b|hook declined/i;
/** Lines that say nothing about why: where git pushed to, its hints, and
 *  the sentences it adds to every failure. */
const NOT_THE_CAUSE =
  /^(To |hint:|error: failed to push some refs|fatal: Could not read from remote repository|Please make sure you have|and the repository exists)/;

/** The text as clean, non-empty lines: no colour codes, a carriage return
 *  read as a line break. */
function lines(said: string): string[] {
  return said
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** git's text in whole lines, eight at most: what the row keeps behind its (?). */
export function gitErrorDetail(said: string): string {
  return lines(said).slice(0, 8).join("\n");
}

/** One line cut at a word after 160 characters. */
function cut(line: string): string {
  if (line.length <= 160) return line;
  const head = line.slice(0, 160);
  const space = head.lastIndexOf(" ");
  return `${space > 80 ? head.slice(0, space) : head}…`;
}

export function gitError(said: string): GitError {
  const all = lines(said);
  if (all.length === 0) return { kind: "none" };
  const text = all.join("\n");
  if (AUTH.test(text)) return { kind: "auth" };
  if (GITHUB.test(text)) return { kind: "github" };
  const first =
    all.map((l) => l.replace(/^remote:\s*/, "")).find((l) => l.length > 0 && !NOT_THE_CAUSE.test(l)) ?? all[0]!;
  const message = cut(
    first
      .replace(/^(! |error: |fatal: |ERROR: )/, "")
      .replace(/\s+/g, " ")
      .replace(/\.+$/, ""),
  );
  return REFUSED.test(text) ? { kind: "refused", message } : { kind: "other", message };
}

/** Why a push failed, as the board's sentence: what happened, then what
 *  to do. A repo's and a branch's name are the caller's, around it. */
export function gitErrorSentence(error: GitError): BoardMessage {
  switch (error.kind) {
    case "auth":
      return { key: "git.pushAuth" };
    case "github":
      return { key: "git.pushGitHub" };
    case "refused":
      return { key: "git.pushRefused", values: { cause: error.message } };
    case "other":
      return { key: "git.pushOther", values: { cause: error.message } };
    case "none":
      return { key: "git.pushNoText" };
  }
}

/** Why a fetch of the base failed: the same sentence as a push for a key
 *  GitHub does not take or an error at GitHub, and otherwise git's words
 *  with the advice to fetch by hand rather than to push. */
export function gitFetchSentence(error: GitError): BoardMessage {
  switch (error.kind) {
    case "auth":
    case "github":
      return gitErrorSentence(error);
    case "refused":
    case "other":
      return { key: "git.fetchOther", values: { cause: error.message } };
    case "none":
      return { key: "git.fetchNoText" };
  }
}

/** The files a conflict named, as one value every language reads alike:
 *  `a.ts, b.ts (+3)`. */
export const conflictFiles = (files: string[], more: number): string =>
  `${files.join(", ")}${more > 0 ? ` (+${more})` : ""}`;
