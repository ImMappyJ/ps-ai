import test from 'node:test';
import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';
import {decodePng} from '../src/imaging/image';

function largeDocument(h:Awaited<ReturnType<typeof panelHarness>>,background=false,width=6000,height=3000){
  const doc=h.ps.app.activeDocument;doc.width=width;doc.height=height;
  Object.defineProperty(doc,'selection',{get:()=>({bounds:{left:0,top:0,right:background?width/2:width,bottom:height}}),configurable:true});
  const reads:any[]=[],writes:any[]=[];
  h.ps.imaging.getSelection=async(o:any)=>{
    const b=o.sourceBounds,w=b.right-b.left,rows=b.bottom-b.top,gray=new Uint8Array(w*rows);
    for(let y=0;y<rows;y++)for(let x=0;x<w;x++)gray[y*w+x]=!background||b.left+x<width/2?255:0;
    return {sourceBounds:b,level:0,imageData:{width:w,height:rows,components:1,componentSize:8,getData:async()=>gray,dispose(){}}};
  };
  h.ps.imaging.getPixels=async(o:any)=>{
    reads.push(o);const b=o.sourceBounds,w=o.targetSize?.width??b.right-b.left,rows=o.targetSize?.height??b.bottom-b.top;
    assert.ok(o.targetSize||w*rows<=262_144,'a native source read must stay within one strip');
    return {sourceBounds:b,level:0,imageData:{width:w,height:rows,components:4,componentSize:8,getData:async()=>new Uint8Array(w*rows*4).fill(255),dispose(){}}};
  };
  h.ps.imaging.putPixels=async(o:any)=>{writes.push(o);assert.ok(o.imageData.width*o.imageData.height<=262_144);};
  return {width,height,doc,reads,writes};
}

test('large ordinary edit passes bounded source through generation, history and lazy candidate display',async()=>{
  const h=await panelHarness();try{
    const native=largeDocument(h);h.el('resolution').value='32';h.el('margin').value='0';h.el('count').value='2';h.click('generate');await h.wait();
    assert.equal(h.posts.length,2,JSON.stringify(h.errors));
    const record=h.records()[0],snapshot=record.snapshot as any,source=decodePng(h.files[`${record.id}-source.png`] as Uint8Array);
    assert.equal(snapshot.captureGeometry.kind,'edit-analysis');assert.equal(typeof snapshot.requiresClipping,'boolean');
    assert.ok(source.width*source.height<=1024);assert.equal((h.files[`${record.id}-mask.bin`] as Uint8Array).length,native.width*native.height);
    assert.match(h.el('source-info').textContent,/6000×3000/);assert.match(h.el('source-info').textContent,/工作图/);
    assert.match(h.el('candidate-target').textContent,/PNG／新文档 32×32/);assert.equal(h.el('apply').disabled,false);
    const maskReads=()=>h.fileReads.filter(name=>name.endsWith('-mask.bin')).length,before=maskReads();
    h.el('candidate-select').value='0';h.change('candidate-select');await h.wait();
    assert.equal(maskReads(),before,'changing display selection does not reload native masks');
    assert.match(h.el('candidate-target').textContent,/同次捕获.*替换/);
    native.doc.activeHistoryState={id:native.doc.activeHistoryState.id+1};h.el('candidate-select').value='0';h.change('candidate-select');await h.wait();
    assert.equal(h.el('apply').disabled,true);assert.equal(h.el('export').disabled,false);
    h.selectHistory(record.id);await h.wait();assert.match(h.el('history-details').textContent,/工作图/);
    assert.equal(h.errors.length,0,JSON.stringify(h.errors));
  }finally{await h.close();}
});

test('45MP background with protection keeps default1024 capture, cached range and result preparation within budget',{timeout:60000},async()=>{
  const h=await panelHarness();try{
    const native=largeDocument(h,true,9000,5000);
    Object.defineProperty(native.doc,'selection',{get:()=>({bounds:{left:0,top:0,right:9000,bottom:5000}}),configurable:true});
    h.click('protect');await h.wait();
    Object.defineProperty(native.doc,'selection',{get:()=>({bounds:{left:0,top:0,right:4500,bottom:5000}}),configurable:true});
    h.el('mode').value='background';h.change('mode');h.el('resolution').value='1024';h.el('margin').value='0';h.click('generate');await h.wait();
    assert.equal(h.posts.length,1,JSON.stringify(h.errors));const record=h.records()[0],snapshot=record.snapshot as any;
    for(const suffix of ['mask','subject-mask','protection-mask'])assert.equal((h.files[`${record.id}-${suffix}.bin`] as Uint8Array).length,45_000_000);
    const source=decodePng(h.files[`${record.id}-source.png`] as Uint8Array);
    assert.match(h.el('candidate-caption').textContent,new RegExp(`${source.width}×${source.height}`));
    h.selectHistory(record.id);await h.wait();h.click('load-history');await h.wait();assert.equal(h.el('apply').disabled,false);
    assert.equal(h.posts.length,1,'restoration/application never resubmits');assert.equal(snapshot.backgroundComposite,'subject-background-v1');
    assert.equal(h.errors.length,0,JSON.stringify(h.errors));
  }finally{await h.close();}
});

test('bounded history application reloads native mask, replaces owned output and rejects changed sources',async()=>{
  const h=await panelHarness();try{
    h.el('resolution').value='32';h.el('count').value='2';h.click('generate');await h.wait();
    const records=h.records();for(const record of records){const snapshot=record.snapshot as any;snapshot.captureGeometry={kind:'edit-analysis',width:2,height:2};snapshot.requiresClipping=false;}
    h.files['history.json']=JSON.stringify(records);await h.refreshHistory();
    for(const record of records){h.selectHistory(record.id);await h.wait();h.click('load-history');await h.wait();assert.equal(h.el('apply').disabled,false);h.click('apply');await h.wait();}
    assert.equal(h.ps.app.activeDocument.layers.length,2);assert.equal(h.appliedLayers.length,2);assert.equal(h.posts.length,2);
    h.ps.app.activeDocument.activeHistoryState={id:99};h.change('candidate-select');await h.wait();
    assert.equal(h.el('apply').disabled,true);assert.equal(h.el('export').disabled,false);assert.equal(h.errors.length,0,JSON.stringify(h.errors));
  }finally{await h.close();}
});
