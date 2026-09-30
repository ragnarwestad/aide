// The sentences a refused or saved edit writes: the archived refusal,
// the two commit messages a Save writes, and the refusal's log line.

import { STATUS_SPEC_FILE } from "../../render";

/** Why an archived spec refuses to be edited (spec 163). One sentence,
 *  in one place: the GET that would have rendered the form and the POST
 *  that would have written the file both say it, and the page a reader
 *  lands on is the spec's own. */
export const ARCHIVED_REFUSAL = "this spec is archived — it is a record, and cannot be edited";

/** What a Save's commit RECORDS. Two routes since spec 212 — the
 *  document tabs' own Save (any of the four files, spec 310) and the
 *  checks' — and each writes one file, so each has one sentence. There
 *  was a third, for the one commit that could carry both; two files can
 *  no longer arrive in one request, so it has nothing left to describe.
 *
 *  Never the runner's grammar: `workflow-history.ts` counts a step by a
 *  commit subject beginning "Run /aide-", and a hand edit is not a step
 *  the spec has had. */
export const editMessage = (specFolder: string, file: string): string =>
  `Edit ${file} for ${specFolder} from the dashboard`;
export const tickMessage = (specFolder: string): string =>
  `Tick a check in ${STATUS_SPEC_FILE} for ${specFolder} by hand from the dashboard`;

/** Every refusal, in `serve.log`. Both streams of the launchd job go to
 *  that one file (`deploy/render-plist.ts`), so `console.error` IS the
 *  log line — and until now no request handler wrote one at all, which
 *  left a day of refused merges with nothing on disk to read back. */
export function logRefusal(action: string, spec: string | undefined, reason: string): void {
  console.error(`queue: ${action} refused for ${spec ?? "an unknown spec"} — ${reason}`);
}
