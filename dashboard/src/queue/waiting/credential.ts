import type { Credential } from "./types.ts";

/** What the editor sends to prove it holds the queue: the token, the
 *  generation and the revision, never the entries it was handed. Those
 *  carry every waiting job's label and reason, which a long queue makes
 *  larger than a request may be. */
export function credentialOf(owner: Credential): Credential {
  return { token: owner.token, generation: owner.generation, revision: owner.revision };
}
