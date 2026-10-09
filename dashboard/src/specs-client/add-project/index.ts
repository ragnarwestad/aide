// The Add project form's Test command placeholder: when the Git URL
// changes, the server is asked which test command the repository's root
// files point at, and the answer becomes the field's placeholder. It is a
// suggestion shown in the field and never saved; the field keeps the hint
// it was drawn with whenever there is no command to show.

const TEST_COMMAND_ROUTE = "/api/queue/projects/test-command";

/** The command the server finds for `gitUrl`, or `null` for no answer of
 *  any kind: a refusal, a failed request or a repository it cannot read. */
async function detectedTestCommand(gitUrl: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(TEST_COMMAND_ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ gitUrl }),
    });
    const body = (await res.json().catch(() => null)) as { testCmd?: unknown } | null;
    return res.ok && typeof body?.testCmd === "string" && body.testCmd ? body.testCmd : null;
  } catch {
    return null;
  }
}

/** Binds the Git URL field's `change` to the Test command field's
 *  placeholder. Returns without binding anything when either field is
 *  missing. The listener returns its work, so a test can wait for it. */
export function bindAddProjectForm(form: HTMLFormElement, fetchImpl: typeof fetch = fetch): void {
  const gitUrl = form.querySelector('input[name="gitUrl"]') as HTMLInputElement | null;
  const testCmd = form.querySelector('input[name="testCmd"]') as HTMLInputElement | null;
  if (!gitUrl || !testCmd) return;
  const drawn = testCmd.placeholder;
  gitUrl.addEventListener("change", async () => {
    const address = gitUrl.value.trim();
    testCmd.placeholder = drawn;
    if (!address) return;
    const command = await detectedTestCommand(address, fetchImpl);
    // An answer about an address the field no longer holds is dropped.
    if (command && gitUrl.value.trim() === address) testCmd.placeholder = command;
  });
}
