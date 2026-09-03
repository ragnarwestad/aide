// The fake browser globals `harness()` injects into the bundled script
// — FormData, EventSource, and the interval/Date plumbing around them —
// extracted out of fixtures.ts. Each is built fresh per harness() call
// via a factory rather than a shared class, so `FakeEventSource.made`
// never leaks between tests.

/** The form serializer the browser owns. Injected rather than reached
 *  for as a global, because a fake form is not an HTMLFormElement and
 *  the real constructor refuses it. */
export function makeFakeFormData() {
  return class FakeFormData {
    constructor(private readonly f: { fields?: [string, string][] }) {}
    forEach(fn: (value: string, key: string) => void): void {
      for (const [k, v] of this.f.fields ?? []) fn(v, k);
    }
  };
}

export interface FakeEventSourceInstance {
  readonly url: string;
  readonly listeners: Record<string, ((e: unknown) => void)[]>;
  closed: boolean;
  readyState: number;
  addEventListener(type: string, fn: (e: unknown) => void): void;
  close(): void;
  emit(type: string): void;
  /** What the browser does on a non-200 answer (spec 368): the source is
   *  a "fail the connection" case per the WHATWG spec, never coming back
   *  on its own — `readyState` goes to CLOSED and `error` fires once. */
  fail(): void;
}

/** The connection the page keeps open (spec 189), and the constructor
 *  `harness()` injects in its place. Every instance ever constructed is
 *  kept on `made`, closed ones included: what a test about the hidden
 *  tab has to be able to say is that the old one was CLOSED and no new
 *  one was made in its place. */
export function makeFakeEventSource() {
  const made: FakeEventSourceInstance[] = [];
  class FakeEventSource implements FakeEventSourceInstance {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    readonly listeners: Record<string, ((e: unknown) => void)[]> = {};
    closed = false;
    readyState = FakeEventSource.CONNECTING;
    constructor(readonly url: string) {
      made.push(this);
    }
    addEventListener(type: string, fn: (e: unknown) => void): void {
      (this.listeners[type] ??= []).push(fn);
    }
    close(): void {
      this.closed = true;
    }
    /** What the browser would deliver. Synchronous, so a test says what
     *  happened next without waiting on a real socket. */
    emit(type: string): void {
      for (const fn of this.listeners[type] ?? []) fn({ type });
    }
    fail(): void {
      this.readyState = FakeEventSource.CLOSED;
      this.closed = true;
      this.emit("error");
    }
  }
  /** The one the page is listening on right now, if any. */
  const live = () => made.filter((s) => !s.closed).at(-1) ?? null;
  return { FakeEventSource, made, live };
}

/** One timer the page scheduled, and whether it was cancelled before it
 *  fired — the fake `clearTimeout` marks it rather than removing it, so
 *  a test can tell "never scheduled" from "scheduled, then dropped". */
export interface FakeTimeout {
  readonly delayMs: number;
  readonly fn: () => void;
  cancelled: boolean;
}

/** `setTimeout`/`clearTimeout` for the reconnect backoff (spec 368): a
 *  growing wait has to be advanced deterministically by a test, not
 *  waited out for real, the same reason the harness already fakes
 *  `setInterval` rather than using the real one. */
export function makeFakeTimers() {
  const timeouts: FakeTimeout[] = [];
  let nextId = 1;
  const ids = new Map<number, FakeTimeout>();
  const setTimeout_ = (fn: () => void, delayMs: number): number => {
    const timeout: FakeTimeout = { delayMs, fn, cancelled: false };
    timeouts.push(timeout);
    const id = nextId++;
    ids.set(id, timeout);
    return id;
  };
  const clearTimeout_ = (id: number): void => {
    const timeout = ids.get(id);
    if (timeout) timeout.cancelled = true;
  };
  return { timeouts, setTimeout: setTimeout_, clearTimeout: clearTimeout_ };
}

/** The wall clock the page reads, so a tick's answer is a stated fact
 *  rather than whatever the machine's own clock said. `Date` is a
 *  global in the browser, which is exactly what makes it injectable
 *  here — the same trick `EventSource` and `FormData` already use. */
export function makeFakeDate() {
  const clock = { at: Date.parse("2026-08-23T12:00:00Z") };
  const FakeDate = { now: () => clock.at, parse: (iso: string) => Date.parse(iso) };
  return { clock, FakeDate };
}
