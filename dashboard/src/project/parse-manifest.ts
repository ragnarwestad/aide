// Read the settings out of a hand-edited .aide/project.yaml. A key
// nothing reads is left out of the result, so a manifest that still
// carries one keeps working.

import { parse } from "yaml";

/** The three ways a branch can be tried, in the order the Add form and
 *  the Config tab offer them. The one list: the parser, the choices and
 *  the validators all read it. */
export const PREVIEW_FROMS = ["none", "command", "cloudflare-pages"] as const;

export type PreviewFrom = (typeof PREVIEW_FROMS)[number];

export const isPreviewFrom = (v: string | undefined): v is PreviewFrom =>
  (PREVIEW_FROMS as readonly (string | undefined)[]).includes(v);

export interface ManifestData {
  name?: string;
  description?: string;
  /** `previewFrom` says how one branch of the project can be tried
   *  before it is merged: the host builds every branch
   *  (`cloudflare-pages`), the board starts the project on its own
   *  machine (`command`), or it cannot be tried without merging
   *  (`none`). A word this does not recognize is left ABSENT, which
   *  reads as `none`. */
  deployment?: { previewFrom: PreviewFrom };
  /** The gitignored paths a run has to symlink into its worktree, space
   *  separated (spec 184). Here rather than in `.aide/config` because it
   *  is true of the PROJECT on any machine — that a Vite project needs
   *  `node_modules` does not depend on whose laptop it is checked out
   *  on — and `.aide/config` is dropped by a global ignore rule, so a
   *  clone arrived on the next machine with that knowledge gone.
   *
   *  A scalar, not a list, and the dashboard writes it: `aide-run-spec`
   *  reads the same line with one anchored `sed`, and the run's own
   *  refusal wording names this key when the value came from here. */
  worktreeLinks?: string;
  /** Whether this project's archived CODE goes straight onto its default
   *  branch, or waits for a pull request (spec 220). Absent means
   *  `merge`, which is what every project did before this key existed.
   *
   *  Here rather than in `.aide/config` for a sharper reason than the
   *  worktree links have: whether code is reviewed before it lands is a
   *  TEAM policy, and `.aide/config` is dropped by a global ignore rule
   *  — a policy a fresh clone cannot see is a policy the project does
   *  not have. It has no `.aide/config` fallback at all, unlike
   *  `worktreeLinks`, which has one only because it had an older
   *  spelling to migrate from.
   *
   *  A value this does not recognize is left ABSENT rather than carried
   *  through, so no reader downstream has to decide for itself what a
   *  word it has never heard means. */
  codeLanding?: "merge" | "pr";
  /** The project's test command: the whole suite, run by a step, the
   *  landing and `/aide-implement` (`aide-resolve-test-cmd`). Read here
   *  and nowhere else, so every checkout runs the same command. */
  AIDE_TEST_CMD?: string;
  /** How to start this project so a person can LOOK at a spec's branch
   *  before its checks are ticked (spec: previews beyond aide). The
   *  dashboard runs it in a worktree of that branch, on a port from its
   *  own pool, and the command is expected to serve on `$PORT` and keep
   *  running until it is stopped.
   *
   *  A project that carries `dashboard/test/round/run` (aide itself)
   *  needs none — that script is what its own preview starts. */
  previewCmd?: string;
}

export type ManifestResult =
  | { ok: true; data: ManifestData }
  | { ok: false; error: string };

function toStr(v: unknown): string | undefined {
  return v == null ? undefined : String(v);
}

export function parseManifest(text: string): ManifestResult {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "manifest is not a YAML mapping" };
  }
  const r = raw as Record<string, unknown>;
  const data: ManifestData = {};

  if (r.name != null) data.name = toStr(r.name);
  if (r.description != null) data.description = toStr(r.description);
  if (r.deployment != null && typeof r.deployment === "object") {
    const previewFrom = toStr((r.deployment as Record<string, unknown>).previewFrom)?.trim();
    if (isPreviewFrom(previewFrom)) data.deployment = { previewFrom };
  }
  if (r.worktreeLinks != null) data.worktreeLinks = toStr(r.worktreeLinks);
  if (r.AIDE_TEST_CMD != null) data.AIDE_TEST_CMD = toStr(r.AIDE_TEST_CMD);
  if (r.previewCmd != null) data.previewCmd = toStr(r.previewCmd);
  // The one field here that is VALIDATED rather than normalized: it is a
  // two-value enum, and an unrecognized spelling has to fail toward the
  // safe default the same way an absent key does.
  const landing = toStr(r.codeLanding)?.trim();
  if (landing === "merge" || landing === "pr") data.codeLanding = landing;

  return { ok: true, data };
}
