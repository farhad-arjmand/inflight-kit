import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createFlight } from "../dist/esm/index.js";
let calls = 0;
const reads = createFlight(
  async (key, signal) => {
    calls++;
    await delay(10, undefined, { signal });
    return { id: key };
  },
  { maxDurationMs: 1000 },
);
const controller = new AbortController();
const first = reads.run("tenant-1:user-42", { signal: controller.signal });
const second = reads.run("tenant-1:user-42", { timeoutMs: 1000 });
const results = Promise.allSettled([first, second]);
controller.abort();
const [cancelled, completed] = await results;
assert.equal(cancelled.status, "rejected");
assert.equal(completed.status, "fulfilled");
assert.equal(calls, 1);
assert.equal(reads.size, 0);
console.log("One read; one caller cancelled; the other received its result.");
