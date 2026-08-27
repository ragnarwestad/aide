// Where a no-JS form POST goes back to, and the two commit messages a
// Save writes.

import { EDITABLE_SPEC_FILE, FILTER_FIELD_PREFIX, FILTER_KEYS, STATUS_SPEC_FILE } from "../../render.ts";

/** Why an archived spec refuses to be edited (spec 163). One sentence,
 *  in one place: the GET that would have rendered the form and the POST
 *  that would have written the file both say it, and the page a reader
 *  lands on is the spec's own. */
export const ARCHIVED_REFUSAL = "this spec is archived — it is a record, and cannot be edited";

/** What a Save's commit RECORDS. Two routes since spec 212 — the
 *  description's own Save and the checks' — and each writes one file,
 *  so each has one sentence. There was a third, for the one commit that
 *  could carry both; two files can no longer arrive in one request, so
 *  it has nothing left to describe.
 *
 *  Never the runner's grammar: `workflow-history.ts` counts a step by a
 *  commit subject beginning "Run /aide-", and a hand edit is not a step
 *  the spec has had. */
export const editMessage = (specFolder: string): string =>
  `Edit ${EDITABLE_SPEC_FILE} for ${specFolder} from the dashboard`;
export const tickMessage = (specFolder: string): string =>
  `Tick a check in ${STATUS_SPEC_FILE} for ${specFolder} by hand from the dashboard`;

/** Where a form POST goes back to. Built from the five view keys the
 *  page's own forms send (`FILTER_KEYS`, under `FILTER_FIELD_PREFIX`),
 *  so pressing Run, Cancel or Resolve lands the reader back on the list
 *  they were looking at instead of the default one.
 *
 *  Encoded one key at a time rather than through `URLSearchParams`,
 *  which writes a space as `+`: a refusal's reason goes in this string
 *  and is read by a person. With nothing to carry the target stays
 *  exactly `/`, never `/?`. */
export function specsRedirect(
  body: unknown,
  refusal?: { error: string; spec?: string },
  // Which page the form was ON. `/` for every control on the spec list,
  // which is all of them but three: the project panel moved to
  // `/projects` with spec 115 and the New-spec form to `/new` with spec
  // 121, and a reader refused on either must not be dropped onto the
  // spec list to read the answer.
  target: string = "/",
  /** Something that went RIGHT and the reader still has to read — the
   *  readiness of a project that was just added (spec 138). It rides
   *  where a refusal rides, for the same reason: a redirect is the only
   *  thing a no-script form POST gets back. */
  notice?: { note: string; ok: boolean },
): Response {
  const sent = (body ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of FILTER_KEYS) {
    const value = sent[`${FILTER_FIELD_PREFIX}${key}`];
    if (typeof value === "string" && value) parts.push(`${key}=${encodeURIComponent(value)}`);
  }
  if (refusal) {
    parts.push(`error=${encodeURIComponent(refusal.error)}`);
    // Which row it belongs to. Always derived server-side by the
    // caller — the page lists up to 25 specs, and a reason attached to
    // none of them says nothing about which button was pressed.
    if (refusal.spec) parts.push(`errorSpec=${encodeURIComponent(refusal.spec)}`);
    // WHY it was refused used to ride here too, so the row could offer a
    // `resolve` step for a conflict. It is on the job since spec 149:
    // the refusal that needs it is a LANDING's, and a landing has no
    // browser to redirect.
  }
  if (notice) {
    parts.push(`notice=${encodeURIComponent(notice.note)}`);
    // The colour, not the answer: the sentence says which it is, and
    // the page must not have to read the sentence to draw it.
    if (notice.ok) parts.push("noticeOk=1");
  }
  const query = parts.join("&");
  // `&` when the target already carries a query of its own: a refused
  // save goes back to the tab its form was on (spec 212), and that tab
  // is a `?tab=` on the spec's own path.
  const sep = target.includes("?") ? "&" : "?";
  return new Response(null, { status: 303, headers: { location: query ? `${target}${sep}${query}` : target } });
}

/** Every refusal, in `serve.log`. Both streams of the launchd job go to
 *  that one file (`deploy/render-plist.ts`), so `console.error` IS the
 *  log line — and until now no request handler wrote one at all, which
 *  left a day of refused merges with nothing on disk to read back. */
export function logRefusal(action: string, spec: string | undefined, reason: string): void {
  console.error(`queue: ${action} refused for ${spec ?? "an unknown spec"} — ${reason}`);
}
