# Integrating inflight-kit

Use `inflight-kit` when independent callers overlap on the same expensive read and need separate cancellation lifetimes. Examples: dashboard components reading the same resource, one-process cache fills, and refresh calls within one authenticated session.

It is not a persistent cache, a cross-process lock, a rate limiter or an exactly-once write mechanism. Prefer existing framework query caching if that already owns these requirements.

## Server-side coalescing

Create one flight instance per resource type, outside individual request handlers. Include the authorization boundary in the key. Do not include raw access tokens.

```ts
import { createFlight } from "inflight-kit";

const reads = createFlight(
  async (key: string, signal) => {
    const [tenantId, userId] = JSON.parse(key) as [string, string];
    const response = await fetch(
      `https://api.example.com/tenants/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(userId)}`,
      { signal },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json(); // Validate the response shape in your application.
  },
  { maxKeys: 500, maxWaitersPerKey: 100, maxDurationMs: 10000 },
);

// After your application has authorized this tenant/user read:
const result = await reads.run(JSON.stringify([tenantId, userId]), {
  signal: request.signal,
  timeoutMs: 3000,
});
```

A departing request cannot abort remaining callers. The shared 10-second deadline starts with the first caller and is not extended by later callers. A 3-second caller deadline only stops that caller. Pass the **worker's** signal to fetch, rather than capturing the first request's signal.

## Review checklist

- Keys separate tenants, user permissions and all parameters affecting the result.
- Share parsed immutable data, not a single-use `Response` body.
- Handle `CapacityError`, caller abort and `TimeoutError` explicitly where appropriate.
- Do not recursively await the same flight/key from its worker.
- Reuse the instance; constructing one per request prevents coalescing.
- A worker ignoring cancellation can remain physically active after tracked callers leave.

`examples/integration.mjs` is an offline executable cancellation-lifetime example. `examples/demo.mjs` uses a real local HTTP server to demonstrate reduced request count.

## Upgrade 1.0.0 → 1.1.0

Existing typed calls retain their behavior. `maxDurationMs` is optional. Invalid signal objects now reject without retaining a dead entry. Replace signal-like placeholders with real `AbortSignal` objects; they were never supported inputs.
