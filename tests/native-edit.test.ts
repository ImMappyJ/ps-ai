import test from 'node:test';import assert from 'node:assert/strict';
import {sampleEditStrip,nativeMaskStrip} from '../src/imaging/native-edit';
import {resize} from '../src/imaging/image';

test('strip sampling is seamless at native offsets and preserves straight alpha and fractional16 samples',()=>{
  const model={width:2,height:2,rgba:new Uint16Array([12345,23456,34567,65535,54321,32123,12345,32768,0,0,0,0,32769,44567,54321,65534])},bounds={left:13,top:9,right:813,bottom:509},expected=resize(model,800,500);
  for(const strip of [{left:13,top:9,right:813,bottom:336},{left:13,top:336,right:813,bottom:509}]){
    const result=sampleEditStrip(model,bounds,strip,16),start=(strip.top-bounds.top)*800*4;assert.deepEqual(result.rgba,expected.rgba.subarray(start,start+result.rgba.length));
  }
});
test('native strip and grayscale views reject whole45M RGBA allocation while retaining exact native coordinates',()=>{
  const bounds={left:4,top:8,right:9004,bottom:5008},strip={left:4,top:37,right:9004,bottom:66},mask=new Uint8Array(45_000_000);mask.fill(128,9000*29,9000*58);
  const gray=nativeMaskStrip(mask,bounds,strip);assert.equal(gray.length,9000*29);assert.ok(gray.every(v=>v===128));assert.equal(gray.buffer,mask.buffer);
  const pixels=sampleEditStrip({width:1,height:1,rgba:new Uint8Array([80,120,160,128])},bounds,strip,16);assert.equal(pixels.rgba.length,9000*29*4);assert.deepEqual([...pixels.rgba.subarray(0,4)],[20560,30840,41120,32896]);
  assert.throws(()=>sampleEditStrip({width:1,height:1,rgba:new Uint8Array(4)},bounds,bounds,8),/预算/);
});
