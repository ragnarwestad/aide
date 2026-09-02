// A spec's page opens the spec as a PDF (spec 358): the server runs the
// same `core/scripts/aide-generate-pdf` the `/aide-to-pdf` skill runs
// (REQ-3), told to write outside every checkout (REQ-4), and streams the
// result back inline so the browser's own viewer shows it (REQ-2). The
// result is cached on the spec folder's own latest commit (REQ-5).

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { lastCommitOf } from "../../git/description-freshness.ts";
import type { HandleQueueContext } from "../handle-queue.ts";

/** Homedir, sibling of `queueResultDir`'s own default — never inside a
 *  checkout, which is the exact bug REQ-4 exists to prevent. */
export const DEFAULT_PDF_CACHE_DIR = join(homedir(), "aide-dashboard", "pdf-cache");

export async function handleSpecPdfRoute(
  ctx: HandleQueueContext,
  req: Request,
  path: string,
): Promise<Response | null> {
  const match = path.match(/^\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/pdf$/);
  if (!match) return null;
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
  const [, project, specFolder] = match;
  const found = ctx.specDir(project!, specFolder!);
  if (!found) return new Response("not found", { status: 404 });
  if (!ctx.pdfToolAvailable) return new Response("md-to-pdf is not installed on this host", { status: 503 });
  // `aide_resolve_spec`'s `archive/` fallback only fires for a bare
  // number or a JIRA key — a full folder slug (the only shape this route
  // ever has) hits its "assume full folder ID" branch, which cannot find
  // an archived spec on its own (verified empirically, spec 358's plan
  // review). An archived spec's real path IS `archive/<folder>`, which
  // the script's own direct-match branch resolves correctly passed as-is.
  const ref = ctx.specRef(project!, specFolder!);
  const scriptSpecId = ref?.archived ? `archive/${specFolder}` : specFolder!;
  const dir = await ctx.machinerySpecDir(project!, found);
  // Uncached: the display side's 30s TTL (`SpecFileCommitChecker`) is
  // right for a passive read, wrong for a cache KEY — a Save landing
  // inside that window must not be read as a hit.
  const commit = await lastCommitOf(ctx.gitRun, dir, ".");
  const sha = commit?.sha ?? "uncommitted";
  const cachePath = join(ctx.pdfCacheDir, project!, specFolder!, `${sha}.pdf`);
  if (!existsSync(cachePath)) {
    mkdirSync(dirname(cachePath), { recursive: true });
    const proc = Bun.spawn({
      cmd: [ctx.pdfGeneratorBin, scriptSpecId, cachePath],
      cwd: ctx.machineryProjectDir(project!),
      stdout: "ignore",
      stderr: "pipe",
    });
    const code = await proc.exited;
    if (code !== 0 || !existsSync(cachePath)) {
      return new Response(await new Response(proc.stderr).text(), { status: 502 });
    }
  }
  return new Response(Bun.file(cachePath), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${specFolder}.pdf"`,
    },
  });
}
