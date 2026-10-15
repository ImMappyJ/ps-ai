import test from 'node:test';
import assert from 'node:assert/strict';
import {effectiveMask,makeMapping,encodePng,decodePng,expandPixels,resize} from '../src/image';

test('保护区与灰度羽化逐像素相乘，完整保护为零',()=>{
  assert.deepEqual([...effectiveMask(new Uint8Array([0,255,128,255]),new Uint8Array([0,255,128,64]))],[0,0,64,191]);
  assert.throws(()=>effectiveMask(new Uint8Array(2),new Uint8Array(1)));
});
test('非零偏移和窄长区域映射为合法模型尺寸，不改变回填边界',()=>{
  const bounds={left:19,top:27,right:119,bottom:227};
  assert.deepEqual(makeMapping(bounds,992),{bounds,width:704,height:1408});
  assert.equal(makeMapping({left:0,top:0,right:1,bottom:999},768).width,32);
  assert.throws(()=>makeMapping({...bounds,right:19},992));
});
test('PNG 编解码保留透明和半透明 RGB 值，不预乘 alpha',()=>{
  const image={width:2,height:1,rgba:new Uint8Array([250,8,6,0,10,120,240,128])};
  assert.deepEqual(decodePng(encodePng(image)),image);
});
test('透明裁边与缓存坐标还原到请求区域，不左移内容',()=>{
  const actual={left:6,top:11,right:7,bottom:12};
  const requested={left:10,top:20,right:16,bottom:26};
  const out=expandPixels({width:1,height:1,rgba:new Uint8Array([100,80,60,255])},actual,requested,1);
  assert.equal(out.width,6); assert.equal(out.height,6);
  assert.deepEqual([...out.rgba.slice((2*6+2)*4,(2*6+2)*4+4)],[100,80,60,255]);
  assert.equal(out.rgba[3],0);
});
test('缩放 RGBA 时隐藏红色不污染半透明蓝色边缘',()=>{
  const image={width:2,height:1,rgba:new Uint8Array([255,0,0,0,0,0,255,255])};
  const out=resize(image,3,1);
  assert.deepEqual([...out.rgba.slice(4,8)],[0,0,255,128]);
});
