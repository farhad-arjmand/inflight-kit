import {createFlight, type Flight} from 'inflight-kit';
const flight = createFlight(async (id: string, signal) => { signal.throwIfAborted(); return {id}; });
const typed: Flight<string, {id: string}> = flight;
const result: Promise<{id: string}> = typed.run('hello', {timeoutMs: 100});
// @ts-expect-error keys must match the worker
flight.run(123);
// @ts-expect-error result type is inferred from the worker
const wrong: Promise<number> = flight.run('hello');
void result; void wrong;
