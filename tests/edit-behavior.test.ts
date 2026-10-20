import test from 'node:test';import assert from 'node:assert/strict';
import {editBehavior,editModelInput,backgroundCoverage} from '../src/features/editing/edit-behavior';
import {effectiveMask} from '../src/imaging/image';

test('background behavior omits only the ComfyUI visual guide and keeps provider masks',()=>{
  for(const mode of ['background','scene']){
    assert.deepEqual(editBehavior(mode,{guide:true,preserveAlpha:true,alignSubject:true}),{guide:false,preserveAlpha:false,alignSubject:false,matchColor:false});
    assert.deepEqual(editBehavior(mode,{guide:true,preserveAlpha:true,alignSubject:true},'gateway'),{guide:true,preserveAlpha:false,alignSubject:false,matchColor:false});
  }
  assert.deepEqual(editBehavior('edit',{guide:true,preserveAlpha:true,alignSubject:true}),{guide:true,preserveAlpha:true,alignSubject:true,matchColor:false});
  assert.deepEqual(editBehavior('remove',{guide:false,preserveAlpha:false,alignSubject:true}),{guide:false,preserveAlpha:false,alignSubject:false,matchColor:false});
});
test('Image Blending preserves source alpha without alignment or context color correction',()=>{
  assert.deepEqual(editBehavior('blend',{guide:true,preserveAlpha:true,alignSubject:true,matchColor:true}),{guide:false,preserveAlpha:true,alignSubject:false,matchColor:false});
  assert.deepEqual(editBehavior('blend',{guide:true,preserveAlpha:true,alignSubject:true,matchColor:true},'gateway'),{guide:true,preserveAlpha:true,alignSubject:false,matchColor:false});
  assert.deepEqual(editBehavior('costume',{guide:true,preserveAlpha:true,alignSubject:true,matchColor:true}),{guide:true,preserveAlpha:true,alignSubject:true,matchColor:true});
});
test('model-only background matte handles straight alpha at both depths and leaves capture pixels intact',()=>{
  for(const depth of [8,16]){
    const values=[10,20,30,0,50,100,150,128,40,80,120,255];
    const rgba=depth===8?new Uint8Array(values):Uint16Array.from(values,v=>v*257),saved=rgba.slice();
    const source={width:3,height:1,rgba};
    const input=editModelInput('background',source);
    assert.ok(input.rgba instanceof Uint8Array);assert.deepEqual([...input.rgba],[255,255,255,255,152,177,202,255,40,80,120,255]);assert.deepEqual(rgba,saved);
    assert.deepEqual([...editModelInput('costume',source).rgba],values);assert.notEqual(input.rgba,rgba);
  }
});
test('background completeness uses alpha and the feathered effective mask, excluding protected pixels',()=>{
  const mask=effectiveMask(new Uint8Array([255,128,255]),new Uint8Array([0,0,255]));
  for(const depth of [8,16]){
    const values=[0,0,0,255,12,34,56,128,0,0,0,0];
    const image={width:3,height:1,rgba:depth===8?new Uint8Array(values):Uint16Array.from(values,v=>v*257)};
    assert.ok(Math.abs(backgroundCoverage(image,mask)-(255+128*128/255)/383)<1e-12);
    assert.equal(backgroundCoverage(image,new Uint8Array(3)),1);
    assert.throws(()=>backgroundCoverage(image,new Uint8Array(2)),/尺寸/);
  }
});
