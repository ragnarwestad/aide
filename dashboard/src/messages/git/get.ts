import type { BoardMessage } from "../types.ts";
import type { GitError } from "../../format/git-error.ts";

/** Why a push failed, as the board's sentence: what happened, then what
 *  to do. A repo's and a branch's name are the caller's, around it. */
export function getGitPushMessage(error: GitError): BoardMessage {
  switch (error.kind) {
    case "auth":
      return { key: "git.pushAuth" };
    case "github":
      return { key: "git.pushGitHub" };
    case "network":
      return { key: "git.pushNetwork", values: { cause: error.message } };
    case "no-write":
      return { key: "git.pushNoWrite", values: { cause: error.message } };
    case "https-auth":
      return { key: "git.pushHttpsAuth", values: { cause: error.message } };
    case "refused":
      return { key: "git.pushRefused", values: { cause: error.message } };
    case "other":
      return { key: "git.pushOther", values: { cause: error.message } };
    case "none":
      return { key: "git.pushNoText" };
  }
}

/** Why a fetch of the base failed: the same sentence as a push for a key
 *  GitHub does not take or an error at GitHub, and otherwise git's words
 *  with the advice to fetch by hand rather than to push. */
export function getGitFetchMessage(error: GitError): BoardMessage {
  switch (error.kind) {
    case "auth":
    case "github":
    case "network":
    case "no-write":
    case "https-auth":
      return getGitPushMessage(error);
    case "refused":
    case "other":
      return { key: "git.fetchOther", values: { cause: error.message } };
    case "none":
      return { key: "git.fetchNoText" };
  }
}

