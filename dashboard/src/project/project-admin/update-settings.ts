// Change a project's settings after it was added. Split out of
// project-admin.ts (split project-admin.ts by theme).

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitRunner } from "../../git/branch-status.ts";
import { configValue } from "../discover.ts";
import { parseManifest } from "../parse-manifest.ts";
import { upsertManifestScalar, worktreeLinksError, writeAideConfig } from "./manifest-io.ts";
import { assessProjectReadiness } from "./readiness.ts";
import { fail, type ProjectAdminResult, type ProjectStep } from "./types.ts";

/** What a project may say about where its archived code goes (spec
 *  220). Two values, not the runner's three: `none` is an operational
 *  choice about whether this host publishes anything at all, and it
 *  belongs to the machine's own queue config — this is the team's
 *  question of whether code is reviewed before it lands. */
const CODE_LANDINGS = ["merge", "pr"] as const;

/** Change a project's three settings after it was added (spec 184).
 *
 *  Until this existed, the fields lived on the Add form and nowhere
 *  else: a project added with either left blank could only be fixed by
 *  taking it off the dashboard and adding it again, or by opening a
 *  terminal on the serving host and editing a file. The readiness check
 *  already named what was missing; this is the place to act on it.
 *
 *  The settings go to two different files, and that split is the
 *  point of the spec: the specs path names a directory on THIS machine
 *  and stays in the gitignored `.aide/config`, while the worktree links
 *  are true of the project on any machine and go in the committed
 *  manifest. Spec 220's code-landing choice joins the manifest half for
 *  a sharper version of the same reason — a review policy a fresh clone
 *  cannot read is not a policy the project has.
 *
 *  A field whose submitted value MATCHES what is already stored is not
 *  written at all — that is what makes "change the specs path and leave
 *  the links alone" leave the manifest byte-identical, rather than
 *  rewriting both files on every save. An empty value is a real answer
 *  and clears the setting; it is not the same as "not submitted".
 *
 *  Refuses an unusable links value before EITHER file is opened, through
 *  the same `worktreeLinksError` the Add form and the readiness check
 *  ask — one rule, asked in one place. */
export async function updateProjectSettings(
  run: GitRunner,
  projectDir: string,
  req: {
    specsPath?: string;
    worktreeLinks?: string;
    codeLanding?: string;
    /** Both gated on presence in `req`, unlike `specsPath` above:
     *  `codeLanding` already reads that way (`req.codeLanding !==
     *  undefined`), and the two joining it need the same rule — a
     *  future caller posting only some fields must not blank ones it
     *  never intended to touch (spec 255). */
    installCmd?: string;
    jiraBaseUrl?: string;
  },
): Promise<ProjectAdminResult> {
  const links = (req.worktreeLinks ?? "").trim();
  if (links) {
    const linkError = worktreeLinksError(links);
    if (linkError) return fail("worktreeLinks", linkError);
  }
  // Before either file is opened, exactly like the links above: a value
  // written and then refused by every reader is worse than one never
  // written at all.
  const landing = (req.codeLanding ?? "").trim();
  if (landing && !(CODE_LANDINGS as readonly string[]).includes(landing)) {
    return fail("codeLanding", `code landing must be ${CODE_LANDINGS.join(" or ")} — not "${landing}"`);
  }
  const steps: ProjectStep[] = [];
  const done = async (): Promise<ProjectAdminResult> => ({
    ok: steps.every((s) => s.ok),
    steps,
    readiness: await assessProjectReadiness(run, projectDir),
  });

  const specsPath = (req.specsPath ?? "").trim();
  if (specsPath !== (configValue(projectDir, "AIDE_SPECS_PATH") ?? "")) {
    // Made where it is not there yet, `archive/` and all — the same
    // thing Add does, for the same reason: a path configured and absent
    // is a refusal over something known the moment it was written.
    let note: string | undefined;
    if (specsPath && !existsSync(specsPath)) {
      try {
        mkdirSync(join(specsPath, "archive"), { recursive: true });
        note = `made the specs root at ${specsPath}, with its archive/`;
      } catch (err) {
        note = `could not make ${specsPath}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    try {
      writeAideConfig(projectDir, { AIDE_SPECS_PATH: specsPath });
      steps.push({ step: "specsConfig", ok: true, ...(note ? { note } : {}) });
    } catch (err) {
      steps.push({
        step: "specsConfig",
        ok: false,
        error: `could not write .aide/config: ${err instanceof Error ? err.message : String(err)}`,
      });
      return done();
    }
  }

  // Against the MANIFEST'S own value, never the resolved one: a project
  // still carrying its links in `.aide/config` shows them on the form,
  // and saving is what brings them across to the file that travels with
  // the repo. Compared against the resolved value, that save would find
  // nothing changed and the migration would never happen.
  const manifest = join(projectDir, ".aide", "project.yaml");
  const stored = existsSync(manifest)
    ? (() => {
        const parsed = parseManifest(readFileSync(manifest, "utf-8"));
        return parsed.ok ? (parsed.data.worktreeLinks ?? "").trim() : "";
      })()
    : "";
  if (links !== stored) {
    try {
      upsertManifestScalar(manifest, "worktreeLinks", links);
      steps.push({ step: "worktreeLinks", ok: true });
    } catch (err) {
      steps.push({
        step: "worktreeLinks",
        ok: false,
        error: `could not write ${manifest}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Spec 220, and the same rule again: compared against what the
  // MANIFEST says, and written only when it differs. `merge` is the
  // default, so choosing it takes the key OUT rather than spelling
  // today's behaviour into every project's manifest — which is exactly
  // what `upsertManifestScalar` does with an empty value.
  const storedLanding = existsSync(manifest)
    ? (() => {
        const parsed = parseManifest(readFileSync(manifest, "utf-8"));
        return parsed.ok ? (parsed.data.codeLanding ?? "") : "";
      })()
    : "";
  const wanted = landing === "merge" ? "" : landing;
  if (req.codeLanding !== undefined && wanted !== storedLanding) {
    try {
      upsertManifestScalar(manifest, "codeLanding", wanted);
      steps.push({ step: "codeLanding", ok: true });
    } catch (err) {
      steps.push({
        step: "codeLanding",
        ok: false,
        error: `could not write ${manifest}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Two more `.aide/config` keys, spec 255: same file, same
  // changed-only-write rule `specsPath` above follows, gated on
  // presence in `req` the way `codeLanding` is above them — a caller
  // that never mentions one of these two must not blank it.
  const writeConfigField = (step: "installCmd" | "jiraBaseUrl", configKey: string, value: string | undefined): void => {
    if (value === undefined) return;
    const trimmed = value.trim();
    if (trimmed === (configValue(projectDir, configKey) ?? "")) return;
    try {
      writeAideConfig(projectDir, { [configKey]: trimmed });
      steps.push({ step, ok: true });
    } catch (err) {
      steps.push({
        step,
        ok: false,
        error: `could not write .aide/config: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };
  writeConfigField("installCmd", "AIDE_INSTALL_CMD", req.installCmd);
  writeConfigField("jiraBaseUrl", "AIDE_JIRA_BASE_URL", req.jiraBaseUrl);

  return done();
}
