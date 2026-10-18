import test from 'node:test';
import assert from 'node:assert/strict';

const api=()=>import('../src/app/relight-source-monitor').catch(()=>null) as Promise<any>;
const tick=()=>new Promise(r=>setTimeout(r,5));
test('source notifications coalesce invalidations and release exactly their own listener',async()=>{
  const m=await api();assert.equal(typeof m?.observeRelightSource,'function');
  let callback:()=>void=()=>{},invalidations=0;const removed:any[]=[];
  const action={addNotificationListener:async(events:string[],cb:()=>void)=>{assert.ok(events.includes('undoEvent'));callback=cb;},removeNotificationListener:async(events:string[],cb:()=>void)=>{removed.push([events,cb]);}};
  const stop=m.observeRelightSource(action,()=>invalidations++,()=>assert.fail('registration must succeed'));
  await tick();for(let i=0;i<20;i++)callback();await tick();assert.equal(invalidations,1);
  stop();stop();callback();await tick();assert.equal(invalidations,1);assert.equal(removed.length,1);assert.equal(removed[0][1],callback);
});
test('closing before asynchronous listener registration settles still removes it',async()=>{
  const m=await api();assert.equal(typeof m?.observeRelightSource,'function');
  let release!:()=>void,removed=0;const pending=new Promise<void>(r=>release=r);
  const stop=m.observeRelightSource({addNotificationListener:()=>pending,removeNotificationListener:async()=>{removed++;}},()=>assert.fail('closed monitor must stay quiet'),()=>{});
  stop();release();await tick();assert.equal(removed,1);
});
test('unsupported notifications retain boundary-check fallback and report once without polling',async()=>{
  const m=await api();assert.equal(typeof m?.observeRelightSource,'function');
  const notices:string[]=[];const stop=m.observeRelightSource({},()=>assert.fail('no fabricated source event'),(reason:string)=>notices.push(reason));
  await tick();stop();assert.equal(notices.length,1);assert.match(notices[0],/notification|通知/i);
});
