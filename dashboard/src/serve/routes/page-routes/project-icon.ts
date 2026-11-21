// GET /projects/<name>/icon: the project's icon image, read off its default
// branch as origin last answered for it. The type comes from an allow-listed
// extension, and the answer forbids scripts and sniffing, so an SVG opened
// at this address by itself runs nothing on the board's origin.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "../../../project/parse-manifest.ts";
import { iconType, readBlob, resolveProjectIcon } from "../../../project/project-icon/index.ts";
import type { RoutesContext } from "..";

/** Where a project's icon is served. */
export const projectIconPath = (name: string): string => `/projects/${encodeURIComponent(name)}/icon`;

/** The project's `icon` setting, as the manifest the board reads holds it. */
function configuredIcon(dir: string): string | undefined {
  const file = join(dir, ".aide", "project.yaml");
  if (!existsSync(file)) return undefined;
  const parsed = parseManifest(readFileSync(file, "utf-8"));
  return parsed.ok ? parsed.data.icon : undefined;
}

/** The repository path of the project's icon and the directory it is read
 *  in, or null for a project with none. Never throws: a git that cannot
 *  answer is a project with no icon. */
export async function projectIconFile(ctx: RoutesContext, name: string): Promise<{ dir: string; base: string; path: string } | null> {
  try {
    const dir = ctx.machineryProjectDir(name);
    const base = await ctx.branchStatus.defaultBranch(dir);
    if (!base) return null;
    const path = await resolveProjectIcon(ctx.gitRun, dir, base, configuredIcon(dir));
    return path ? { dir, base, path } : null;
  } catch {
    return null;
  }
}

/** Where each page finds the project's icon, or null to draw its initials. */
export async function projectIconSrc(ctx: RoutesContext, name: string): Promise<{ src: string } | null> {
  return (await projectIconFile(ctx, name)) ? { src: projectIconPath(name) } : null;
}

export async function projectIconRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  const match = path.match(/^\/projects\/([^/]+)\/icon$/);
  if (!match) return null;
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
  const name = decodeURIComponent(match[1]!);
  if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) return new Response("not found", { status: 404 });
  const found = await projectIconFile(ctx, name);
  const type = found && iconType(found.path);
  const bytes = found && type ? await readBlob(found.dir, `refs/remotes/origin/${found.base}`, found.path) : null;
  if (!found || !type || !bytes) return new Response("not found", { status: 404 });
  return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
    headers: {
      "content-type": type,
      "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
      "cache-control": "no-cache",
    },
  });
}
