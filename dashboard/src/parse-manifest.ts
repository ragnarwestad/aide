// Normalize hand-edited .aide/project.yaml into one render shape.
// The two real manifests already diverge (logging.where is a string
// in one, a list in the other) — normalization is the point.

import { parse } from "yaml";

export interface ManifestData {
  name?: string;
  description?: string;
  generated?: string;
  stack?: Record<string, string>;
  dependencies?: string[];
  /** `preview` is a URL TEMPLATE with a literal `{branch}` in it —
   *  where one branch can be tried, as opposed to `url`, which is
   *  where the merged site lives. Only a project whose host builds
   *  every branch has one. */
  deployment?: { host?: string; command?: string; url?: string; preview?: string; note?: string };
  logging?: { where: string[] };
  statistics?: string[];
  reports?: { title?: string; url?: string; recipe?: string }[];
  docs?: string[];
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
}

export type ManifestResult =
  | { ok: true; data: ManifestData }
  | { ok: false; error: string };

function toList(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

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
  if (r.generated != null) data.generated = toStr(r.generated);
  if (r.stack != null && typeof r.stack === "object" && !Array.isArray(r.stack)) {
    data.stack = Object.fromEntries(
      Object.entries(r.stack as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
    );
  }
  if (r.dependencies != null) data.dependencies = toList(r.dependencies);
  if (r.deployment != null && typeof r.deployment === "object") {
    const d = r.deployment as Record<string, unknown>;
    data.deployment = {
      ...(d.host != null && { host: toStr(d.host) }),
      ...(d.command != null && { command: toStr(d.command) }),
      ...(d.url != null && { url: toStr(d.url) }),
      ...(d.preview != null && { preview: toStr(d.preview) }),
      ...(d.note != null && { note: toStr(d.note) }),
    };
  }
  if (r.logging != null && typeof r.logging === "object") {
    const where = toList((r.logging as Record<string, unknown>).where);
    if (where) data.logging = { where };
  }
  if (r.statistics != null) data.statistics = toList(r.statistics);
  if (r.reports != null && Array.isArray(r.reports)) {
    data.reports = r.reports.map((entry) => {
      if (entry === null || typeof entry !== "object") return { title: String(entry) };
      const e = entry as Record<string, unknown>;
      return {
        ...(e.title != null && { title: toStr(e.title) }),
        ...(e.url != null && { url: toStr(e.url) }),
        ...(e.recipe != null && { recipe: toStr(e.recipe) }),
      };
    });
  }
  if (r.docs != null) data.docs = toList(r.docs);
  if (r.worktreeLinks != null) data.worktreeLinks = toStr(r.worktreeLinks);

  return { ok: true, data };
}
