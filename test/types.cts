import {createFlight} from 'inflight-kit';
const f = createFlight((key: number) => key.toString());
const result: Promise<string> = f.run(42);
void result;
