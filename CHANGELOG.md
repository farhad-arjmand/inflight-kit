# Changelog

## 1.1.0 — 2026-09-27

- Fix retained entries after invalid signal input or failed listener subscription.
- Add optional shared operation deadlines with maxDurationMs.
- Add executable integration recipe, tool-readable reference, Windows CI and formatted source checks.

## 1.0.0 — 2026-09-27

- Typed, keyed sharing of pending asynchronous operations.
- Independent caller abort signals and deadlines.
- Cooperative worker cancellation after the last caller leaves.
- Configurable key and waiter admission limits.
- Explicit cancellation, bulk clearing and live inspection.
- ESM and CommonJS exports with TypeScript declarations.
- Zero runtime dependencies and a real HTTP request-count demo.
