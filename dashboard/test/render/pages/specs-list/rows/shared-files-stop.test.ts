// An analyze stopped on shared files says, on its row, the specs its own
// record still names as open — with the job in the queue and without it. The
// sentence itself is proven in job-state/failed-round-sentence.test.ts; this
// proves the row is wired to it.
import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type QueueRowView, type SpecTarget } from "../../../../../src/render";
import type { OpenOverlap } from "../../../../../src/project/overlapping-specs.ts";
import { row } from "../../fixtures.ts";

const FOLDER = "81-queue-and-runner";
const JOBS_SENTENCE = "Analyze stopped: other open specs change the same files — 603-b: x.ts, y.ts.";
const OPEN: OpenOverlap[] = [{ folder: "82-other", label: "82 The other thing", files: ["a.ts"] }];
const NAMED = "82 The other thing: a.ts";

const target = (extra: Partial<SpecTarget> = {}): SpecTarget => ({
  project: "aide",
  specFolder: FOLDER,
  done: ["create"],
  ...extra,
});
const stoppedJob = (): QueueRowView =>
  row({ specFolder: FOLDER, steps: ["analyze"], state: "stopped", stopReason: "shared-files", error: JOBS_SENTENCE });
const notice = (
  rows: QueueRowView[],
  t: SpecTarget,
  overlappingSpecs?: (project: string, folder: string) => OpenOverlap[] | undefined,
): string =>
  renderSpecsRows(rows, { runnerAvailable: true, targets: [t], overlappingSpecs }).match(
    new RegExp(`<tr class="specnotice"[^>]*data-folder="${FOLDER}">[\\s\\S]*?</tr>`),
  )?.[0] ?? "";

describe("a row whose analyze stopped on shared files", () => {
  test("with the job in the queue, it says the record's sentence in place of the job's own (AC-2)", () => {
    const html = notice([stoppedJob()], target({ stopped: { analyze: "shared-files" } }), () => OPEN);
    expect(html).toContain(NAMED);
    expect(html).not.toContain("603-b");
  });

  test("without the job, it says the same sentence from the analyze phase's own history (AC-2)", () => {
    const withJob = notice([stoppedJob()], target({ stopped: { analyze: "shared-files" } }), () => OPEN);
    const withoutJob = notice([], target({ stopped: { analyze: "shared-files" } }), () => OPEN);
    expect(withoutJob).toContain(NAMED);
    expect(withoutJob).toContain("Add them to Depends on to wait until they are archived");
    expect(withoutJob.replace(/<[^>]*>/g, "")).toBe(withJob.replace(/<[^>]*>/g, ""));
  });

  test("the record is asked about the row's own project and folder (AC-2)", () => {
    const asked: string[] = [];
    notice([], target({ stopped: { analyze: "shared-files" } }), (project, folder) => (asked.push(`${project}/${folder}`), OPEN));
    expect(asked).toEqual([`aide/${FOLDER}`]);
  });

  test("a row whose analyze did not stop on shared files does not read the record", () => {
    const asked: string[] = [];
    notice([], target({ stopped: { analyze: "model-refused" } }), (p, f) => (asked.push(p + f), OPEN));
    expect(asked).toEqual([]);
  });

  test("without a reader the job's own sentence stands", () => {
    expect(notice([stoppedJob()], target({ stopped: { analyze: "shared-files" } }))).toContain("603-b");
  });
});
