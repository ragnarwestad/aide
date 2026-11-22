// GET /projects/<name>/icon: the project's icon image, read off its default
// branch as origin last answered for it. The type comes from an allow-listed
// extension, and the answer forbids scripts and sniffing, so an SVG opened
// at this address by itself runs nothing on the board's origin. An icon the
// reader chose on the Config tab is asked for first, ahead of all of it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "../../../project/parse-manifest.ts";
import { iconType, readBlob, readChosenIcon, resolveProjectIcon } from "../../../project/project-icon/index.ts";
import type { ProjectIconView } from "../../../render/ui/components/card/project-icon.ts";
import { checkoutBase, chooseProjectIcon } from "./project-icon-choice.ts";
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

/** Where the project's icon comes from: the repository or its initials
 *  (`automatic`), a built-in icon the reader chose, or a file they chose. */
export type ProjectIconSource = "automatic" | "glyph" | "file";

export function projectIconSource(ctx: RoutesContext, name: string): ProjectIconSource {
  return readChosenIcon(checkoutBase(ctx), name)?.kind ?? "automatic";
}

/** What each page draws for the project's icon: a chosen built-in icon, a
 *  chosen file's address — carrying its time, so a new one is not taken
 *  from the browser's cache — the repository's image, or null for the
 *  initials. */
export async function projectIconSrc(ctx: RoutesContext, name: string): Promise<ProjectIconView> {
  const chosen = readChosenIcon(checkoutBase(ctx), name);
  if (chosen?.kind === "glyph") return { glyph: chosen.glyph, hue: chosen.hue };
  if (chosen?.kind === "file") return { src: `${projectIconPath(name)}?v=${chosen.mtime}` };
  return (await projectIconFile(ctx, name)) ? { src: projectIconPath(name) } : null;
}

const IMAGE_HEADERS = {
  "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
  "x-content-type-options": "nosniff",
  "cache-control": "no-cache",
};

/** The image's answer, under headers that let nothing in it run. */
const image = (bytes: Uint8Array, type: string): Response =>
  new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), { headers: { "content-type": type, ...IMAGE_HEADERS } });

export async function projectIconRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  const match = path.match(/^\/projects\/([^/]+)\/icon$/);
  if (!match) return null;
  const name = decodeURIComponent(match[1]!);
  if (req.method === "POST") return chooseProjectIcon(ctx, req, name);
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
  if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) return new Response("not found", { status: 404 });
  const chosen = readChosenIcon(checkoutBase(ctx), name);
  if (chosen?.kind === "file") {
    try {
      return image(new Uint8Array(readFileSync(chosen.path)), chosen.type);
    } catch {
      // Gone between the two reads: the repository's icon answers instead.
    }
  }
  const found = await projectIconFile(ctx, name);
  const type = found && iconType(found.path);
  const bytes = found && type ? await readBlob(found.dir, `refs/remotes/origin/${found.base}`, found.path) : null;
  if (!found || !type || !bytes) return new Response("not found", { status: 404 });
  return image(bytes, type);
}
