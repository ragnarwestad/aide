// Which image is a project's icon: the manifest's `icon` when the default
// branch tracks it and it is an image, else the tracked favicon nearest the
// repository's root, an SVG before a PNG before an ICO. Read only off
// `refs/remotes/origin/<base>`, never fetched, so a file that is only in
// the working tree — a build's `dist/` — is never the icon.

import type { GitRunner } from "../../git/process/index.ts";

export { readBlob } from "./read-blob.ts";
export { ICON_FILE_MAX, checkIconFile, clearChosenIcon, readChosenIcon, writeChosenFile, writeChosenGlyph, type ChosenIcon } from "./chosen.ts";
export { GLYPH_NAMES, glyphSvg, isGlyph } from "./glyphs.ts";

/** The image types an icon may be, and the type each is served as. Any
 *  other extension is not an icon. */
export const ICON_TYPES: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** The type `path` is served as, or undefined for a file that is not an icon. */
export function iconType(path: string): string | undefined {
  const ext = path.toLowerCase().match(/\.([a-z]+)$/)?.[1];
  return ext ? ICON_TYPES[ext] : undefined;
}

const FAVICON_ORDER = ["favicon.svg", "favicon.png", "favicon.ico"];

/** The favicon nearest the root, then by kind, then by path. */
function pickFavicon(paths: string[]): string | null {
  const candidates = paths
    .map((path) => ({ path, kind: FAVICON_ORDER.indexOf(path.split("/").pop()!), depth: path.split("/").length }))
    .filter((c) => c.kind >= 0)
    .sort((a, b) => a.depth - b.depth || a.kind - b.kind || a.path.localeCompare(b.path));
  return candidates[0]?.path ?? null;
}

/** The answer for one project at one commit with one `icon` setting. */
const cache = new Map<string, string | null>();

/** The repository path of the project's icon, or null for none. `base` is
 *  the project's default branch, null when it is not known. */
export async function resolveProjectIcon(
  run: GitRunner,
  dir: string,
  base: string | null,
  configured?: string,
): Promise<string | null> {
  if (!base) return null;
  const ref = `refs/remotes/origin/${base}`;
  const sha = await run(dir, ["rev-parse", "--verify", "--quiet", ref]);
  if (sha.code !== 0) return null;
  const wanted = configured?.trim().replace(/^\.?\//, "") ?? "";
  const key = JSON.stringify([dir, sha.stdout.trim(), wanted]);
  if (cache.has(key)) return cache.get(key)!;
  let found: string | null = null;
  if (wanted && iconType(wanted)) {
    const tracked = await run(dir, ["cat-file", "-t", `${ref}:${wanted}`]);
    if (tracked.code === 0 && tracked.stdout.trim() === "blob") found = wanted;
  }
  if (!found) {
    // `-z`: each path as git holds it, NUL-ended, never quoted, so a path
    // with a character outside ASCII is still found.
    const listed = await run(dir, ["ls-tree", "-r", "-z", "--name-only", ref]);
    found = listed.code === 0 ? pickFavicon(listed.stdout.split("\0").filter(Boolean)) : null;
  }
  cache.set(key, found);
  return found;
}
