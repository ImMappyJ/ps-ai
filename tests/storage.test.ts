import test from 'node:test';import assert from 'node:assert/strict';import {Storage} from '../src/infrastructure/storage/storage';
function traceStorage(initial?:string){
  const files:Record<string,string>={};if(initial!==undefined)files['runtime-trace.json']=initial;
  const folder={getEntries:async()=>Object.keys(files).map(name=>({name})),getEntry:async(name:string)=>({read:async()=>files[name]}),createFile:async(name:string)=>({write:async(text:string)=>{files[name]=text;},moveTo:async(_folder:unknown,o:any)=>{files[o.newName]=files[name];delete files[name];}})};
  return {store:new Storage({storage:{localFileSystem:{getDataFolder:async()=>folder}}}),files};
}
test('并行阶段记录不互相覆盖，并只保留最近 80 条',async()=>{
  const {store,files}=traceStorage();await Promise.all(Array.from({length:100},(_,i)=>store.trace('stage-'+i,'own-task')));
  const log=JSON.parse(files['runtime-trace.json']);assert.equal(log.events.length,80);
  assert.deepEqual(log.events.map((e:any)=>e.stage),Array.from({length:80},(_,i)=>'stage-'+(i+20)));
  assert.equal(files['runtime-trace.json.tmp'],undefined);
});
test('损坏的诊断日志重新建立阶段记录，不影响任务历史',async()=>{
  for(const initial of ['{broken','null']){
    const {store,files}=traceStorage(initial);await store.trace('capture.start');
    assert.equal(JSON.parse(files['runtime-trace.json']).events[0].stage,'capture.start');
    assert.equal(files['history.json'],undefined);
  }
});
