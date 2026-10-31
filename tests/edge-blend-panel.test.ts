import test from 'node:test';
import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';
import {outwardBlendMask} from '../src/features/editing/edge-blend';

test('ordinary edit edge control defaults to 8 native pixels and hides outside edit mode',async()=>{
  const h=await panelHarness();try{
    await h.wait();assert.ok(h.el('edge-blend'));assert.equal(h.el('edge-blend').getAttribute('value'),'8');
    assert.notEqual(h.el('edge-blend-controls').style.display,'none');
    h.el('mode').value='remove';h.change('mode');assert.equal(h.el('edge-blend-controls').style.display,'none');
    h.click('tab-cosplay');h.el('mode').value='blend';h.change('mode');assert.equal(h.el('edge-blend-controls').style.display,'none');
  }finally{await h.close();}
});

test('ordinary edge blend persists native effective/raw/protection masks and detects tampering before apply',async()=>{
  const source={width:16,height:16,rgba:new Uint8Array(16*16*4).fill(255)},selection={bounds:{left:6,top:6,right:10,bottom:10},mask:new Uint8Array(256)},output={width:32,height:32,rgba:new Uint8Array(32*32*4).fill(180)};
  for(let y=6;y<10;y++)selection.mask.fill(255,y*16+6,y*16+10);
  for(let p=3;p<output.rgba.length;p+=4)output.rgba[p]=255;
  const h=await panelHarness({source,selection,output});try{
    await h.wait();h.el('edge-blend').value='2';h.change('edge-blend');h.el('resolution').value='32';h.click('generate');await h.wait();
    assert.equal(h.posts.length,1,JSON.stringify(h.errors));const record=h.records()[0],s=record.snapshot as any;
    assert.equal((record.params as any).edgeBlend,2);assert.deepEqual(s.edgeBlend,{version:'outward-v1',radius:2});
    const raw=h.files[`${record.id}-subject-mask.bin`] as Uint8Array,protection=h.files[`${record.id}-protection-mask.bin`] as Uint8Array,mask=h.files[`${record.id}-mask.bin`] as Uint8Array;
    assert.equal(raw[7*16+5],0);assert.ok(mask[7*16+5]>0);assert.deepEqual(mask,outwardBlendMask(raw,16,16,2,protection));
    const written:Uint8Array[]=[];h.ps.imaging.putLayerMask=async(o:any)=>{written.push(o.imageData.values);};
    h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,1);assert.deepEqual([...written[0]],[...mask]);assert.deepEqual(h.selectionState().mask,selection.mask);
    h.click('apply');await h.wait();assert.equal(h.ps.app.activeDocument.layers.length,2,'reapply replaces the owned layer');
    mask[7*16+5]=0;h.click('apply');await h.wait();assert.equal(h.appliedLayers.length,2);assert.match(h.el('status').textContent,/历史|蒙版|范围/);
  }finally{await h.close();}
});

test('zero edge width keeps legacy mask semantics and does not persist expanded-mask authority',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.el('edge-blend').value='0';h.change('edge-blend');h.el('resolution').value='32';h.click('generate');await h.wait();
    const record=h.records()[0];assert.ok(record);assert.equal((record.snapshot as any).edgeBlend,undefined);assert.equal((record.params as any).edgeBlend,undefined);
    assert.equal(h.files[`${record.id}-subject-mask.bin`],undefined);
    h.el('edge-blend').value='8';h.selectHistory(record.id);await h.wait();h.click('repeat-history');await h.wait();assert.equal(h.el('edge-blend').value,'0','old parameters do not gain outward coverage');
  }finally{await h.close();}
});
