import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createRequire } from 'node:module';
import { createFlight, CapacityError } from '../dist/esm/index.js';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
test('1000 concurrent callers share one operation; next call runs fresh', async () => {
  let calls=0; const f=createFlight(() => ++calls);
  assert.deepEqual(await Promise.all(Array.from({length:1000}, () => f.run('x'))), Array(1000).fill(1));
  assert.equal(f.size,0); assert.equal(await f.run('x'),2);
});
test('different keys do not share work; Map identity is preserved', async () => {
  const f=createFlight(k=>k); const a={},b={};
  assert.deepEqual(await Promise.all([f.run(a),f.run(b),f.run(NaN)]),[a,b,NaN]);
});
test('worker error fans out and is not cached', async () => {
  const error=new Error('failed'); let count=0; const f=createFlight(()=>{ if(++count===1) throw error; return 7; });
  const result=await Promise.allSettled([f.run('x'),f.run('x')]);
  assert.ok(result.every(r=>r.status==='rejected'&&r.reason===error));
  assert.equal(await f.run('x'),7);
});
test('async failures fan out', async () => {
  const f=createFlight(async()=>{throw new Error('async');});
  await assert.rejects(f.run(1),/async/); assert.equal(f.size,0);
});
test('one caller abort does not cancel other callers', async () => {
  const d=deferred(); let shared; const f=createFlight((_,s)=>{shared=s;return d.promise;});
  const a=new AbortController(); const p=f.run('x',{signal:a.signal}); const q=f.run('x');
  await tick(); const error=new Error('gone'); a.abort(error);
  await assert.rejects(p,e=>e===error); assert.equal(shared.aborted,false); assert.equal(f.waiters('x'),1);
  d.resolve(9); assert.equal(await q,9);
});
test('last caller leaving cancels shared operation and removes listeners', async () => {
  let shared; const f=createFlight((_,s)=>{shared=s;return new Promise(()=>{});});
  const a=new AbortController(),b=new AbortController();
  const p=f.run('x',{signal:a.signal}),q=f.run('x',{signal:b.signal});
  const settled=Promise.allSettled([p,q]); await tick(); a.abort(); b.abort(); await settled;
  assert.equal(shared.aborted,true); assert.equal(f.size,0);
  assert.equal(getEventListeners(a.signal,'abort').length,0); assert.equal(getEventListeners(b.signal,'abort').length,0);
});
test('pre-aborted callers never start or join work', async () => {
  let calls=0; const f=createFlight(()=>++calls); const a=new AbortController(); a.abort('stop');
  await assert.rejects(f.run('x',{signal:a.signal}),e=>e==='stop'); assert.equal(calls,0); assert.equal(f.size,0);
});
test('cancel before worker starts suppresses execution', async () => {
  let calls=0; const f=createFlight(()=>++calls); const p=f.run(1); f.cancel(1);
  await assert.rejects(p,{name:'AbortError'}); assert.equal(calls,0);
});
test('a caller deadline leaves other callers alive', async () => {
  const d=deferred(); const f=createFlight(()=>d.promise); const a=f.run('x',{timeoutMs:5}),b=f.run('x');
  await assert.rejects(a,{name:'TimeoutError'}); assert.equal(f.waiters('x'),1); d.resolve(4); assert.equal(await b,4);
});
test('last deadline aborts the worker', async () => {
  let signal; const f=createFlight((_,s)=>{signal=s;return new Promise(()=>{});});
  await assert.rejects(f.run(0,{timeoutMs:5}),{name:'TimeoutError'});
  assert.equal(signal.aborted,true); assert.equal(f.size,0);
});
test('late old resolution cannot remove replacement work', async () => {
  const old=deferred(),next=deferred(); let calls=0; const f=createFlight(()=>++calls===1?old.promise:next.promise);
  const p=f.run('x'); await tick(); f.cancel('x'); await assert.rejects(p);
  const q=f.run('x'); old.resolve('old'); await tick(); assert.equal(f.has('x'),true);
  next.resolve('new'); assert.equal(await q,'new'); assert.equal(f.size,0);
});
test('late old rejection is handled after cancellation', async () => {
  const d=deferred(); const f=createFlight(()=>d.promise); const p=f.run('x'); await tick(); f.clear(); await assert.rejects(p);
  d.reject(new Error('late')); await tick(); assert.equal(f.size,0);
});
test('limits reject new admissions but allow existing keys to join', async () => {
  const d=deferred(); const f=createFlight(()=>d.promise,{maxKeys:1,maxWaitersPerKey:2});
  const a=f.run('x'),b=f.run('x');
  await assert.rejects(f.run('y'),e=>e instanceof CapacityError && e.limit==='maxKeys');
  await assert.rejects(f.run('x'),e=>e.limit==='maxWaitersPerKey'); d.resolve(1); await Promise.all([a,b]);
});
test('clear rejects all current keys and permits reuse', async () => {
  const f=createFlight(()=>42); const p=f.run('a'),q=f.run('b'); const all=Promise.allSettled([p,q]);
  const reason=new Error('shutdown'); f.clear(reason); assert.ok((await all).every(r=>r.reason===reason));
  assert.equal(f.cancel('missing'),false); assert.equal(await f.run('a'),42);
});
test('clear is snapshot based when abort handlers start replacement work', async () => {
  let replacement; const f=createFlight((key,s)=>{ if(key==='old') s.addEventListener('abort',()=>{replacement=f.run('new');}); return key==='old'?new Promise(()=>{}):'new'; });
  const p=f.run('old'); await tick(); f.clear(); await assert.rejects(p); assert.equal(await replacement,'new');
});
test('success removes listeners and deadlines', async () => {
  const a=new AbortController(); const f=createFlight(()=>12);
  assert.equal(await f.run(1,{signal:a.signal,timeoutMs:10000}),12);
  assert.equal(getEventListeners(a.signal,'abort').length,0); a.abort(); assert.equal(f.size,0);
});
test('thenables are assimilated', async () => { const f=createFlight(()=>({then:resolve=>resolve(3)})); assert.equal(await f.run(0),3); });
test('invalid limits and deadlines fail predictably', async () => {
  for(const n of [0,-1,NaN,Infinity,1.5]) { assert.throws(()=>createFlight(()=>0,{maxKeys:n}),RangeError); assert.throws(()=>createFlight(()=>0,{maxWaitersPerKey:n}),RangeError); }
  assert.throws(()=>createFlight(null),TypeError); const f=createFlight(()=>0);
  for(const n of [0,-1,NaN,Infinity,1.5,2147483648]) await assert.rejects(f.run('x',{timeoutMs:n}),RangeError);
  assert.equal(f.size,0);
});
test('CommonJS entry works', async () => { const {createFlight}=createRequire(import.meta.url)('../dist/cjs/index.js'); assert.equal(await createFlight(()=>8).run(1),8); });
