// The usage limits a provider reported, as `aide-run-spec` read them.

/** One usage window a provider reported: its name (`five_hour`,
 *  `seven_day`, or `<n>_minutes`), how much of it is spent, and when it
 *  starts over. */
export interface ProviderLimitWindow {
  name: string;
  usedPercent: number;
  resetsAt?: string;
}

/** The usage limit that stopped a step, as `aide-run-spec` read it from
 *  the tool itself (`lib/run-spec/turn/provider-limit.sh`) — never from the
 *  model, which is spent by then. `window` is the one that ran out;
 *  `plan` and `credit` are there only when the tool said them. */
export interface ProviderLimit {
  tool: string;
  window: string;
  resetsAt?: string;
  windows?: ProviderLimitWindow[];
  plan?: string;
  credit?: string;
}
