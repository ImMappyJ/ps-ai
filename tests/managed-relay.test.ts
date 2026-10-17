import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {startManagedRelay} from '../server/runtime/managed-relay';

test('managed relay authenticates every route, isolates providers and never sends keys upstream on configuration',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-managed-'));const original=globalThis.fetch;let remote=0;
  globalThis.fetch=(async(url:any,init:any)=>{assert.match(String(url),/^http:\/\/127\.0\.0\.1:/);return original(url,init);}) as typeof fetch;
  let relay:Awaited<ReturnType<typeof startManagedRelay>>|undefined;
  try{
    relay=await startManagedRelay({dataDir:root,ports:{bailian:0,gemini:0,openai:0}});
    const session=JSON.parse(await fs.readFile(path.join(root,'relay-session.json'),'utf8'));
    assert.match(session.token,/^[a-f0-9]{64}$/);assert.equal(session.protocol,'ps-ai-relay/1');
    const base=`http://127.0.0.1:${session.ports.openai}/psai/v1`,headers={'Content-Type':'application/json',Authorization:`Bearer ${session.token}`};
    assert.equal((await fetch(base+'/capabilities')).status,401);
    assert.equal((await fetch(base+'/configure',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:JSON.stringify({apiKey:'secret-test-key'})})).status,403);
    assert.equal((await fetch(base+'/configure',{method:'POST',headers,body:JSON.stringify({apiKey:'secret-test-key',provider:'bailian'})})).status,400);
    assert.equal((await fetch(base+'/configure',{method:'POST',headers,body:JSON.stringify({apiKey:'secret-test-key'})})).status,200);
    const cap=await (await fetch(base+'/capabilities',{headers})).json();assert.equal(cap.provider,'openai');assert.equal(cap.configured,true);
    const other=await(await fetch(`http://127.0.0.1:${session.ports.gemini}/psai/v1/capabilities`,{headers})).json();assert.equal(other.configured,false);
    for(const folder of ['bailian','gemini','openai'])assert.ok((await fs.stat(path.join(root,folder,'jobs'))).isDirectory());
    const all=async(dir:string):Promise<string>=>{let text='';for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);text+=e.isDirectory()?await all(p):await fs.readFile(p,'utf8');}return text;};
    assert.doesNotMatch(await all(root),/secret-test-key/);assert.equal(remote,0);
    await relay.close();relay=await startManagedRelay({dataDir:root,ports:{bailian:0,gemini:0,openai:0}});
    const next=JSON.parse(await fs.readFile(path.join(root,'relay-session.json'),'utf8'));assert.equal(next.token,session.token);
    assert.equal((await(await fetch(`http://127.0.0.1:${next.ports.openai}/psai/v1/capabilities`,{headers})).json()).configured,false);
  }finally{globalThis.fetch=original;await relay?.close();await fs.rm(root,{recursive:true,force:true});}
});

test('managed credential replacement rejects unfinished jobs and preserves the existing key',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-managed-key-'));const relay=await startManagedRelay({dataDir:root,ports:{bailian:0,gemini:0,openai:0}});
  try{
    const s=relay.session,base=`http://127.0.0.1:${s.ports.openai}/psai/v1`,headers={'Content-Type':'application/json',Authorization:`Bearer ${s.token}`};
    const configure=(key:string)=>fetch(base+'/configure',{method:'POST',headers,body:JSON.stringify({apiKey:key})});
    assert.equal((await configure('first-key')).status,200);
    const id='11111111-1111-4111-8111-111111111111';await fs.writeFile(path.join(root,'openai','jobs',id+'.json'),JSON.stringify({id,clientId:id,state:'unknown'}));
    assert.equal((await configure('second-key')).status,409);assert.equal((await configure('')).status,409);assert.equal((await configure('first-key')).status,200);
    await relay.close();const restarted=await startManagedRelay({dataDir:root,ports:{bailian:0,gemini:0,openai:0}});
    try{const target=`http://127.0.0.1:${restarted.session.ports.openai}/psai/v1/configure`;assert.equal((await fetch(target,{method:'POST',headers,body:JSON.stringify({apiKey:''})})).status,409);assert.equal((await fetch(target,{method:'POST',headers,body:JSON.stringify({apiKey:'second-key'})})).status,409);assert.equal((await fetch(target,{method:'POST',headers,body:JSON.stringify({apiKey:'first-key'})})).status,200);}finally{await restarted.close();}
  }finally{await relay.close();await fs.rm(root,{recursive:true,force:true});}
});
