// What a group waiting for Archive says on its card: which waits it is in,
// and the message row for each.

import { executionGroupAction, type ExecutionGroup, type ExecutionGroupMemberState } from "../../../queue/execution-groups";
import { t, type Language, type TranslationKey } from "../../../i18n";
import { rowMessage, stepLabel, type MessageVariant } from "../../ui/components";
import { jobsSentence } from "../../ui/components/spec-name.ts";
import { LIST_COLUMNS } from "../specs-list/row-shared.ts";

/** A member as the wait is read off it: its own state, and the folder the
 *  message names it by. */
export interface GroupWaitMember extends ExecutionGroupMemberState {
  specFolder: string;
}

/** One wait a group waiting for Archive is in: the card offers Archive,
 *  a member is still running, or a member's acceptance criteria are not
 *  all ticked. `members` names the members behind the wait. */
export type GroupWait =
  | { kind: "ready" }
  | { kind: "busy"; members: string[] }
  | { kind: "acceptance"; members: string[] };

/** Every wait that holds, in the order the card says them: none unless the
 *  group is waiting for Archive. A group whose card offers Start or Stop is
 *  waiting to run, not for Archive; a group with no members or with every
 *  member archived has no card action at all, and is told to press nothing. */
export function executionGroupWaits(
  group: Pick<ExecutionGroup, "state">,
  members: readonly GroupWaitMember[],
): GroupWait[] {
  if (group.state !== "waiting-acceptance") return [];
  if (members.length === 0 || members.every((member) => member.archived)) return [];
  const action = executionGroupAction(group, members);
  if (action === "archive") return [{ kind: "ready" }];
  if (action !== undefined) return [];
  const named = (holds: (member: GroupWaitMember) => boolean): string[] =>
    members.filter(holds).map((member) => member.specFolder);
  const busy = named((member) => member.busy);
  const open = named((member) => member.acceptanceOpen);
  return [
    ...(busy.length ? [{ kind: "busy" as const, members: busy }] : []),
    ...(open.length ? [{ kind: "acceptance" as const, members: open }] : []),
  ];
}

const WAIT_KEY = {
  ready: "list.groupArchiveReady",
  busy: "list.groupArchiveBusy",
  acceptance: "list.groupArchiveAcceptance",
} as const satisfies Record<GroupWait["kind"], TranslationKey>;

/** A wait the board resolves by itself is plain; one that waits for a
 *  person is amber — the same split `HELD_BACK_INFO_KEYS` makes for a
 *  job's own hold (`messages/jobs/holds.ts`). */
const WAIT_VARIANT: Record<GroupWait["kind"], MessageVariant> = {
  ready: "waiting", busy: "info", acceptance: "waiting",
};

/** The message rows the card draws, one per wait, in the row a spec's own
 *  message sits in. Nothing to say draws nothing at all. The button is
 *  named as the card's own button is labelled, in the page's language. */
export function executionGroupWaitRows(
  group: Pick<ExecutionGroup, "state" | "project">,
  members: readonly GroupWaitMember[],
  lang: Language,
  columns = LIST_COLUMNS,
): string {
  const button = stepLabel("archive", lang);
  return executionGroupWaits(group, members).map((wait) => {
    let box: string;
    if (wait.kind === "ready") {
      box = rowMessage(WAIT_VARIANT.ready, t(lang, WAIT_KEY.ready, { button }));
    } else {
      const named = wait.members.map((folder) => `${group.project}:${folder}`);
      const { text, html } = jobsSentence(lang, WAIT_KEY[wait.kind], { button }, named);
      box = rowMessage(WAIT_VARIANT[wait.kind], text, { html });
    }
    return `<tr class="specnotice"><td colspan="${columns}">${box}</td></tr>`;
  }).join("");
}
