import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export function realPathOrOriginal(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function realPathOrAbsolute(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export function sameRepositoryPath(left: string, right: string): boolean {
  return realPathOrAbsolute(left) === realPathOrAbsolute(right);
}

export function isPathInside(path: string, root: string): boolean {
  const rel = relative(realPathOrAbsolute(root), realPathOrAbsolute(path));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel));
}
