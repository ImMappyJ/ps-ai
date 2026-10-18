import test from 'node:test';import assert from 'node:assert/strict';
import {PhotoshopAdapter} from '../src/infrastructure/photoshop/photoshop';

function fixture(depth:8|16=8){
  const calls:any[]=[],buffers:any[]=[],writes:any[]=[];
  const doc:any={id:11,width:10,height:8,mode:'rgb',bitsPerChannel:depth,colorProfileName:'Adobe RGB (1998)',activeHistoryState:{id:91},quickMaskMode:false,selection:{bounds:null},layers:[{id:2}]};
  let beforeModal=()=>{},failure=false,prior:any;
  const ps:any={app:{documents:[doc],activeDocument:doc},constants:{DocumentMode:{RGB:'rgb',GRAYSCALE:'gray'},BitsPerChannelType:{EIGHT:8,SIXTEEN:16}},core:{executeAsModal:async(fn:any)=>{beforeModal();return fn({hostControl:{suspendHistory:async(o:any)=>{calls.push(['suspend',o]);prior={selection:doc.selection,history:doc.activeHistoryState};return 77;},resumeHistory:async(id:number,commit:boolean)=>{calls.push(['resume',id,commit]);if(commit)doc.activeHistoryState={id:doc.activeHistoryState.id+1};else{doc.selection=prior.selection;doc.activeHistoryState=prior.history;}}}});}},imaging:{createImageDataFromBuffer:async(values:any,options:any)=>{const data={values:values.slice(),...options,disposed:false,dispose(){this.disposed=true;}};buffers.push(data);return data;},putSelection:async(o:any)=>{writes.push(o);doc.selection={bounds:{left:1,top:1,right:5,bottom:4}};if(failure)throw new Error('selection write failed');}}};
  const adapter=new PhotoshopAdapter(ps,'session-a');
  const range=()=>({documentId:11,sessionId:'session-a',width:10,height:8,mode:'rgb',depth,bounds:{left:1,top:1,right:5,bottom:4},mask:new Uint8Array([0,255,128,0,255,0,64,255,0,128,255,0])});
  const restore=async(value:any)=>{assert.equal(typeof (adapter as any).restoreSelection,'function','adapter must restore only a saved selection range');return (adapter as any).restoreSelection(value);};
  return {doc,ps,adapter,range,restore,calls,buffers,writes,fail(){failure=true;},before(fn:()=>void){beforeModal=fn;}};
}

test('selection restoration writes feathered grayscale at the saved offset in one history step without old pixel/history authority',async()=>{
  for(const depth of [8,16] as const){
    const h=fixture(depth),range=h.range();h.doc.activeHistoryState={id:120};
    await h.restore(range);
    assert.deepEqual(h.calls,[['suspend',{documentID:11,name:'ps-ai 恢复选区'}],['resume',77,true]]);
    assert.equal(h.writes.length,1);const write=h.writes[0];assert.equal(write.documentID,11);assert.equal(write.replace,true);assert.deepEqual(write.targetBounds,{left:1,top:1});
    assert.deepEqual([...h.buffers[0].values],depth===16?[0,65535,32896,0,65535,0,16448,65535,0,32896,65535,0]:[0,255,128,0,255,0,64,255,0,128,255,0]);
    assert.equal(h.buffers[0].components,1);assert.equal(h.buffers[0].colorSpace,'Grayscale');assert.equal(h.buffers[0].colorProfile,'Gray Gamma 2.2');assert.equal(h.buffers[0].fullRange,depth===16?true:undefined);assert.equal(h.buffers[0].disposed,true);
    assert.equal(h.doc.colorProfileName,'Adobe RGB (1998)');assert.equal(h.doc.activeHistoryState.id,121);assert.deepEqual(h.doc.layers,[{id:2}]);assert.equal((range as any).historyId,undefined);
  }
});

test('selection restoration refuses foreign sessions/documents, changed geometry/native format and quick mask before writing',async()=>{
  for(const mutate of [
    (h:any,r:any)=>r.sessionId='old-session',(h:any,r:any)=>h.ps.app.activeDocument={...h.doc,id:22},
    (h:any,r:any)=>h.doc.width++,(h:any,r:any)=>h.doc.height++,(h:any,r:any)=>h.doc.mode='gray',
    (h:any,r:any)=>h.doc.bitsPerChannel=16,(h:any,r:any)=>h.doc.quickMaskMode=true,
    (h:any,r:any)=>r.bounds.left=-1,(h:any,r:any)=>r.bounds.right=11,(h:any,r:any)=>r.bounds.top=.5,
    (h:any,r:any)=>r.mask=new Uint8Array(11),(h:any,r:any)=>r.mask.fill(0),
  ]){
    const h=fixture(),r=h.range();mutate(h,r);await assert.rejects(h.restore(r),/会话|文档|选区|位深|模式|范围|快速蒙版/);assert.equal(h.writes.length,0);assert.equal(h.buffers.length,0);
  }
});

test('selection restoration rechecks the source after entering modal',async()=>{
  for(const mutate of [(h:any)=>h.ps.app.activeDocument={...h.doc,id:22},(h:any)=>h.doc.width++,(h:any)=>h.doc.bitsPerChannel=16,(h:any)=>h.doc.quickMaskMode=true]){
    const h=fixture();h.before(()=>mutate(h));await assert.rejects(h.restore(h.range()),/文档|选区|位深|模式|范围|快速蒙版/);assert.equal(h.writes.length,0);assert.equal(h.buffers.length,0);
  }
});

test('a failed selection write rolls back the selection and disposes its buffer without reading pixels',async()=>{
  const h=fixture(),before=h.doc.selection;h.fail();await assert.rejects(h.restore(h.range()),/selection write failed/);
  assert.equal(h.doc.selection,before);assert.equal(h.doc.activeHistoryState.id,91);assert.deepEqual(h.calls.slice(-1),[['resume',77,false]]);assert.equal(h.buffers[0].disposed,true);
});
