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
  addEventListener(type: string, fn: (e: unknown) => void): void;
  close(): void;
  emit(type: string): void;
}

/** The connection the page keeps open (spec 189), and the constructor
 *  `harness()` injects in its place. Every instance ever constructed is
 *  kept on `made`, closed ones included: what a test about the hidden
 *  tab has to be able to say is that the old one was CLOSED and no new
 *  one was made in its place. */
export function makeFakeEventSource() {
  const made: FakeEventSourceInstance[] = [];
  class FakeEventSource implements FakeEventSourceInstance {
    readonly listeners: Record<string, ((e: unknown) => void)[]> = {};
    closed = false;
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
  }
  /** The one the page is listening on right now, if any. */
  const live = () => made.filter((s) => !s.closed).at(-1) ?? null;
  return { FakeEventSource, made, live };
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
