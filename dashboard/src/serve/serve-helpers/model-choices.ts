import type { QueueStore } from "../../queue/queue.ts";
import { modelNamesOf, type NamedModel } from "../../queue/store/model-ids.ts";

/** The models a page may offer, from the config, in the shape every model
 *  picker takes. A Claude alias that has run or been read by a press of Check
 *  also carries `ranAs`: the id its newest run reported or Claude Code named,
 *  so an open picker can say what the alias gives today, and `named`: the
 *  name Claude Code gave it, kept beside the id. A choice named by
 *  its own id, another tool's choice and a stand-in carry none — for those
 *  the name already is the model. */
export function modelChoiceOptions(queue: Pick<QueueStore, "defaults" | "modelIds">): {
  name: string;
  tool?: "claude" | "codex" | "opencode" | "fake-claude";
  ranAs?: string;
  named?: NamedModel;
}[] {
  const names = modelNamesOf(queue.modelIds);
  return Object.entries(queue.defaults.modelChoices ?? {}).map(([name, choice]) => {
    const claude = !choice.tool || choice.tool === "claude";
    const ranAs = claude ? queue.modelIds[name] : undefined;
    const named = claude ? names[name] : undefined;
    return {
      name,
      // Carried so the option can SAY which CLI it starts: two entries
      // that differ only in that would otherwise be two identical-looking
      // names in the same dropdown.
      ...(choice.tool ? { tool: choice.tool } : {}),
      ...(ranAs && ranAs !== name ? { ranAs } : {}),
      // The name Claude Code gave it, which `aliasLabel()` shows while its
      // id is still the one the choice gives.
      ...(named ? { named } : {}),
    };
  });
}
