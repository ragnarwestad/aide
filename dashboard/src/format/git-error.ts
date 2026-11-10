// What git said when a push failed, sorted for the board, so a row says
// "GitHub does not accept the machine's SSH key" rather than git's own
// lines cut off at a byte count.
//
// `git_error_json` and `git_error_detail` in core/scripts/lib/git-error.sh
// sort a run's own pushes the same way; core/tests/fixtures/git-errors.json
// pins both. Sorted in this order: an SSH key fault is followed by "Could
// not read from remote repository", which a network failure prints too,
// and GitHub's 500 arrives on a `[remote rejected]` line.

/** `auth`: GitHub does not take the machine's SSH key or login. `github`:
 *  GitHub had an error (a 5xx), or the network failed. `refused`: origin
 *  turned the push down, and `message` is origin's own first line.
 *  `other`: anything else, with git's own first line. `none`: git said
 *  nothing. */
export type GitError =
  | { kind: "auth" }
  | { kind: "no-write" | "https-auth" | "network"; message: string }
  | { kind: "github" }
  | { kind: "refused"; message: string }
  | { kind: "other"; message: string }
  | { kind: "none" };

const AUTH = /permission denied \(publickey/i;
const NO_WRITE = /permission to \S+ denied|returned error: 403\b/i;
const HTTPS_AUTH = /authentication failed|could not read (username|password)|invalid username or password|returned error: 401\b/i;
const GITHUB =
  /internal server error|returned error: 5[0-9][0-9]\b|http 5[0-9][0-9]\b|\b5[0-9][0-9] (bad gateway|service unavailable|gateway time-?out)|bad gateway|service unavailable|connection (reset|closed)|the remote end hung up unexpectedly/i;
const NETWORK = /could not resolve host|connection (timed out|refused)|operation timed out|network is unreachable|no route to host|temporary failure in name resolution/i;
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
  const first =
    all.map((l) => l.replace(/^remote:\s*/, "")).find((l) => l.length > 0 && !NOT_THE_CAUSE.test(l)) ?? all[0]!;
  const message = cut(
    first
      .replace(/^(! |error: |fatal: |ERROR: )/, "")
      .replace(/\s+/g, " ")
      .replace(/\.+$/, ""),
  );
  if (NO_WRITE.test(text)) return { kind: "no-write", message };
  if (HTTPS_AUTH.test(text)) return { kind: "https-auth", message };
  if (GITHUB.test(text)) return { kind: "github" };
  if (NETWORK.test(text)) return { kind: "network", message };
  return REFUSED.test(text) ? { kind: "refused", message } : { kind: "other", message };
}

/** The files a conflict named, as one value every language reads alike:
 *  `a.ts, b.ts (+3)`. */
export const conflictFiles = (files: string[], more: number): string =>
  `${files.join(", ")}${more > 0 ? ` (+${more})` : ""}`;
