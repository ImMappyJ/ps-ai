import test from 'node:test';
import assert from 'node:assert/strict';
import type {JobRecord} from '../src/generation/jobs';

const api=await import('../src/app/history-selection').catch(()=>({} as any));
function fixture(){
  const id='a1000000-1111-4111-8111-111111111111';
  const record:JobRecord={id,clientId:id,state:'ready',createdAt:'2026-11-01',graph:{},params:{workspace:'local',mode:'edit',outputKind:'edit'},selectionRange:{version:'native-v1',scope:'selection'},snapshot:{documentId:11,sessionId:'session',width:12,height:10,mode:'rgb',depth:8,nativeDepth:8,bounds:{left:4,top:3,right:7,bottom:5},captureGeometry:{kind:'edit-analysis',width:2,height:1}}};
  const raw=Uint8Array.from([0,64,128,255,0,255]),protection=Uint8Array.from([255,0,128,0,0,0]);
  const files:Record<string,Uint8Array>={[id+'-subject-mask.bin']:raw,[id+'-protection-mask.bin']:protection};const reads:string[]=[];
  const read=async(name:string)=>{reads.push(name);if(!files[name])throw Error('missing');return files[name];};
  return {record,raw,protection,files,reads,read};
}
test('each historical selection retains native feathers and its separate protection, independent of the working PNG',async()=>{
  const f=fixture();assert.equal(typeof api.readHistorySelection,'function');
  const saved=await api.readHistorySelection(f.record,f.read);
  assert.equal(saved.scope,'selection');assert.deepEqual([...saved.range.mask],[0,64,128,255,0,255]);assert.deepEqual([...saved.protection.mask],[255,0,128,0,0,0]);
  assert.deepEqual(saved.range.bounds,{left:4,top:3,right:7,bottom:5});assert.equal(saved.range.documentId,11);assert.equal(saved.range.sessionId,'session');assert.equal(saved.range.width,12);
  assert.deepEqual(f.reads,[f.record.id+'-subject-mask.bin',f.record.id+'-protection-mask.bin']);
});
test('saved selections allow an empty protection plane but reject missing, empty or incorrectly sized raw data',async()=>{
  const f=fixture();f.protection.fill(0);await api.readHistorySelection(f.record,f.read);
  for(const replacement of [undefined,new Uint8Array(6),new Uint8Array(2).fill(255)]){
    f.files[f.record.id+'-subject-mask.bin']=replacement as any;
    await assert.rejects(api.readHistorySelection(f.record,f.read),/选区|范围/);
  }
});
test('known legacy raw-mask contracts can recover but effective-only history cannot invent the original selection',async()=>{
  const f=fixture();delete f.record.selectionRange;
  assert.equal(api.historySelectionScope(f.record),undefined);
  await assert.rejects(api.readHistorySelection(f.record,f.read),/选区|范围/);assert.deepEqual(f.reads,[]);
  for(const mode of ['edit','costume','reference']){
    (f.record.params as any).mode=mode;(f.record.params as any).edgeBlend=300;(f.record.snapshot as any).edgeBlend={version:'outward-v2',radius:300};
    assert.equal(api.historySelectionScope(f.record),'selection');assert.deepEqual([...(await api.readHistorySelection(f.record,f.read)).range.mask],[0,64,128,255,0,255]);
  }
});
test('a malformed explicit range marker never falls back to an otherwise recognizable legacy mask',async()=>{
  const f=fixture();(f.record.snapshot as any).edgeBlend={version:'outward-v2',radius:8};(f.record.params as any).edgeBlend=8;
  for(const marker of [{version:['native-v1'],scope:'selection'},{version:'native-v1',scope:'future'},{version:'native-v1',scope:'selection',extra:true}]){
    f.record.selectionRange=marker;assert.equal(api.historySelectionScope(f.record),undefined);await assert.rejects(api.readHistorySelection(f.record,f.read),/选区|范围/);
  }
  assert.deepEqual(f.reads,[]);
});
test('history range checks native geometry, task ownership and retained memory before reading masks',async()=>{
  for(const change of ['id','bounds','depth','memory']){
    const f=fixture(),s=f.record.snapshot as any;if(change==='id')f.record.id='../another-task';if(change==='bounds')s.bounds.right=13;if(change==='depth')s.nativeDepth=32;
    await assert.rejects(api.readHistorySelection(f.record,f.read,change==='memory'?512_000_000:0));assert.deepEqual(f.reads,[]);
  }
});
test('document-scoped relighting retains explicit whole-document semantics without inventing a selection scope',async()=>{
  const f=fixture(),s=f.record.snapshot as any;(f.record.params as any).mode='relight';f.record.selectionRange={version:'native-v1',scope:'document'};s.width=3;s.height=2;s.bounds={left:0,top:0,right:3,bottom:2};f.raw.fill(255);
  assert.equal((await api.readHistorySelection(f.record,f.read)).scope,'document');
  s.bounds.left=1;await assert.rejects(api.readHistorySelection(f.record,f.read),/选区|范围/);
});
test('legacy blend recovery rejects unversioned or foreign task metadata',async()=>{
  const f=fixture();delete f.record.selectionRange;(f.record.params as any).mode='blend';(f.record.snapshot as any).captureGeometry.kind='blend-analysis';
  for(const metadata of [{},{schemaVersion:2},{schemaVersion:1,requestId:'foreign'}]){
    f.record.blend=metadata;assert.equal(api.historySelectionScope(f.record),undefined);await assert.rejects(api.readHistorySelection(f.record,f.read));
  }
  assert.deepEqual(f.reads,[]);
});
