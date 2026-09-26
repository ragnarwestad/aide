// The push notification for a spec that needs a person (spec 501): an
// observer on the queue store's change hook, the subscriptions it sends
// to, and the delivery. It reads the store, never writes to it, and
// never holds a job up — a push that cannot be sent is logged and gone.
//
// The observer compares each job's state with the one it saw last time,
// so it has to be primed with what the store already holds before the
// runner reconciles the jobs a restart left `running`: without that, every
// job that failed last week would announce itself at boot.

import { stepButton, stepLabel } from "../format/step-label.ts";
import type { Language } from "../i18n";
import { renderMessage, renderSentence } from "../i18n/message.ts";
import type { Job } from "../queue/queue.ts";
import { schedulePagePath } from "../render/pages/schedule-page";
import { specPagePath } from "../render/pages/spec-page";
import { createFailedCreates, failedCreateFrom, type FailedCreates } from "./failed-creates.ts";
import { attentionFor, messageKeyFor, seenOf, type Attention, type Seen } from "./attention.ts";
import { scheduleNameOf, type ScheduleNotify } from "../queue/schedule.ts";
import { sendPush } from "./send.ts";
import { parseSubscribe, readSubscriptions, writeSubscriptions, type Subscription } from "./subscriptions.ts";
import { loadOrCreateKeys } from "./vapid.ts";

export interface PushOptions {
  /** Read lazily: the store is built after this, with this on its hook. */
  jobs: () => Job[];
  /** Where subscriptions are kept. Absent keeps them in memory only. */
  subscriptionsPath?: string;
  /** Where the server's key pair is kept. Absent keeps it in memory only. */
  keyPath?: string;
  /** Where the failed creates are kept (spec 506). Absent keeps them in memory only. */
  failedCreatesPath?: string;
  /** A scheduled job's own choice of when to notify, by project and tracking key; null when its entry is gone. Absent sends none. */
  scheduleNotify?: (project: string, key: string) => ScheduleNotify | null;
  /** Tells the open pages something changed that the queue did not announce: a dismissed message. */
  notify?: () => void;
  /** The outgoing request; a test replaces it so nothing leaves the machine. */
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

export interface Push {
  /** Look at every job now; send for those that just began to need a person. */
  observe(): void;
  /** Record what the store holds, sending nothing. */
  prime(): void;
  /** The creates that ended without a spec, recorded before their push is sent. */
  failedCreates: FailedCreates;
  /** The server's public key, base64url — what a device subscribes with. */
  publicKey(): Promise<string>;
  subscribe(body: unknown, origin: string): Promise<{ ok: true } | { ok: false; error: string }>;
  unsubscribe(body: unknown): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Resolves once every send started so far has settled. A test seam. */
  idle(): Promise<void>;
}

/** Enough of an endpoint to find a device in the log, not enough to send to it. */
/** A push body over about 4 KB is refused by the push service. */
const BODY_MAX = 500;

/** The three fields of a push, by kind: a failed create names its title and opens the form again. */
function payloadFor(a: Attention, job: Job, lang: Language): { title: string; body: string; url: string } {
  if (a.kind === "create-failed") {
    const r = failedCreateFrom(job);
    const body = renderMessage(lang, { key: messageKeyFor(a), values: { reason: renderSentence(lang, r.reason) ?? "" } });
    return {
      title: `${r.project} · ${r.title}`,
      body: body.length > BODY_MAX ? `${body.slice(0, BODY_MAX - 1)}…` : body,
      url: `/new?retry=${encodeURIComponent(r.id)}`,
    };
  }
  if (a.kind === "schedule-run") {
    const name = scheduleNameOf(job.specFolder);
    return {
      title: `${job.project} · ${name}`,
      body: renderMessage(lang, { key: messageKeyFor(a) }),
      url: schedulePagePath(job.project, name),
    };
  }
  const values = { step: stepLabel(a.step, lang), button: stepButton(a.step) };
  return {
    title: `${job.project} · ${job.specFolder}`,
    body: renderMessage(lang, { key: messageKeyFor(a), values }),
    url: specPagePath(job.project, job.specFolder),
  };
}

const where = (endpoint: string): string => `${new URL(endpoint).origin}/…${endpoint.slice(-12)}`;

export function createPush(opts: PushOptions): Push {
  const send = opts.fetch ?? fetch;
  const log = opts.log ?? ((line: string) => console.error(line));
  const seen = new Map<string, Seen>();
  const pending = new Set<Promise<void>>();
  const keys = loadOrCreateKeys(opts.keyPath);
  const failedCreates = createFailedCreates(opts.failedCreatesPath);
  const store: FailedCreates = { ...failedCreates, dismiss: (id) => {
    const found = failedCreates.dismiss(id);
    if (found) opts.notify?.();
    return found;
  } };
  let memory: Subscription[] = [];
  // Reads and writes of the subscriptions run one after another.
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const run = chain.then(work, work);
    chain = run.catch(() => {});
    return run;
  };

  const load = async (): Promise<Subscription[]> =>
    opts.subscriptionsPath ? readSubscriptions(opts.subscriptionsPath, (await keys).publicKey) : memory;
  const save = (subs: Subscription[]): void => {
    if (opts.subscriptionsPath) writeSubscriptions(opts.subscriptionsPath, subs);
    else memory = subs;
  };
  const remove = (endpoint: string) =>
    exclusive(async () => {
      const subs = await load();
      if (subs.some((s) => s.endpoint === endpoint)) save(subs.filter((s) => s.endpoint !== endpoint));
    });

  async function deliver(a: Attention, job: Job): Promise<void> {
    const subs = await exclusive(load);
    const vapid = await keys;
    await Promise.all(
      subs.map(async (sub) => {
        const payload = JSON.stringify(payloadFor(a, job, sub.lang));
        const outcome = await sendPush(sub, payload, vapid, send);
        if ("error" in outcome) return log(`push: ${where(sub.endpoint)} could not be reached — ${outcome.error}`);
        if (outcome.status >= 200 && outcome.status < 300) return;
        // The push service says this device is gone for good.
        if (outcome.status === 404 || outcome.status === 410) return void (await remove(sub.endpoint));
        // Anything else may be this server's own fault (a rejected `sub`,
        // a bad token): keep the device, say what the service said.
        log(`push: ${where(sub.endpoint)} answered ${outcome.status} ${outcome.detail}`.trim());
      }),
    );
  }

  const start = (a: Attention, job: Job): void => {
    const p = deliver(a, job).catch((e) => log(`push: delivery failed — ${e instanceof Error ? e.message : String(e)}`));
    pending.add(p);
    void p.finally(() => pending.delete(p));
  };

  return {
    observe() {
      const jobs = opts.jobs();
      const live = new Set<string>();
      for (const job of jobs) {
        live.add(job.id);
        const a = attentionFor(seen.get(job.id), job, () => opts.scheduleNotify?.(job.project, job.specFolder) ?? null);
        seen.set(job.id, seenOf(job));
        if (a?.kind === "create-failed") failedCreates.add(failedCreateFrom(job));
        if (a) start(a, job);
      }
      // A job the store has dropped must not keep its snapshot.
      for (const id of seen.keys()) if (!live.has(id)) seen.delete(id);
    },
    prime() {
      seen.clear();
      for (const job of opts.jobs()) seen.set(job.id, seenOf(job));
    },
    failedCreates: store,
    publicKey: async () => (await keys).publicKey,
    async subscribe(body, origin) {
      const parsed = parseSubscribe(body, origin);
      if (!parsed.ok) return parsed;
      const key = (await keys).publicKey;
      await exclusive(async () => {
        const subs = (await load()).filter((s) => s.endpoint !== parsed.sub.endpoint);
        save([...subs, { ...parsed.sub, key }]);
      });
      return { ok: true };
    },
    async unsubscribe(body) {
      const endpoint = (body as { endpoint?: unknown } | null)?.endpoint;
      if (typeof endpoint !== "string" || !endpoint) return { ok: false, error: "no endpoint" };
      await remove(endpoint);
      return { ok: true };
    },
    async idle() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}
