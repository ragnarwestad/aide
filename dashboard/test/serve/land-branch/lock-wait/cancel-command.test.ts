import { expect, test } from "bun:test";
import { cancelLanding, takeLandingCancel } from "../../../../src/serve/land-branch/cancel-landing.ts";
import { runScript } from "../../../../src/serve/land-branch/run-script.ts";

test("Cancel remains in force between test commands and prevents retries", async () => {
  const id = "cancel-between-commands";
  try {
    expect((await runScript(["/bin/sh", "-c", "exit 0"], "/tmp", 1000, id)).code).toBe(0);
    cancelLanding(id);
    await expect(runScript(["/bin/sh", "-c", "exit 0"], "/tmp", 1000, id)).rejects.toThrow("cancelled");
    await expect(runScript(["/bin/sh", "-c", "exit 0"], "/tmp", 1000, id)).rejects.toThrow("cancelled");
  } finally { takeLandingCancel(id); }
});
