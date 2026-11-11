import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DESCRIPTION_FILE } from "../spec-names.ts";

const GROUP_LINE = /^[ \t]*-[ \t]*\*\*Group:\*\*[ \t]*(.*)$/m;
const POSITION_LINE = /^[ \t]*-[ \t]*\*\*Group position:\*\*[ \t]*(.*)$/m;
const GROUP_LINE_WITH_BREAK = /^[ \t]*-[ \t]*\*\*Group:\*\*[ \t]*.*(\n|$)/m;
const POSITION_LINE_WITH_BREAK = /^[ \t]*-[ \t]*\*\*Group position:\*\*[ \t]*.*(\n|$)/m;

export interface SpecGroupMembership { name: string; position: number }

export function nextGroupPosition(name: string, groups: Array<SpecGroupMembership | undefined>): number {
  return Math.max(0, ...groups.filter((group) => group?.name === name).map((group) => group!.position)) + 1;
}

export function groupIn(text: string): SpecGroupMembership | undefined {
  const name = text.match(GROUP_LINE)?.[1]?.replace(/`/g, "").trim();
  const rawPosition = text.match(POSITION_LINE)?.[1]?.trim();
  if (!name || !rawPosition || !/^[1-9]\d*$/.test(rawPosition)) return undefined;
  return { name, position: Number(rawPosition) };
}

export function specGroup(dir: string): SpecGroupMembership | undefined {
  const file = join(dir, DESCRIPTION_FILE);
  if (!existsSync(file)) return undefined;
  try { return groupIn(readFileSync(file, "utf-8")); } catch { return undefined; }
}

export function stripGroupLines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(GROUP_LINE_WITH_BREAK, "").replace(POSITION_LINE_WITH_BREAK, "");
}

export function withGroupLines(text: string, group?: SpecGroupMembership): string | null {
  const stripped = stripGroupLines(text);
  if (!group) return stripped;
  const created = stripped.match(/^[ \t]*-[ \t]*\*\*Created:\*\*.*$/m);
  if (!created || !group.name.trim() || !Number.isSafeInteger(group.position) || group.position < 1) return null;
  const at = created.index! + created[0].length;
  const lines = `\n- **Group:** \`${group.name.trim()}\`\n- **Group position:** ${group.position}`;
  return `${stripped.slice(0, at)}${lines}${stripped.slice(at)}`;
}
