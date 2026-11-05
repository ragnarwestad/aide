import { realpathSync } from "node:fs";
import { resolve } from "node:path";

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
