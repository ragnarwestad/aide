import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { groupIn, nextGroupPosition, previousGroupMember, stripGroupLines, withGroupLines } from "../../../src/project/discover";
import { branchForSpec, specGroup, type GroupFirsts } from "../../../src/project/discover/group.ts";
import { DESCRIPTION_FILE, groupBranch, specBranch } from "../../../src/project/spec-names.ts";

const description = (lines = "") =>
  `# X\n\n## Tracking info\n\n- **Task:** \`1-x/\`\n- **Created:** \`2026-11-11\`\n${lines ? `${lines}\n` : ""}\n---\n`;

describe("spec group metadata", () => {
  test("reads only the existing membership pair without a parent document shape (A757 AC-3, AC-17)", () => {
    expect(groupIn(description("- **Group:** `Release`\n- **Group position:** 2"))).toEqual({ name: "Release", position: 2 });
    expect(groupIn(description("- **Group:** `Release`"))).toBeUndefined();
    expect(groupIn(description("- **Group:** `Release`\n- **Group position:** 0"))).toBeUndefined();
  });

  test("writes, replaces and removes the pair atomically (A757 AC-3)", () => {
    const written = withGroupLines(description(), { name: "Release", position: 1 });
    expect(groupIn(written!)).toEqual({ name: "Release", position: 1 });
    expect(withGroupLines(written!, undefined)).toBe(description());
    expect(stripGroupLines(written!)).toBe(description());
  });

  test("appends after the highest resolved member when another checkout is stale (A757 AC-2, A757 AC-3)", () => {
    const staleCheckout = [undefined, { name: "Another", position: 4 }];
    const branchFirst = [{ name: "Release", position: 1 }];
    expect(nextGroupPosition("Release", [...staleCheckout, ...branchFirst])).toBe(2);
  });

  test("the member immediately before the requested one is the start gate (AC-3)", () => {
    const members = [
      { specFolder: "1-first", group: { name: "Release", position: 1 }, done: ["implement"] },
      { specFolder: "2-second", group: { name: "Release", position: 2 }, done: [] },
      { specFolder: "3-third", group: { name: "Release", position: 3 }, done: [] },
    ];
    expect(previousGroupMember(members, members[2]!)).toBe(members[1]);
  });
});

describe("a spec's branch from its folder's group members", () => {
  const folderWith = (members: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), "group-branch-"));
    for (const [folder, lines] of Object.entries(members)) {
      mkdirSync(join(root, folder));
      writeFileSync(join(root, folder, DESCRIPTION_FILE), description(lines));
    }
    return root;
  };
  const member = (name: string, position: number) => `- **Group:** \`${name}\`\n- **Group position:** ${position}`;

  test("every member takes the first member's group branch, one listing shared across them", () => {
    const root = folderWith({ "7-second": member("Release", 2), "5-first": member("Release", 1), "9-alone": "" });
    const byRoot = new Map<string, GroupFirsts>();
    expect(branchForSpec(join(root, "7-second"), "7-second", byRoot)).toBe(groupBranch("5-first", "Release"));
    expect(branchForSpec(join(root, "5-first"), "5-first", byRoot)).toBe(groupBranch("5-first", "Release"));
    expect(branchForSpec(join(root, "9-alone"), "9-alone", byRoot)).toBe(specBranch("9-alone"));
  });

  test("a description changed on disk is read again", () => {
    const root = folderWith({ "3-x": member("Release", 1) });
    expect(specGroup(join(root, "3-x"))).toEqual({ name: "Release", position: 1 });
    writeFileSync(join(root, "3-x", DESCRIPTION_FILE), description(member("Release candidate", 4)));
    expect(specGroup(join(root, "3-x"))).toEqual({ name: "Release candidate", position: 4 });
    unlinkSync(join(root, "3-x", DESCRIPTION_FILE));
    expect(specGroup(join(root, "3-x"))).toBeUndefined();
  });
});
