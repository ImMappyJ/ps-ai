import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createJobService} from '../server/application/jobs';
import {BailianProvider} from '../server/providers/bailian';
import type {ImageProvider} from '../server/providers/contract';
import {cloudPng,cloudRequest,testId} from './gateway-fixtures';
import {uuid} from '../src/infrastructure/backends/client';

test('作业服务脱离HTTP：平台调用前身份已落盘，并发同UUID只提交一次',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-application-'));
  const id=uuid(),clientId=uuid();let calls=0;
  const provider:ImageProvider={
    id:'bailian',baseUrl:'https://dashscope.aliyuncs.com/api/v1',configured:true,
    capabilities:()=>new BailianProvider({apiKey:'fake'}).capabilities(),
    async submit(){
      calls++;
      const saved=JSON.parse(await fs.readFile(path.join(root,'jobs',id+'.json'),'utf8'));
      assert.equal(saved.id,id);assert.equal(saved.clientId,clientId);assert.equal(saved.state,'submitting');
      assert.equal(saved.providerId,'bailian');assert.equal(saved.providerBaseUrl,provider.baseUrl);
      assert.match(saved.fingerprint,/^[0-9a-f]{64}$/);assert.equal(saved.providerTaskId,undefined);
      return {taskId:testId};
    },
    async poll(){return {state:'queued'};},
    async download(){return cloudPng();}
  };
  const jobs=await createJobService({dataDir:root,provider});
  try{
    const envelope={id,clientId,request:cloudRequest};
    await Promise.all([jobs.submit(envelope),jobs.submit(envelope)]);
    assert.equal(calls,1);assert.equal((await jobs.status(id)).state,'queued');
    assert.equal((await jobs.store.job(id))?.providerTaskId,testId);
    await assert.rejects(jobs.submit({...envelope,request:{...cloudRequest,seed:43}}),/different request/);
  }finally{await jobs.drain();await jobs.store.close();await fs.rm(root,{recursive:true,force:true});}
});

test('作业服务脱离HTTP：排空等待工作落盘，临时输出I/O失败可重启恢复且不重发',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ps-ai-application-drain-'));
  const envelope={id:uuid(),clientId:uuid(),request:cloudRequest};let calls=0,release!:(value:{image:Uint8Array})=>void;
  const provider:ImageProvider={
    id:'bailian',execution:'inline',baseUrl:'https://dashscope.aliyuncs.com/api/v1',configured:true,
    capabilities:()=>new BailianProvider({apiKey:'fake'}).capabilities(),
    async submit(){calls++;return new Promise(resolve=>{release=resolve;});}
  };
  let jobs=await createJobService({dataDir:root,provider});let drained=false;
  try{
    const saveImage=jobs.store.image.bind(jobs.store);
    jobs.store.image=async(id,bytes,raw=false)=>{if(!raw)throw new Error('disk busy');return saveImage(id,bytes,raw);};
    await jobs.submit(envelope);assert.equal((await jobs.status(envelope.id)).state,'running');
    const draining=jobs.drain().then(()=>{drained=true;});
    await new Promise(resolve=>setTimeout(resolve,10));assert.equal(drained,false);
    assert.ok(await fs.stat(path.join(root,'gateway.lock')));
    release({image:cloudPng()});await draining;
    assert.ok(await jobs.store.raw(envelope.id));assert.equal((await jobs.store.job(envelope.id))?.state,'unknown');
    await jobs.store.close();jobs=await createJobService({dataDir:root,provider});
    assert.equal((await jobs.status(envelope.id)).state,'ready');
    assert.deepEqual(await jobs.output(envelope.id),cloudPng());
    await jobs.submit(envelope);assert.equal(calls,1);
  }finally{release?.({image:cloudPng()});await jobs.drain();await jobs.store.close();await fs.rm(root,{recursive:true,force:true});}
});
