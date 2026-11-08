import { describe, expect, test } from "bun:test";
import { cleanupProcesses, type CleanupProcess } from "../../src/serve/process-cleanup";
import { parseHostProcessLine } from "../../src/serve/process-cleanup/host.ts";
import { cleanupTranscriptLine } from "../../src/serve/process-cleanup/job.ts";
import { stepLog } from "../../src/queue/parse-stream";

const now = Date.parse("2026-11-08T12:00:00Z");
const process = (overrides: Partial<CleanupProcess> = {}): CleanupProcess => ({
  pid: 200, ppid: 1, pgid: 200, startedAt: now - 7 * 60 * 60_000,
  command: "bun test", cwd: "/tmp/aide-pytest-example", ...overrides,
});

const run = async (processes: CleanupProcess[], ports: Map<number, number> = new Map(), protectedPids: number[] = []) => {
  const signals: [number, NodeJS.Signals][] = [];
  const alive = new Set(processes.map((p) => p.pid));
  const result = await cleanupProcesses({
    now: () => now, processes: async () => processes, portOwner: async (port) => ports.get(port),
    registeredPids: () => new Set<number>(), protectedPids: () => new Set(protectedPids),
    protectedRoots: () => [], signal: (pid, signal) => { signals.push([pid, signal]); if (signal === "SIGTERM" && pid !== 202) alive.delete(pid); return true; },
    alive: (pid) => alive.has(pid), wait: async () => {}, ports: [8801], graceMs: 1,
  });
  return { result, signals };
};

describe("process cleanup", () => {
  test("keeps the same identity when the process is read at different times (AC-5, AC-6)", () => {
    const line = " 201 1 201 Sun Nov  8 04:00:00 2026 bun test";
    expect(parseHostProcessLine(line, "/tmp/aide-pytest-x")?.startedAt)
      .toBe(parseHostProcessLine(line, "/tmp/aide-pytest-x")?.startedAt);
  });

  test("writes cleanup output as a transcript event the job log reads (AC-9, AC-10)", () => {
    const transcript = cleanupTranscriptLine("Nothing to stop.\n");
    const { logs } = stepLog({ text: transcript, start: 0 }, undefined, { tool: "claude", final: true });
    expect(logs.flatMap((part) => part.lines)).toContain("Nothing to stop.");
  });
  test("stops an unregistered test-port owner and logs its identity (AC-5, AC-9)", async () => {
    const p = process({ pid: 201, command: "bun dashboard/src/index.ts" });
    const { result, signals } = await run([p], new Map([[8801, 201]]));
    expect(signals).toEqual([[201, "SIGTERM"]]);
    expect(result.log).toContain("PID 201");
    expect(result.log).toContain("7h");
    expect(result.log).toContain(p.command);
  });

  test("requires parent, age and a known temporary root for orphan tests (AC-6)", async () => {
    const candidates = [
      process({ pid: 210 }),
      process({ pid: 211, ppid: 2 }),
      process({ pid: 212, startedAt: now - 60_000 }),
      process({ pid: 213, cwd: "/tmp/unrelated" }),
    ];
    const { signals } = await run(candidates);
    expect(signals).toEqual([[210, "SIGTERM"]]);
  });

  test("preserves registered and active process trees and queued worktrees (AC-7)", async () => {
    const signals: number[] = [];
    await cleanupProcesses({
      now: () => now,
      processes: async () => [process({ pid: 220 }), process({ pid: 221, ppid: 220 }), process({ pid: 222, cwd: "/worktrees/aide/733/tmp" }), process({ pid: 224, ppid: 222, cwd: "/tmp/aide-pytest-child" }), process({ pid: 223 })],
      portOwner: async () => undefined, registeredPids: () => new Set([223]), protectedPids: () => new Set([220]),
      protectedRoots: () => ["/worktrees/aide/733"], signal: (pid) => { signals.push(pid); return true; }, alive: () => false,
      wait: async () => {}, ports: [], graceMs: 1,
    });
    expect(signals).toEqual([]);
  });

  test("rechecks identity and kills only a survivor (AC-8)", async () => {
    const first = process({ pid: 202 });
    const changed = process({ pid: 203 });
    let reads = 0;
    const signals: [number, NodeJS.Signals][] = [];
    await cleanupProcesses({
      now: () => now, processes: async () => reads++ === 0 ? [first, changed] : [first, process({ pid: 203, startedAt: changed.startedAt + 1 })],
      portOwner: async () => undefined, registeredPids: () => new Set(), protectedPids: () => new Set(), protectedRoots: () => [],
      signal: (pid, signal) => { signals.push([pid, signal]); return true; }, alive: (pid) => pid === 202, wait: async () => {}, ports: [], graceMs: 1,
    });
    expect(signals).toEqual([[202, "SIGTERM"], [202, "SIGKILL"]]);
  });

  test("writes one empty result line (AC-10)", async () => {
    const { result } = await run([]);
    expect(result.log.trim().split("\n")).toEqual(["Nothing to stop."]);
  });
});
