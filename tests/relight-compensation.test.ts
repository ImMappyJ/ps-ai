import test from 'node:test';
import assert from 'node:assert/strict';
import {decomposeRelightCompensation,relightCompensationAvailability,type RelightCompensationConditions} from '../src/features/relight/relight-compensation';
import type {Raster} from '../src/imaging/image';

const conditions:RelightCompensationConditions={colorSpace:'encoded-srgb',documentProfile:'sRGB IEC61966-2.1',
  blend:{order:'multiply-screen',opacity:1,fillOpacity:1,group:'isolated-with-base',gamma:'encoded-srgb',mask:'none'}};
const raster=(pixels:number[],depth:8|16=8):Raster=>({width:pixels.length/4,height:1,rgba:depth===8?Uint8Array.from(pixels):Uint16Array.from(pixels)});

test('neutral compensation uses white multiply and black screen with exact 8/16-bit reconstruction',()=>{
  for(const depth of [8,16] as const){const max=depth===8?255:65535,image=raster([0,max,max/3,max,max,0,123,max],depth),before=image.rgba.slice();
    const result=decomposeRelightCompensation(image,image,conditions);
    assert.deepEqual([...result.dark.rgba],[max,max,max,max,max,max,max,max]);assert.deepEqual([...result.light.rgba],[0,0,0,max,0,0,0,max]);
    assert.deepEqual(result.reconstructed,image);assert.deepEqual(image.rgba,before);assert.equal(result.error.code.maxAbs,0);
    assert.equal(result.error.code.meanAbs,0);assert.equal(result.error.code.rmse,0);assert.equal(result.error.normalized.maxAbs,0);
  }
});

test('black, white and mixed colored changes decompose and quantize in dark then light order',()=>{
  const base=raster([0,255,128,255,255,0,128,255]),target=raster([255,0,64,255,0,255,192,255]);
  const output=decomposeRelightCompensation(base,target,conditions);
  assert.deepEqual([...output.dark.rgba],[255,0,128,255,0,255,255,255]);
  assert.deepEqual([...output.light.rgba],[255,0,0,255,0,255,129,255]);
  assert.deepEqual(output.reconstructed,target);assert.equal(output.error.samples,6);assert.equal(output.error.code.maxAbs,0);
});

test('16-bit non-257 values survive compensation with a measured error at most one code value',()=>{
  const base=raster([12345,23456,34567,65535,65535,1,0,65535],16),target=raster([50123,1234,34568,65535,54321,2,65234,65535],16);
  const result=decomposeRelightCompensation(base,target,conditions);assert.ok(result.dark.rgba instanceof Uint16Array);
  assert.ok([...result.dark.rgba].some(v=>v%257!==0));assert.ok([...result.light.rgba].some(v=>v%257!==0));
  assert.ok(result.error.code.maxAbs<=1);assert.ok(result.error.normalized.maxAbs<=1/65535);
  let sum=0,squares=0,maximum=0;for(let i=0;i<target.rgba.length;i++)if(i%4!==3){const d=Math.abs(result.reconstructed.rgba[i]-target.rgba[i]);sum+=d;squares+=d*d;maximum=Math.max(maximum,d);}
  assert.equal(result.error.code.maxAbs,maximum);assert.equal(result.error.code.meanAbs,sum/6);assert.equal(result.error.code.rmse,Math.sqrt(squares/6));
  assert.equal(result.error.normalized.rmse,result.error.code.rmse/65535);
});

test('baseline rejects unaligned/depth/alpha/profile/unknown blend conditions with actionable errors',()=>{
  const image=raster([20,40,60,255]);
  assert.throws(()=>decomposeRelightCompensation(image,raster([20,40,60,255,20,40,60,255]),conditions),/dimensions|align|size/i);
  assert.throws(()=>decomposeRelightCompensation(image,raster([20,40,60,65535],16),conditions),/depth/i);
  assert.throws(()=>decomposeRelightCompensation({...image,rgba:new Uint8Array(3)},image,conditions),/RGBA|buffer/i);
  assert.throws(()=>decomposeRelightCompensation({...image,rgba:new Float32Array([NaN,0,0,1]) as any},image,conditions),/8|16|buffer/i);
  assert.throws(()=>decomposeRelightCompensation(raster([20,40,60,128]),image,conditions),/opaque|alpha/i);
  for(const documentProfile of ['','Adobe RGB (1998)','Display P3','unknown'])assert.throws(()=>decomposeRelightCompensation(image,image,{...conditions,documentProfile}),/sRGB|profile/i);
  for(const patch of [{order:'screen-multiply'},{opacity:.9},{fillOpacity:.5},{gamma:'linear'},{mask:'applied'},{group:'unknown'},{extra:1}]){
    assert.throws(()=>decomposeRelightCompensation(image,image,{...conditions,blend:{...conditions.blend,...patch}} as any),/blend|opacity|mask|gamma|order|group|unsupported/i);
  }
  assert.throws(()=>decomposeRelightCompensation(image,image,{...conditions,colorSpace:'linear-srgb'} as any),/encoded|space/i);
});

test('compensation apply remains unavailable until independent Photoshop composite and visual acceptance',()=>{
  const gate=relightCompensationAvailability();assert.equal(gate.available,false);assert.match(gate.reason,/Photoshop/i);assert.match(gate.reason,/visual/i);
});
