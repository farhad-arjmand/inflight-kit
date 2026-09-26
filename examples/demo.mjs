import { createServer } from "node:http";
import { once } from "node:events";
import assert from "node:assert/strict";
import { createFlight } from "../dist/esm/index.js";
let requests = 0;
const server = createServer((req, res) => {
  requests++;
  setTimeout(() => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ id: 42, name: "Example" }));
  }, 30);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const url = `http://127.0.0.1:${server.address().port}/users/42`;
const read = async (signal) => {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};
try {
  await Promise.all(Array.from({ length: 100 }, () => read()));
  console.log(`Without coalescing: ${requests} upstream requests`);
  assert.equal(requests, 100);
  requests = 0;
  const flight = createFlight((key, signal) => read(signal));
  const results = await Promise.all(
    Array.from({ length: 100 }, () => flight.run("user:42")),
  );
  console.log(
    `With inflight-kit: ${requests} upstream request for ${results.length} callers`,
  );
  assert.equal(requests, 1);
  assert.ok(results.every((user) => user.id === 42));
} finally {
  server.close();
  server.closeAllConnections();
}
