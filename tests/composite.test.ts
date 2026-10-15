import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareEditCandidate,retainSourceAlpha,alphaBounds} from '../src/composite';
import {Raster} from '../src/image';
const raster=(values:number[]):Raster=>({width:values.length/4,height:1,rgba:Uint8Array.from(values)});

test('编辑默认保留原透明及半透明轮廓，模型白底不能变成背景',()=>{
  const source=raster([40,50,60,0,80,90,100,128,120,130,140,255]);
  const generated=raster([255,255,255,255,10,20,30,255,60,70,80,255]);
  const result=prepareEditCandidate(generated,source,{preserveAlpha:true,align:false});
  assert.deepEqual([...result.rgba],[0,0,0,0,10,20,30,128,60,70,80,255]);
  assert.equal(generated.rgba[3],255);
});
test('生成图缺失像素保留原色，半透明生成色正确混合，关闭保透明支持改背景',()=>{
  const source=raster([80,90,100,255,100,150,200,255]);
  const generated=raster([0,0,0,0,200,50,100,128]);
  assert.deepEqual([...retainSourceAlpha(generated,source).rgba],[80,90,100,255,150,100,150,255]);
  assert.deepEqual(prepareEditCandidate(generated,source,{preserveAlpha:false,align:false}),generated);
});
test('透明主体缩小或偏移时按原主体坐标对齐，填满原轮廓',()=>{
  const source={width:8,height:8,rgba:new Uint8Array(256)},generated={width:8,height:8,rgba:new Uint8Array(256)};
  for(let y=1;y<7;y++)for(let x=1;x<7;x++)source.rgba.set([30,40,50,255],(y*8+x)*4);
  for(let y=2;y<5;y++)for(let x=2;x<5;x++)generated.rgba.set([100,120,140,255],(y*8+x)*4);
  const result=prepareEditCandidate(generated,source,{preserveAlpha:true,align:true});
  assert.deepEqual(alphaBounds(result),{left:1,top:1,right:7,bottom:7});
  for(let y=1;y<7;y++)for(let x=1;x<7;x++)assert.deepEqual([...result.rgba.slice((y*8+x)*4,(y*8+x)*4+4)],[100,120,140,255]);
});
test('边界匹配从未选中上下文计算，保持选中区域的新颜色关系',()=>{
  const source={width:12,height:12,rgba:new Uint8Array(576)},generated={width:12,height:12,rgba:new Uint8Array(576)},mask=new Uint8Array(144);
  for(let i=0;i<144;i++){source.rgba.set([80,100,120,255],i*4);generated.rgba.set([90,115,125,255],i*4);}
  mask[65]=255;generated.rgba.set([200,40,60,255],65*4);
  const result=prepareEditCandidate(generated,source,{preserveAlpha:true,align:false,matchColor:true,mask});
  assert.deepEqual([...result.rgba.slice(0,4)],[80,100,120,255]);
  assert.deepEqual([...result.rgba.slice(260,264)],[190,25,55,255]);
  mask.fill(255);assert.deepEqual(prepareEditCandidate(generated,source,{preserveAlpha:true,align:false,matchColor:true,mask}),generated);
});
test('无上下文、空主体或尺寸异常不进行危险的自动配准',()=>{
  const source=raster([10,20,30,255]),empty=raster([0,0,0,0]);
  assert.equal(alphaBounds(empty),undefined);
  assert.deepEqual(prepareEditCandidate(empty,source,{preserveAlpha:true,align:true}),source);
  assert.throws(()=>prepareEditCandidate({...empty,rgba:new Uint8Array(0)},source,{preserveAlpha:true,align:true}),/RGBA/);
});
