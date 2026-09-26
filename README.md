<div align="center">

# inflight-kit

**Share the work. Keep your own cancel button.**

[![npm version](https://img.shields.io/npm/v/inflight-kit.svg)](https://www.npmjs.com/package/inflight-kit)
[![CI](https://github.com/farhad-arjmand/inflight-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/farhad-arjmand/inflight-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

One pending operation per key. Independent cancellation and deadlines for every caller.

Zero runtime dependencies · TypeScript · ESM + CommonJS · Node.js 20+

</div>

```sh
npm install inflight-kit
```

## Integration recipes and tool-readable reference

See [integration recipes](https://github.com/farhad-arjmand/inflight-kit/blob/main/docs/integration.md) for runnable patterns and selection criteria, [release notes](https://github.com/farhad-arjmand/inflight-kit/blob/main/CHANGELOG.md) for changes, and [llms.txt](https://github.com/farhad-arjmand/inflight-kit/blob/main/llms.txt) for a compact API index. The reference is ordinary documentation for developers and coding assistants; it does not require or guarantee automatic recommendations.

## The problem

Three components ask for the same user. Three requests hit your API. You share a promise to fix it—then one component unmounts and aborts the request for everyone.

`inflight-kit` gives each caller its own promise, signal and deadline, while sharing one underlying operation. The worker receives a separate signal that aborts only when the last caller leaves (or you explicitly cancel the key).

```text
Caller A ── run("user:42") ─┐
Caller B ── run("user:42") ─┼── ONE worker ── API
Caller C ── run("user:42") ─┘

A cancels → A rejects; B and C still receive the result.
All cancel → the worker's signal aborts.
Done → the key is removed. The next call starts fresh.
```

## Start here

```ts
import { createFlight } from "inflight-kit";

type User = { id: string; name: string };

// Keep this instance outside the function that calls it.
const users = createFlight(async (id: string, signal): Promise<User> => {
  const response = await fetch(`/api/users/${encodeURIComponent(id)}`, {
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json(); // Validate untrusted data here if your app needs it.
});

const controller = new AbortController();
const first = users.run("42", { signal: controller.signal });
const second = users.run("42", { timeoutMs: 3000 });

// Attach handlers before cancellation, as with any promise.
const results = Promise.allSettled([first, second]);
controller.abort();
console.log(await results); // first rejects; second can still succeed
```

**Parse responses inside the worker.** A shared `Response` has a single-use body. Share the parsed value instead, and treat shared objects as immutable.

## Useful places to use it

- Coalesce repeated profile, settings or metadata reads across components.
- Collapse a burst of cache misses for one key into a single database lookup.
- Share an expensive computation while each caller keeps its own deadline.
- Deduplicate token refresh calls **within the same authenticated session**.

This is in-process coordination. Multiple server processes need a distributed solution if they must coordinate with one another.

## API

### `createFlight(worker, options?)`

The worker is `(key, sharedSignal) => value | PromiseLike<value>`. Key and result types are inferred from it. Synchronous throws and asynchronous rejections reach every remaining caller. Work begins in a microtask so same-turn calls can join before execution.

| Option             | Default | Meaning                                                                                  |
| ------------------ | ------- | ---------------------------------------------------------------------------------------- |
| `maxDurationMs`    | none    | Shared deadline from entry creation; rejects all remaining callers and aborts the worker |
| `maxKeys`          | `1024`  | Maximum currently tracked keys                                                           |
| `maxWaitersPerKey` | `1024`  | Maximum callers waiting on one key                                                       |

Admission limits are positive safe integers. `maxDurationMs` is an integer from 1 to 2147483647; later callers do not reset it. Expiry uses `TimeoutError`. Like caller deadlines, it requests cooperative cancellation and cannot interrupt synchronous blocking code. Excess callers reject with `CapacityError` and its `limit` field. There is no hidden queue. Existing keys can still accept callers when `maxKeys` is reached, up to their own waiter limit.

### `flight.run(key, { signal?, timeoutMs? }?)`

Returns a separate `Promise<V>` for each caller. Same-key calls share the worker while it is pending. `timeoutMs` is a per-caller deadline, an integer between `1` and `2147483647`. Deadline expiry rejects with a `DOMException` named `TimeoutError`; abort preserves `signal.reason`. An already-aborted caller never starts or joins work.

A deadline uses the runtime's timer: it cannot interrupt blocking synchronous JavaScript. Handle returned promises to avoid unhandled rejections.

### Control and inspection

```ts
users.size; // number of tracked keys
users.has("42"); // is this key pending?
users.waiters("42"); // number of callers still waiting
users.cancel("42"); // reject callers, abort worker, remove key; returns boolean
users.clear(); // cancel a snapshot of all currently tracked keys
```

`cancel(key, reason?)` and `clear(reason?)` accept a custom rejection reason. They default to an `AbortError`. A new call may immediately start a replacement operation. Late results from old work cannot delete or settle that replacement.

## Boundaries that matter

- **Keys are your isolation boundary.** Include tenant, user, permission scope and relevant parameters. Do not share a key between different authorization contexts. Avoid putting secrets directly in keys.
- **Map semantics apply.** Strings compare by value; object keys compare by identity. There is no implicit JSON serialization or hashing.
- **No settled cache, retries or rate limiting.** Once work settles, its key is removed. Use your existing cache around the worker if you need cached values.
- **Cancellation is cooperative.** Pass the worker's signal to `fetch` or another cancellation-aware operation. Ignoring it can leave physical work running after its key is removed. Admission limits bound tracked work, not uncancellable operations.
- **Reads and safe computations are the intended use.** Deduplicating writes can suppress actions that were meant to happen separately.
- **Do not recursively await the same flight/key inside its worker.** That would wait on itself.
- Runtime uses standard `Map`, `Promise`, `AbortController`, `DOMException` and timers. Node.js 20/22/24 are tested in CI; modern browser ESM is smoke-tested separately during development. No Node-specific runtime imports.

## Why another async utility?

The focus is a small combination: keyed pending-work sharing, **independent caller lifetimes**, cooperative last-caller cancellation, and bounded admission. If you need a query cache, use a query cache. If you need a concurrency queue or distributed lock, use one. This package deliberately keeps a single typed worker per instance so callers cannot accidentally associate incompatible result types with the same key.

The singleflight pattern predates this project; see [Go's singleflight](https://pkg.go.dev/golang.org/x/sync/singleflight) and the cancellation-aware [janos/singleflight](https://github.com/janos/singleflight). This JavaScript implementation is independent.

## Run the demo and tests

```sh
git clone https://github.com/farhad-arjmand/inflight-kit.git
cd inflight-kit
npm ci
npm run demo
npm run check
```

The local demo starts a real HTTP server and compares 100 direct requests with 100 coalesced callers. It measures upstream request count, not a performance speedup claim.

See [contributing](https://github.com/farhad-arjmand/inflight-kit/blob/main/CONTRIBUTING.md), [security](https://github.com/farhad-arjmand/inflight-kit/blob/main/SECURITY.md) and [changelog](https://github.com/farhad-arjmand/inflight-kit/blob/main/CHANGELOG.md).

## License

MIT © Farhad Arjmand
