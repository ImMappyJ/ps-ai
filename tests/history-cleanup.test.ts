import test from 'node:test';
import assert from 'node:assert/strict';
import {Storage} from '../src/infrastructure/storage/storage';
import {JobCoordinator,type JobRecord} from '../src/generation/jobs';

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333';
const suffixes=['source.png','mask.bin','output.png','subject-mask.bin','protection-mask.bin'];
const names=(id:string)=>suffixes.map(suffix=>`${id}-${suffix}`);
const record=(id=A,state='ready',extra:Record<string,unknown>={}):JobRecord=>({id,clientId:C,state,graph:{},createdAt:'2026-10-18',...extra});
type Operation='create'|'write'|'move'|'read'|'list'|'delete';
type FileData=string|ArrayBuffer;

/** A private plugin-root Entry store; no Node filesystem or real plugin data. */
function memoryStorage(records:JobRecord[]=[]){
  const entries=new Map<string,any>(),operations:string[]=[];
  const failures:{op:Operation;name:string;skip:number}[]=[];
  let activeDeletes=0,maxDeletes=0;
  let onWrite:((name:string)=>Promise<void>)|undefined;
  function attempt(op:Operation,name:string){
    operations.push(`${op}:${name}`);
    const failure=failures.find(f=>f.op===op&&f.name===name);
    if(failure){if(failure.skip>0){failure.skip--;return;}failures.splice(failures.indexOf(failure),1);throw new Error(`injected ${op} failure`);}
  }
  function put(name:string,data:FileData='pixels',isFile=true){
    const entry:any={name,isFile,isFolder:!isFile,data,
      read:async()=>{attempt('read',entry.name);return entry.data;},
      write:async(value:FileData)=>{attempt('write',entry.name);await onWrite?.(entry.name);entry.data=value;},
      moveTo:async(target:unknown,options:{newName:string;overwrite:boolean})=>{
        assert.equal(target,folder);assert.equal(options.overwrite,true);attempt('move',options.newName);
        entries.delete(entry.name);entry.name=options.newName;entries.set(entry.name,entry);
      },
      delete:async()=>{
        assert.equal(entry.isFile,true,'cleanup must never delete a folder');
        activeDeletes++;maxDeletes=Math.max(maxDeletes,activeDeletes);
        try{await Promise.resolve();attempt('delete',entry.name);assert.equal(entries.get(entry.name),entry);entries.delete(entry.name);}finally{activeDeletes--;}
      }};
    entries.set(name,entry);return entry;
  }
  const folder={
    getEntries:async()=>{attempt('list','root');return [...entries.values()];},
    getEntry:async(name:string)=>{const entry=entries.get(name);if(!entry)throw new Error('missing entry');return entry;},
    createFile:async(name:string,options:{overwrite:boolean})=>{assert.equal(options.overwrite,true);attempt('create',name);return put(name,'');}
  };
  const uxp={storage:{formats:{binary:'binary'},localFileSystem:{getDataFolder:async()=>folder}}};
  put('history.json',JSON.stringify(records));
  return {
    store:new Storage(uxp),restart:()=>new Storage(uxp),entries,operations,put,
    fail:(op:Operation,name:string,skip=0)=>failures.push({op,name,skip}),
    json:(name:string)=>JSON.parse(entries.get(name)?.data),
    files:(id=A)=>names(id).forEach(name=>put(name)),
    maxDeletes:()=>maxDeletes,
    beforeWrite:(callback:(name:string)=>Promise<void>)=>{onWrite=callback;}
  };
}

const emptyStatus={removedIds:[],pendingFiles:0,retainedSharedFiles:0,skippedUnsafeFiles:0,metadataPending:false};

test('clear commits pending and ready IDs, deletes exactly five owned files sequentially, and retains tombstones',async()=>{
  const h=memoryStorage([record(A,'queued'),record(B),record(C)]);h.files(A);h.files(B);h.files(C);
  const result=await h.store.clearHistory([A,B,A,'missing']);
  assert.deepEqual(result,{...emptyStatus,removedIds:[A,B]});
  assert.deepEqual((await h.store.history()).map(r=>r.id),[C]);
  assert.deepEqual(h.operations.filter(op=>op.startsWith('delete:')).sort(),[...names(A),...names(B)].map(name=>'delete:'+name).sort());
  assert.equal(h.maxDeletes(),1);
  assert.ok(names(C).every(name=>h.entries.has(name)));
  assert.deepEqual(await h.restart().historyCleanupStatus(),{...emptyStatus,removedIds:[A,B]});
  await assert.rejects(h.restart().save(record(A,'running')),/cleared/i);
});

test('all saved states, including legacy pending states, can be cleared without contacting a backend',async()=>{
  for(const state of ['created','submitting','queued','running','unknown','cancelling','downloading','output-error','ready','failed','cancelled','legacy-pending']){
    const h=memoryStorage([record(A,state)]);
    assert.deepEqual((await h.store.clearHistory([A])).removedIds,[A],state);
    assert.deepEqual(await h.restart().history(),[],state);
  }
});

test('empty and absent selections leave history and task binaries untouched',async()=>{
  const h=memoryStorage([record()]);h.files();
  assert.deepEqual(await h.store.clearHistory([]),emptyStatus);
  assert.deepEqual(await h.store.clearHistory(['absent']),emptyStatus);
  assert.equal(h.entries.has('history-cleanup.json'),false);
  assert.equal(h.operations.some(op=>op.startsWith('delete:')||op.startsWith('create:')),false);
  assert.deepEqual((await h.store.history()).map(r=>r.id),[A]);
});

test('save before clear is serialized and a failed late save never poisons later history reads',async()=>{
  const h=memoryStorage();
  const saved=h.store.save(record());const cleared=h.store.clearHistory([A]);
  await saved;await cleared;
  await assert.rejects(h.store.save(record()),/cleared/i);
  await h.store.save(record(B));
  assert.deepEqual((await h.store.history()).map(r=>r.id),[B]);
});

test('a cleared UUID cannot reach a new submission through JobCoordinator.save',async()=>{
  const h=memoryStorage([record()]);await h.store.clearHistory([A]);let submissions=0;
  const coordinator=new JobCoordinator({submitJob:async()=>{submissions++;return A;},status:async()=>({state:'unknown'}),cancel:async()=>false},h.store);
  await assert.rejects(coordinator.submit(record(A,'created')),/cleared/i);
  assert.equal(submissions,0);assert.deepEqual(await h.store.history(),[]);
});

test('standard binaries serialize before clear and writes queued after clear cannot recreate any task file',async()=>{
  const h=memoryStorage([record()]);
  let release!:()=>void,started!:()=>void;
  const began=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  h.beforeWrite(async name=>{if(name===`${A}-source.png`){started();await gate;}});
  const before=h.store.binary(`${A}-source.png`,new Uint8Array([1]));await began;
  const clear=h.store.clearHistory([A]);
  const late=names(A).map(name=>h.store.binary(name,new Uint8Array([2])));
  const rejected=Promise.all(late.map(promise=>assert.rejects(promise,/cleared/i)));
  release();await before;await clear;await rejected;
  assert.ok(names(A).every(name=>!h.entries.has(name)));
  for(const name of names(A))await assert.rejects(h.restart().binary(name,new Uint8Array([3])),/cleared/i);
  await h.store.binary('unrelated.bin',new Uint8Array([4]));assert.ok(h.entries.has('unrelated.bin'));
});

for(const op of ['create','write','move'] as const){
  test(`intent journal ${op} failure rejects without authorizing removal, then the queue recovers`,async()=>{
    const h=memoryStorage([record()]);h.files();h.fail(op,op==='move'?'history-cleanup.json':'history-cleanup.json.tmp');
    await assert.rejects(h.store.clearHistory([A]),/injected/);
    assert.deepEqual((await h.store.history()).map(r=>r.id),[A]);
    assert.ok(names(A).every(name=>h.entries.has(name)));
    assert.equal(h.operations.some(value=>value.startsWith('delete:')),false);
    await h.store.save(record(B));assert.deepEqual((await h.store.history()).map(r=>r.id),[B,A]);
    assert.deepEqual((await h.store.clearHistory([A])).removedIds,[A]);
  });
  test(`history rewrite ${op} failure keeps cleared records hidden through restart and retries metadata`,async()=>{
    const h=memoryStorage([record()]);h.files();h.fail(op,op==='move'?'history.json':'history.json.tmp');
    const result=await h.store.clearHistory([A]);
    assert.deepEqual(result,{...emptyStatus,removedIds:[A],metadataPending:true});
    assert.deepEqual(h.json('history.json').map((r:JobRecord)=>r.id),[A]);
    assert.deepEqual(await h.store.history(),[]);
    const restarted=h.restart();assert.deepEqual(await restarted.history(),[]);
    await assert.rejects(restarted.save(record()),/cleared/i);
    assert.equal((await restarted.historyCleanupStatus()).metadataPending,true);
    assert.deepEqual(await restarted.retryHistoryCleanup(),{...emptyStatus,removedIds:[A]});
    assert.deepEqual(h.json('history.json'),[]);
  });
  test(`final journal ${op} failure reports metadata pending and retries without resurrecting a record`,async()=>{
    const h=memoryStorage([record()]);h.files();h.fail(op,op==='move'?'history-cleanup.json':'history-cleanup.json.tmp',1);
    const result=await h.store.clearHistory([A]);
    assert.deepEqual(result,{...emptyStatus,removedIds:[A],metadataPending:true});
    assert.deepEqual(await h.store.history(),[]);assert.ok(names(A).every(name=>!h.entries.has(name)));
    const restarted=h.restart();assert.deepEqual(await restarted.historyCleanupStatus(),result);
    await assert.rejects(restarted.save(record()),/cleared/i);
    assert.deepEqual(await restarted.retryHistoryCleanup(),{...emptyStatus,removedIds:[A]});
  });
}

test('file delete errors and same-name folders remain pending until an explicit retry',async()=>{
  const h=memoryStorage([record()]);h.files();h.fail('delete',`${A}-source.png`);h.put(`${A}-mask.bin`,'folder',false);
  assert.deepEqual(await h.store.clearHistory([A]),{...emptyStatus,removedIds:[A],pendingFiles:2});
  assert.equal(h.entries.get(`${A}-mask.bin`).isFolder,true);
  assert.deepEqual(await h.restart().historyCleanupStatus(),{...emptyStatus,removedIds:[A],pendingFiles:2});
  h.entries.delete(`${A}-mask.bin`);
  assert.deepEqual(await h.restart().retryHistoryCleanup(),{...emptyStatus,removedIds:[A]});
  assert.equal(h.entries.has(`${A}-source.png`),false);
});

test('a missing task file is already cleaned and status reads never remove a pending file',async()=>{
  const h=memoryStorage([record()]);h.put(`${A}-output.png`);h.fail('delete',`${A}-output.png`);
  assert.equal((await h.store.clearHistory([A])).pendingFiles,1);
  const deletes=h.operations.filter(op=>op.startsWith('delete:')).length;
  assert.equal((await h.store.historyCleanupStatus()).pendingFiles,1);
  assert.equal(h.operations.filter(op=>op.startsWith('delete:')).length,deletes);
  h.entries.delete(`${A}-output.png`);
  assert.equal((await h.restart().historyCleanupStatus()).pendingFiles,0);
  assert.deepEqual(await h.restart().retryHistoryCleanup(),{...emptyStatus,removedIds:[A]});
});

test('a directory listing failure after intent commit leaves all unverified files pending for retry',async()=>{
  const h=memoryStorage([record()]);h.files();let injected=false;
  h.beforeWrite(async name=>{if(name==='history-cleanup.json.tmp'&&!injected){injected=true;h.fail('list','root');}});
  assert.deepEqual(await h.store.clearHistory([A]),{...emptyStatus,removedIds:[A],pendingFiles:5});
  assert.deepEqual(await h.restart().history(),[]);assert.ok(names(A).every(name=>h.entries.has(name)));
  assert.deepEqual(await h.restart().retryHistoryCleanup(),{...emptyStatus,removedIds:[A]});
});

test('a later failed intent leaves already committed tombstones intact',async()=>{
  const h=memoryStorage([record(),record(B)]);await h.store.clearHistory([A]);h.files(B);h.fail('move','history-cleanup.json');
  await assert.rejects(h.store.clearHistory([B]),/injected/);
  const restarted=h.restart();assert.deepEqual((await restarted.history()).map(r=>r.id),[B]);
  assert.deepEqual((await restarted.historyCleanupStatus()).removedIds,[A]);
  assert.ok(names(B).every(name=>h.entries.has(name)));
});

test('case variants in normal and relight pointers protect the same Windows task file',async()=>{
  const h=memoryStorage([record(),record(B,'ready',{outputFile:`${A}-OUTPUT.PNG`,relight:{result:{outputFile:`${A}-SOURCE.PNG`}}})]);h.files();
  assert.deepEqual(await h.store.clearHistory([A]),{...emptyStatus,removedIds:[A],retainedSharedFiles:2});
  assert.ok(h.entries.has(`${A}-output.png`));assert.ok(h.entries.has(`${A}-source.png`));
  assert.equal((await h.store.clearHistory([B])).retainedSharedFiles,0);
  assert.equal(h.entries.has(`${A}-output.png`),false);assert.equal(h.entries.has(`${A}-source.png`),false);
});

test('explicit case-variant UUID records do not create an unreadable journal when cleared together',async()=>{
  const lower='abcdefab-cdef-4abc-8abc-abcdefabcdef',upper=lower.toUpperCase();
  const h=memoryStorage([record(lower),record(upper)]);h.files(lower);
  assert.deepEqual((await h.store.clearHistory([lower,upper])).removedIds,[lower,upper]);
  assert.deepEqual(await h.restart().history(),[]);
  await assert.rejects(h.restart().save(record(upper)),/cleared/i);
});

test('clearing one exact case-variant ID preserves the other record and its shared files through restart and recovery',async()=>{
  const lower='abcdefab-cdef-4abc-8abc-abcdefabcdef',upper=lower.toUpperCase();
  for(const [selected,survivor] of [[lower,upper],[upper,lower]]){
    const live=record(survivor,'unknown',{userPrompt:'keep this prompt',sourceName:'keep this source',outputFile:`${lower}-output.png`,relight:{result:{outputFile:`${lower}-output.png`}}});
    const h=memoryStorage([record(selected,'unknown'),live]);h.files(lower);h.put(`${lower}-source.png`,new Uint8Array([3,4]).buffer);
    assert.deepEqual(await h.store.clearHistory([selected]),{...emptyStatus,removedIds:[selected],retainedSharedFiles:5});
    const restarted=h.restart();assert.deepEqual(await restarted.history(),[live]);
    assert.deepEqual(await restarted.historyCleanupStatus(),{...emptyStatus,removedIds:[selected],retainedSharedFiles:5});
    assert.deepEqual([...await restarted.readBinary(`${lower}-source.png`)],[3,4]);
    const recovered=(await restarted.history())[0];recovered.state='ready';await restarted.save(recovered);
    assert.deepEqual(await restarted.history(),[{...live,state:'ready'}]);
    await assert.rejects(restarted.save(record(selected)),/cleared/i);
    await assert.rejects(restarted.binary(`${selected}-output.png`,new Uint8Array([9])),/cleared/i);
    await restarted.binary(`${survivor}-output.png`,new Uint8Array([7,8]));
    assert.deepEqual([...await restarted.readBinary(`${survivor}-output.png`)],[7,8]);
    await restarted.retryHistoryCleanup();assert.ok(h.entries.has(`${lower}-source.png`));
    assert.deepEqual(await restarted.clearHistory([survivor]),{...emptyStatus,removedIds:[survivor]});
    assert.deepEqual(await h.restart().history(),[]);assert.ok([...names(lower),`${survivor}-output.png`].every(name=>!h.entries.has(name)));
    for(const id of [selected,survivor])await assert.rejects(h.restart().binary(`${id}-source.png`,new Uint8Array([1])),/cleared/i);
  }
});

test('an unrecorded case-variant binary owner cannot recreate files after the only record was cleared',async()=>{
  const lower='abcdefab-cdef-4abc-8abc-abcdefabcdef',upper=lower.toUpperCase();
  const h=memoryStorage([record(lower)]);h.files(lower);await h.store.clearHistory([lower]);
  await assert.rejects(h.restart().binary(`${upper}-source.png`,new Uint8Array([1])),/cleared/i);
  assert.ok([...names(lower),`${upper}-source.png`].every(name=>!h.entries.has(name)));
});

test('clearing shared output files defers deletion until the last normal or relight pointer is cleared',async()=>{
  const h=memoryStorage([record(),record(B,'ready',{outputFile:`${A}-output.png`}),record(C,'ready',{relight:{result:{outputFile:`${A}-source.png`}}})]);h.files();
  assert.deepEqual(await h.store.clearHistory([A]),{...emptyStatus,removedIds:[A],retainedSharedFiles:2});
  assert.ok(h.entries.has(`${A}-output.png`));assert.ok(h.entries.has(`${A}-source.png`));
  assert.equal((await h.restart().retryHistoryCleanup()).retainedSharedFiles,2);
  assert.deepEqual(await h.store.clearHistory([B]),{...emptyStatus,removedIds:[B],retainedSharedFiles:1});
  assert.equal(h.entries.has(`${A}-output.png`),false);assert.ok(h.entries.has(`${A}-source.png`));
  assert.deepEqual(await h.store.clearHistory([C]),{...emptyStatus,removedIds:[C]});
  assert.equal(h.entries.has(`${A}-source.png`),false);
  assert.deepEqual((await h.restart().historyCleanupStatus()).removedIds,[A,B,C]);
});

test('foreign safe pointers are never deletion authorization and unsafe pointers are reported without being followed',async()=>{
  const privatePath='../external/private-output.png';
  const h=memoryStorage([record(A,'ready',{outputFile:privatePath,relight:{result:{outputFile:'settings.json'}},graph:{'8':{outputs:[{filename:'outside.png'}]}}})]);h.files();h.files(B);
  for(const name of [privatePath,'settings.json','outside.png'])h.put(name,'protected');
  const result=await h.store.clearHistory([A]);assert.equal(result.skippedUnsafeFiles,2);
  assert.ok([privatePath,'settings.json','outside.png',...names(B)].every(name=>h.entries.has(name)));
  const foreign=memoryStorage([record(A,'ready',{outputFile:`${B}-output.png`,relight:{result:{outputFile:`${B}-output.png`}}})]);foreign.files(A);foreign.files(B);
  assert.deepEqual(await foreign.store.clearHistory([A]),{...emptyStatus,removedIds:[A],skippedUnsafeFiles:1});
  assert.ok(names(B).every(name=>foreign.entries.has(name)));
});

test('foreign output pointers owned by the same authorized batch are removed without being reported as skipped',async()=>{
  const h=memoryStorage([record(A,'ready',{outputFile:`${B}-output.png`}),record(B)]);h.files(A);h.files(B);
  assert.deepEqual(await h.store.clearHistory([A,B]),{...emptyStatus,removedIds:[A,B]});
  assert.ok([...names(A),...names(B)].every(name=>!h.entries.has(name)));
});

test('unsafe legacy IDs can be tombstoned without traversing or deleting derived paths',async()=>{
  for(const id of ['../outside','..\\outside','',`${A}/child`,'not-a-uuid',A+'\n']){
    const h=memoryStorage([record(id,'unknown')]);for(const name of names(id))h.put(name,'protected');
    const result=await h.store.clearHistory([id]);assert.deepEqual(result.removedIds,[id]);assert.ok(result.skippedUnsafeFiles>0);
    assert.ok(names(id).every(name=>h.entries.has(name)));assert.deepEqual(await h.restart().history(),[]);
    await assert.rejects(h.restart().save(record(id)),/cleared/i);
    const journal=String(h.entries.get('history-cleanup.json').data);assert.ok(names(id).every(name=>!journal.includes(name)));
  }
});

test('a trailing newline is not part of an exact safe task filename',async()=>{
  const h=memoryStorage([record(A,'ready',{outputFile:`${A}-output.png\n`})]);h.files();h.put(`${A}-output.png\n`,'protected');
  assert.deepEqual(await h.store.clearHistory([A]),{...emptyStatus,removedIds:[A],skippedUnsafeFiles:1});
  assert.equal(h.entries.get(`${A}-output.png\n`)?.data,'protected');
});

test('cleanup preserves settings, grants, lighting drafts, diagnostics, relay folders and external exports',async()=>{
  const h=memoryStorage([record()]);h.files();
  const protectedFiles=['settings.json','source-access.json','relight-draft.json','runtime-trace.json','diagnostics.json','setup.json','export.png','runtime-source.png',`${A}-guide.png`,`${A}-reference.png`];
  for(const name of protectedFiles)h.put(name,'unchanged');
  const relay=h.put('relay','unchanged',false);
  await h.store.clearHistory([A]);
  for(const name of protectedFiles)assert.equal(h.entries.get(name)?.data,'unchanged');assert.equal(h.entries.get('relay'),relay);
});

test('journal records only authorized IDs, exact safe filenames and counters, never private record data',async()=>{
  const h=memoryStorage([record(A,'running',{userPrompt:'PRIVATE_PROMPT',sourceName:'PRIVATE_SOURCE',graph:{secret:'PRIVATE_GRAPH'},snapshot:{mask:'PRIVATE_MASK'},request:{credential:'PRIVATE_KEY'},relight:{scene:'PRIVATE_SCENE'}})]);h.files();h.fail('delete',`${A}-output.png`);
  await h.store.clearHistory([A]);
  const journal=String(h.entries.get('history-cleanup.json').data);
  for(const value of ['PRIVATE_PROMPT','PRIVATE_SOURCE','PRIVATE_GRAPH','PRIVATE_MASK','PRIVATE_KEY','PRIVATE_SCENE','userPrompt','snapshot','request','credential','graph'])assert.equal(journal.includes(value),false,value);
  assert.ok(journal.includes(A));assert.ok(journal.includes(`${A}-output.png`));
});

test('corrupt history rejects read, clear, save and retry without overwriting records or deleting files',async()=>{
  for(const value of ['{broken','null','{}','[null]','[{"state":"running"}]']){
    const h=memoryStorage([record()]);h.files();h.put('history.json',value);
    await assert.rejects(h.store.history());await assert.rejects(h.store.clearHistory([A]));await assert.rejects(h.store.save(record(B)));await assert.rejects(h.store.retryHistoryCleanup());await assert.rejects(h.store.historyCleanupStatus());
    assert.equal(h.entries.get('history.json').data,value);assert.ok(names(A).every(name=>h.entries.has(name)));
    h.put('history.json',JSON.stringify([record()]));assert.deepEqual((await h.store.history()).map(r=>r.id),[A]);
  }
});

test('corrupt or unauthorized cleanup journal never silently restores history or authorizes deletion',async()=>{
  for(const value of ['{broken','null','{}',JSON.stringify({schemaVersion:1,removedIds:[A],files:['settings.json'],skippedUnsafeFiles:0,metadataPending:true}),JSON.stringify({schemaVersion:1,removedIds:[A],files:[`${B}-output.png`],skippedUnsafeFiles:0,metadataPending:true})]){
    const h=memoryStorage([record()]);h.files();h.put('history-cleanup.json',value);
    await assert.rejects(h.store.history());await assert.rejects(h.store.clearHistory([A]));await assert.rejects(h.store.save(record(B)));await assert.rejects(h.store.retryHistoryCleanup());await assert.rejects(h.store.historyCleanupStatus());await assert.rejects(h.store.binary(`${A}-output.png`,new Uint8Array([1])));
    assert.equal(h.entries.get('history-cleanup.json').data,value);assert.ok(names(A).every(name=>h.entries.has(name)));
  }
});

test('duplicate filenames or extra private fields make a cleanup journal corrupt rather than being retained by retry',async()=>{
  for(const extra of [{files:[`${A}-output.png`,`${A}-OUTPUT.PNG`]},{userPrompt:'PRIVATE_PROMPT'}]){
    const h=memoryStorage([record()]);h.files();
    const value=JSON.stringify({schemaVersion:1,removedIds:[A],files:[`${A}-output.png`],skippedUnsafeFiles:0,metadataPending:true,...extra});
    h.put('history-cleanup.json',value);
    await assert.rejects(h.store.retryHistoryCleanup());await assert.rejects(h.store.history());
    assert.equal(h.entries.get('history-cleanup.json').data,value);assert.ok(names(A).every(name=>h.entries.has(name)));
  }
});

test('status and retry without a cleanup journal do not create metadata or change saved records',async()=>{
  const h=memoryStorage([record()]);assert.deepEqual(await h.store.historyCleanupStatus(),emptyStatus);assert.deepEqual(await h.store.retryHistoryCleanup(),emptyStatus);
  assert.deepEqual((await h.store.history()).map(r=>r.id),[A]);assert.equal(h.entries.has('history-cleanup.json'),false);
});
