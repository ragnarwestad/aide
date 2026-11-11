import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { groupBranch, specBranch, DESCRIPTION_FILE } from "../spec-names.ts";

const GROUP_LINE = /^[ \t]*-[ \t]*\*\*Group:\*\*[ \t]*(.*)$/m;
const POSITION_LINE = /^[ \t]*-[ \t]*\*\*Group position:\*\*[ \t]*(.*)$/m;
const GROUP_LINE_WITH_BREAK = /^[ \t]*-[ \t]*\*\*Group:\*\*[ \t]*.*(\n|$)/m;
const POSITION_LINE_WITH_BREAK = /^[ \t]*-[ \t]*\*\*Group position:\*\*[ \t]*.*(\n|$)/m;

export interface SpecGroupMembership { name: string; position: number }

export function previousGroupMember<T extends { specFolder: string; group?: SpecGroupMembership }>(
  members: T[], current: T,
): T | undefined {
  if (!current.group) return undefined;
  return members
    .filter((member) => member.group?.name === current.group!.name && member.group.position < current.group!.position)
    .sort((a, b) => b.group!.position - a.group!.position || b.specFolder.localeCompare(a.specFolder))[0];
}

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

/** The branch for a spec directory, using persisted sibling membership. */
export function branchForSpec(dir: string, folder: string): string {
  const current = specGroup(dir);
  if (!current) return specBranch(folder);
  const root = dirname(dir);
  let first: { folder: string; position: number } | undefined;
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "archive") continue;
      const member = specGroup(join(root, entry.name));
      if (member?.name !== current.name) continue;
      if (!first || member.position < first.position || (member.position === first.position && entry.name < first.folder)) {
        first = { folder: entry.name, position: member.position };
      }
    }
  } catch { return specBranch(folder); }
  return first ? groupBranch(first.folder, current.name) : specBranch(folder);
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
