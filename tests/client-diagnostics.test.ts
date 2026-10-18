import test from 'node:test';import assert from 'node:assert/strict';
import {ComfyClient,HttpError,uuid} from '../src/infrastructure/backends/client';
import {GatewayClient} from '../src/infrastructure/backends/gateway-client';
import {diagnostic} from '../src/diagnostics/diagnostics';

test('gateway HTTP failures retain typed authentication, quota, limits and timeout diagnostics',async()=>{
 for(const [status,code,want] of [[401,'authentication','unauthorized'],[429,'rate-limit','rate-limited'],[429,'quota-exceeded','quota-exceeded'],[400,'invalid-input','unsupported'],[413,'invalid-input','image-budget']] as const){
  const client=new GatewayClient('http://localhost:8190','fixture',async()=>Response.json({code,message:'safe cause'},{status}));
  await assert.rejects(client.connect(),(error:unknown)=>error instanceof HttpError&&diagnostic(error,'connection').code===want);
 }
 const offline=new GatewayClient('http://localhost:8190','fixture',async()=>{throw new TypeError('fetch failed');});await assert.rejects(offline.connect(),(error:unknown)=>diagnostic(error,'connection').code==='unreachable');
 const timeout=new GatewayClient('http://localhost:8190','fixture',async()=>new Promise(()=>{}),5);await assert.rejects(timeout.connect(),(error:unknown)=>diagnostic(error,'connection').code==='timeout');
});

test('gateway status accepts only public diagnostic codes and Comfy HTTP errors stay HTTP errors for idempotency',async()=>{
 for(const code of ['unauthorized','rate-limited','quota-exceeded','timeout','unsupported','invalid-output']){const client=new GatewayClient('http://localhost:8190','fixture',async()=>Response.json({state:'failed',code,detail:'safe cause'}));assert.equal((await client.status(uuid())).code,code);}
 const unknown=new GatewayClient('http://localhost:8190','fixture',async()=>Response.json({state:'failed',code:'private-unrecognized',detail:'safe cause'}));assert.equal((await unknown.status(uuid())).code,undefined);
 for(const status of [401,429,413]){const client=new ComfyClient('http://localhost:8188',async()=>new Response('safe cause',{status}));await assert.rejects(client.connect(),(error:unknown)=>error instanceof HttpError&&error.status===status);}
});
