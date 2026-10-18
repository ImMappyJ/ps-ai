import test from 'node:test';
import assert from 'node:assert/strict';
import {JobCoordinator,blocksGeneration,type JobRecord} from '../src/generation/jobs';
import type {Status} from '../src/infrastructure/backends/client';

const record=():JobRecord=>({id:'11111111-1111-4111-8111-111111111111',clientId:'22222222-2222-4222-8222-222222222222',createdAt:'2026-10-18',state:'unknown',graph:{},baseUrl:'http://localhost:8188',userPrompt:'private prompt'});

test('local detachment removes only unknown records from the generation guard, preserving older pending states',()=>{
  for(const state of ['submitting','queued','running','cancelling'])for(const tracking of [undefined,'detached'] as const)assert.equal(blocksGeneration({...record(),state,tracking}),true);
  assert.equal(blocksGeneration(record()),true);assert.equal(blocksGeneration({...record(),tracking:'detached'}),false);
  for(const state of ['ready','failed','cancelled','output-error'])assert.equal(blocksGeneration({...record(),state}),false);
});

test('a failure to save a confirmed cancellation outcome retains the known terminal state',async()=>{
  for(const state of ['ready','failed','cancelled'] as const){
    const saved=record(),result:Status=state==='ready'?{state,images:[{filename:'kept.png',subfolder:'',type:'output'}]}:{state};
    const coordinator=new JobCoordinator({submitJob:async()=>{throw Error('must never resubmit');},cancel:async()=>false,status:async()=>result},{save:async r=>{if(r.state===state)throw Error('private store unavailable');}});
    await assert.rejects(coordinator.cancel(saved),/private store unavailable/);assert.equal(saved.state,state);
    if(state==='ready')assert.deepEqual(saved.outputs,result.images);
  }
});
