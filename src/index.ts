/** A caller was refused because the configured admission limit was reached. */
export class CapacityError extends Error {
  override readonly name = 'CapacityError';
  constructor(readonly limit: 'maxKeys' | 'maxWaitersPerKey') {
    super(`inflight-kit: ${limit} reached`);
  }
}
export interface FlightOptions {
  /** Maximum tracked keys. Default: 1024. */
  maxKeys?: number;
  /** Maximum simultaneous callers for one key. Default: 1024. */
  maxWaitersPerKey?: number;
}
export interface RunOptions {
  /** Cancels only this caller, unless it is the last caller. */
  signal?: AbortSignal;
  /** Per-caller deadline, in milliseconds (1 to 2147483647). */
  timeoutMs?: number;
}
export interface Flight<K, V> {
  run(key: K, options?: RunOptions): Promise<V>;
  /** Tracked keys, not physical operations that ignore cancellation. */
  readonly size: number;
  has(key: K): boolean;
  waiters(key: K): number;
  /** Reject current callers and request cooperative cancellation. */
  cancel(key: K, reason?: unknown): boolean;
  /** Cancel a snapshot of all currently tracked keys. */
  clear(reason?: unknown): void;
}
type Waiter<V> = { resolve(value: V): void; reject(reason: unknown): void; cleanup(): void };
type Entry<V> = { controller: AbortController; waiters: Set<Waiter<V>>; done: boolean };
const aborted = () => new DOMException('The operation was aborted', 'AbortError');
function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}
/** One worker per key while callers are waiting. Results and failures are never cached. */
export function createFlight<K, V>(
  worker: (key: K, signal: AbortSignal) => V | PromiseLike<V>,
  options: FlightOptions = {},
): Flight<K, V> {
  if (typeof worker !== 'function') throw new TypeError('worker must be a function');
  const maxKeys = positive(options.maxKeys ?? 1024, 'maxKeys');
  const maxWaiters = positive(options.maxWaitersPerKey ?? 1024, 'maxWaitersPerKey');
  const entries = new Map<K, Entry<V>>();
  function detach(key: K, entry: Entry<V>): void {
    entry.done = true;
    if (entries.get(key) === entry) entries.delete(key);
  }
  function finish(key: K, entry: Entry<V>, ok: boolean, value: unknown): void {
    if (entry.done) return;
    detach(key, entry);
    for (const waiter of entry.waiters) {
      waiter.cleanup();
      if (ok) waiter.resolve(value as V); else waiter.reject(value);
    }
    entry.waiters.clear();
  }
  function cancelEntry(key: K, entry: Entry<V>, reason: unknown): void {
    finish(key, entry, false, reason);
    entry.controller.abort(reason);
  }
  return {
    get size() { return entries.size; },
    has: key => entries.has(key),
    waiters: key => entries.get(key)?.waiters.size ?? 0,
    cancel(key, reason = aborted()) {
      const entry = entries.get(key);
      if (!entry) return false;
      cancelEntry(key, entry, reason);
      return true;
    },
    clear(reason = aborted()) {
      for (const [key, entry] of [...entries]) cancelEntry(key, entry, reason);
    },
    run(key, runOptions = {}) {
      // Reject invalid run options through the returned promise, like worker errors.
      return new Promise<V>((resolve, reject) => {
        const { signal, timeoutMs } = runOptions;
        if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647)) {
          throw new RangeError('timeoutMs must be an integer from 1 to 2147483647');
        }
        if (signal?.aborted) { reject(signal.reason); return; }
        let entry = entries.get(key);
        const fresh = !entry;
        if (!entry) {
          if (entries.size >= maxKeys) { reject(new CapacityError('maxKeys')); return; }
          entry = { controller: new AbortController(), waiters: new Set(), done: false };
          entries.set(key, entry);
        }
        if (entry.waiters.size >= maxWaiters) { reject(new CapacityError('maxWaitersPerKey')); return; }
        const current = entry;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const leave = (reason: unknown) => {
          if (!current.waiters.delete(waiter)) return;
          waiter.cleanup();
          reject(reason);
          if (!current.done && current.waiters.size === 0) {
            detach(key, current);
            current.controller.abort(reason);
          }
        };
        const onAbort = () => leave(signal!.reason);
        const waiter: Waiter<V> = {
          resolve, reject,
          cleanup() {
            if (timer !== undefined) clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
          },
        };
        current.waiters.add(waiter);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (timeoutMs !== undefined) timer = setTimeout(() => leave(new DOMException('The caller deadline expired', 'TimeoutError')), timeoutMs);
        if (fresh) {
          // Defer the worker so callers in the same turn can join or cancel first.
          void Promise.resolve().then(() => {
            if (current.done) return;
            return worker(key, current.controller.signal);
          }).then(value => finish(key, current, true, value), error => finish(key, current, false, error));
        }
      });
    },
  };
}
