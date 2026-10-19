import test from 'node:test';import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';
import {defaultSettings} from '../src/infrastructure/config/profile';

const output={width:32,height:32,rgba:Uint8Array.from({length:32*32*4},(_,i)=>[40,100,230,255][i%4])};
const selection={bounds:{left:0,top:0,right:2,bottom:2},mask:new Uint8Array([255,128,64,0])};
function selectDestination(h:Awaited<ReturnType<typeof panelHarness>>){h.click('tab-t2i');h.el('destination').value='selection';h.change('destination');h.el('resolution').value='32';}

test('text-to-image selection destination shows local range tools while independent output hides them',async()=>{
  const h=await panelHarness();try{
    await h.wait();selectDestination(h);assert.equal(h.el('destination').disabled,false);assert.equal(h.el('selection-tools').style.display,'block');
    h.el('destination').value='document';h.change('destination');assert.equal(h.el('selection-tools').style.display,'none');
  }finally{await h.close();}
});

test('text-to-image selection captures its local target and applies to the frozen source without uploading source or guide',async()=>{
  const h=await panelHarness({output,selection});try{
    await h.wait();selectDestination(h);h.click('generate');await h.wait();assert.equal(h.posts.length,1);assert.ok(h.captured.length>0);assert.equal(h.uploads.length,0);
    const record=h.records()[0],snapshot=record.snapshot as any;assert.equal(snapshot.documentId,11);assert.equal((record.params as any).outputKind,'t2i');assert.equal((record.params as any).destination,'selection');assert.equal((record.params as any).assetContext,undefined);assert.equal(h.posts[0].prompt['9'],undefined);assert.ok(h.files[`${record.id}-source.png`]);assert.deepEqual([...h.files[`${record.id}-mask.bin`] as Uint8Array],[255,128,64,0]);assert.equal(h.el('apply').disabled,false);
    h.switchDocument(22);const writes:any[]=[];h.ps.imaging.putPixels=async(value:any)=>{writes.push(value);};h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,1);assert.equal(writes[0].documentID,11);assert.equal(h.ps.app.activeDocument.id,22);assert.equal(h.posts.length,1);assert.equal(h.errors.length,0);
  }finally{await h.close();}
});

test('gateway text-to-image selection captures only a local target and sends a text-only generation request',async()=>{
  const h=await panelHarness({settings:{...defaultSettings(),backend:'gateway',baseUrl:'http://localhost:8190',gatewayModel:'qwen-image-2.1-pro'},selection});try{
    await h.wait();selectDestination(h);h.el('resolution').value='512';h.click('generate');await h.wait();assert.equal(h.gatewayPosts.length,1);assert.ok(h.captured.length>0);assert.equal(h.uploads.length,0);
    const request=h.gatewayPosts[0].request;assert.equal(request.kind,'t2i');for(const field of ['source','guide','reference','assetContext'])assert.equal(request[field],undefined);assert.equal((h.records()[0].snapshot as any).documentId,11);h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,1);assert.equal(h.errors.length,0);
  }finally{await h.close();}
});

test('text-to-image selection rejects missing documents, missing selections and fully protected scopes before POST',async()=>{
  for(const failure of ['document','selection','protected']){
    const h=await panelHarness({output,noDocuments:failure==='document'});try{
      await h.wait();if(failure==='protected'){h.click('protect');await h.wait();}if(failure==='selection')h.setSelection({bounds:null as any,mask:new Uint8Array(4)});
      selectDestination(h);h.click('generate');await h.wait();assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);assert.equal(h.records().length,0);assert.equal(h.appliedLayers.length,0);assert.equal(h.errors.length,1);
    }finally{await h.close();}
  }
});

test('text-to-image selection candidates retain source-change checks before application',async()=>{
  const h=await panelHarness({output,selection});try{
    await h.wait();selectDestination(h);h.click('generate');await h.wait();assert.ok(h.records()[0].snapshot);h.ps.app.activeDocument.activeHistoryState={id:99};h.change('candidate-select');await h.wait();assert.equal(h.el('apply').getAttribute('data-candidate-action'),'inspect');h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,0);assert.equal(h.errors[0]?.code,'source-changed');assert.equal(h.posts.length,1);
  }finally{await h.close();}
});

test('independent text-to-image and explicit text assets do not capture the current document',async()=>{
  for(const mode of ['t2i','asset']){
    const h=await panelHarness({noDocuments:true,output});try{
      await h.wait();if(mode==='t2i')h.click('tab-t2i');else {h.click('tab-cosplay');h.el('asset-input').value='text';h.change('asset-input');}
      h.el('resolution').value='32';h.click('generate');await h.wait();assert.equal(h.posts.length,1);assert.equal(h.captured.length,0);assert.equal(h.pixelRequests.length,0);assert.equal(h.uploads.length,0);assert.equal(h.records()[0].snapshot,undefined);assert.equal((h.records()[0].params as any).destination,'document');
    }finally{await h.close();}
  }
});
