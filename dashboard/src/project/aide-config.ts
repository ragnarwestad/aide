import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function readAideConfig(projectDir: string, key: string): string | null {
  const file = join(projectDir, ".aide", "config");
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const separator = line.indexOf("=");
    if (separator < 0 || line.slice(0, separator) !== key) continue;
    return line.slice(separator + 1).trim() || null;
  }
  return null;
}

export function aideConfigText(text: string, values: Record<string, string>): string {
  const keys = new Set(Object.keys(values));
  const kept = text.split("\n").filter((line) => !keys.has(line.slice(0, line.indexOf("="))));
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  for (const [key, value] of Object.entries(values)) kept.push(`${key}=${value}`);
  return `${kept.join("\n")}\n`;
}

export function writeAideConfig(projectDir: string, values: Record<string, string>, source?: string): void {
  const dir = join(projectDir, ".aide");
  const file = join(dir, "config");
  const before = source ?? (existsSync(file) ? readFileSync(file, "utf8") : "");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, aideConfigText(before, values));
}
