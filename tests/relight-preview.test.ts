import test from 'node:test';
import assert from 'node:assert/strict';
import {renderRelightPreview,prepareRelightPreview} from '../src/features/relight/relight-preview';
import {createRelightScene,type RelightSource} from '../src/features/relight/relight-scene';
import type {Raster} from '../src/imaging/image';

const sourceBinding=(width:number,height:number):RelightSource=>({documentId:1,layerIds:[2],sessionId:'a',historyId:3,sourceHash:'abcd',snapshotId:'snap',
  docWidth:width,docHeight:height,bounds:{left:0,top:0,right:width,bottom:height},profile:'sRGB IEC61966-2.1',documentMode:'RGBColor',documentDepth:8,maskRef:'mask'});
const fixture=(width=24,height=16):Raster=>({width,height,rgba:Uint8Array.from({length:width*height*4},(_,i)=>i%4===3?128:70)});
const sceneFor=(image:Raster)=>createRelightScene(sourceBinding(image.width,image.height),'key');
const render=(image:Raster,scene=sceneFor(image),mask=new Uint8Array(image.width*image.height).fill(255))=>renderRelightPreview(image,scene,mask);

test('preview limits longest edge, preserves crop aspect and alpha without modifying source or scene',async()=>{
  const original=fixture(1200,800),bytes=original.rgba.slice(),s=sceneFor(original),saved=JSON.stringify(s);
  const preview=await renderRelightPreview(original,s,new Uint8Array(960000).fill(255));
  assert.equal(preview.width,480);assert.equal(preview.height,320);assert.ok(preview.rgba instanceof Uint8Array);
  for(let i=3;i<preview.rgba.length;i+=4)assert.equal(preview.rgba[i],128);
  assert.deepEqual(original.rgba,bytes);assert.equal(JSON.stringify(s),saved);
  const tiny=await render(fixture(12,8));assert.equal(tiny.width,12);assert.equal(tiny.height,8);
  const capped=await renderRelightPreview(original,s,new Uint8Array(960000),{maxEdge:1024});assert.equal(capped.width,1024);
  await assert.rejects(renderRelightPreview(original,s,new Uint8Array(960000),{maxEdge:1025}),/maxEdge/i);
});

test('disabled lights with zero ambient are neutral and zero mask protects exact pixels',async()=>{
  const image=fixture(),s=sceneFor(image);s.lights[0].enabled=false;s.ambient.intensity=0;
  assert.deepEqual(await render(image,s),image);
  const active=sceneFor(image),mask=new Uint8Array(image.width*image.height);mask[0]=255;mask[1]=128;
  const result=await render(image,active,mask),full=await render(image,active);
  for(let i=8;i<image.rgba.length;i++)assert.equal(result.rgba[i],image.rgba[i]);
  for(let c=0;c<3;c++){
    const expected=Math.round(image.rgba[4+c]+(full.rgba[4+c]-image.rgba[4+c])*128/255);
    assert.ok(Math.abs(result.rgba[4+c]-expected)<=1,`gray mask channel ${c} must be applied once`);
  }
  assert.equal(result.rgba[3],128);assert.notDeepEqual([...result.rgba.slice(0,3)],[70,70,70]);
});

test('point position, range, relative depth, softness, intensity and temperature change the influence field',async()=>{
  const image=fixture(40,30),s=sceneFor(image);s.ambient.intensity=0;const baseline=await render(image,s);
  for(const patch of [{x:.8,y:.7},{range:.2},{z:-.7},{softness:0},{intensity:3},{color:{mode:'temperature' as const,kelvin:2500}},{color:{mode:'custom' as const,hex:'#2244FF'}}]){
    const changed=sceneFor(image);changed.ambient.intensity=0;Object.assign(changed.lights[0],patch);
    assert.notDeepEqual((await render(image,changed)).rgba,baseline.rgba,JSON.stringify(patch));
  }
  const warm=sceneFor(image);warm.lights[0].color={mode:'temperature',kelvin:2500};const output=await render(image,warm);
  assert.ok(output.rgba[0]>output.rgba[2]);
});

test('spot target and cone affect field while directional position never creates distance falloff',async()=>{
  const image=fixture(32,24),s=sceneFor(image);s.lights[0].type='spot';s.lights[0].z=.1;s.lights[0].cone=40;
  const initial=await render(image,s);s.lights[0].targetX=1;s.lights[0].targetY=.2;
  assert.notDeepEqual((await render(image,s)).rgba,initial.rgba);s.lights[0].cone=100;const wide=await render(image,s);assert.notDeepEqual(wide.rgba,initial.rgba);
  s.lights[0].type='directional';const directional=await render(image,s);Object.assign(s.lights[0],{x:2,y:-1,z:-1,range:.05});
  assert.deepEqual((await render(image,s)).rgba,directional.rgba);s.lights[0].direction=-90;
  assert.notDeepEqual((await render(image,s)).rgba,directional.rgba);
  s.lights[0].enabled=false;s.ambient={intensity:1,color:'#0000FF'};const ambient=await render(image,s);
  assert.ok(ambient.rgba[2]>ambient.rgba[0]);
});

test('a spot aimed at its own zero-depth position still has a finite meaningful cone',async()=>{
  const image=fixture(40,30),s=sceneFor(image);s.ambient.intensity=0;
  Object.assign(s.lights[0],{type:'spot',x:.5,y:.5,z:0,targetX:.5,targetY:.5,cone:10});
  const narrow=await render(image,s);s.lights[0].cone=150;const wide=await render(image,s);
  assert.notDeepEqual(wide.rgba,narrow.rgba);
});

test('a fully protected downsample is the unchanged alpha-aware resized original',async()=>{
  const image:Raster={width:2,height:2,rgba:new Uint8Array([0,0,0,255,255,0,0,255,0,255,0,255,0,0,255,255])};
  const protectedPreview=await renderRelightPreview(image,sceneFor(image),new Uint8Array(4),{maxEdge:1});
  assert.deepEqual([...protectedPreview.rgba],[64,64,64,255]);
});

test('transparent editable samples cannot illuminate protected visible samples after downsampling',async()=>{
  for(const depth of [8,16]){
    const scale=depth===16?257:1,image:Raster={width:2,height:1,rgba:depth===16?
      new Uint16Array([70*scale,70*scale,70*scale,0,70*scale,70*scale,70*scale,255*scale]):
      new Uint8Array([70,70,70,0,70,70,70,255])};
    const s=sceneFor(image);s.lights=[];s.ambient={intensity:1,color:'#FFFFFF'};
    const actual=await renderRelightPreview(image,s,new Uint8Array([255,0]),{maxEdge:1});
    assert.deepEqual([...actual.rgba],[70,70,70,128],`depth ${depth}`);
  }
});

test('downsampled gray mask follows visible alpha contribution without squaring mask or alpha',async()=>{
  const image:Raster={width:2,height:1,rgba:new Uint8Array([70,70,70,128,70,70,70,255])};
  const s=sceneFor(image);s.lights=[];s.ambient={intensity:1,color:'#FFFFFF'};
  const mixed=await renderRelightPreview(image,s,new Uint8Array([128,0]),{maxEdge:1});
  // Half each pixel: alpha=(128+255)/2=191.5. Visible mask=(128*128)/(128+255)=42.78/255,
  // about 1/6 coverage, not the geometric 1/4 or another multiplication by alpha.
  assert.deepEqual([...mixed.rgba],[85,85,85,192]);
  const sameAlpha:Raster={width:2,height:1,rgba:new Uint8Array([70,70,70,128,70,70,70,128])};
  const uniform=sceneFor(sameAlpha);uniform.lights=[];uniform.ambient={intensity:1,color:'#FFFFFF'};
  assert.deepEqual([...(await renderRelightPreview(sameAlpha,uniform,new Uint8Array([128,128]),{maxEdge:1})).rgba],[114,114,114,128]);
});

test('preview converts a separate 16-bit buffer to sRGB8 and rejects malformed rasters or masks',async()=>{
  const image:Raster={width:1,height:1,rgba:new Uint16Array([12345,23456,34567,32769])},s=sceneFor(image);s.lights=[];s.ambient.intensity=0;
  const result=await render(image,s);assert.deepEqual([...result.rgba],[48,91,135,128]);assert.ok(image.rgba instanceof Uint16Array);
  await assert.rejects(render({...image,width:0},s),/dimensions|size/i);
  await assert.rejects(render({...image,rgba:new Uint8Array(3)},s),/RGBA|buffer/i);
  await assert.rejects(render(image,s,new Uint8Array(2)),/mask/i);
  await assert.rejects(render({...image,rgba:new Float32Array([NaN,2,3,4]) as any},s),/8|16|buffer/i);
});

test('preview yields in chunks, can abort before work or after yield and snapshots mutable inputs',async()=>{
  const image=fixture(128,128),s=sceneFor(image),mask=new Uint8Array(16384).fill(255);let abort=false,yields=0;
  await assert.rejects(renderRelightPreview(image,s,mask,{cancelled:()=>true}),{name:'AbortError'});
  await assert.rejects(renderRelightPreview(image,s,mask,{cancelled:()=>abort,yield:async()=>{yields++;abort=true;}}),{name:'AbortError'});
  assert.ok(yields>0);
  const expected=await render(image,s,mask);let changed=false;
  const actual=await renderRelightPreview(image,s,mask,{yield:async()=>{if(!changed){changed=true;s.lights[0].intensity=4;mask.fill(0);image.rgba.fill(0);}}});
  assert.deepEqual(actual,expected);
});

test('prepared preview exposes an isolated alpha-compatible small image and byte mask usable by render',async()=>{
  const prepare=prepareRelightPreview;
  const image:Raster={width:2,height:1,rgba:new Uint8Array([70,70,70,128,70,70,70,255])},mask=new Uint8Array([128,0]);
  const cache=prepare(image,mask,{maxEdge:1});
  assert.deepEqual([...cache.image.rgba],[70,70,70,192]);assert.ok(cache.mask instanceof Uint8Array);assert.deepEqual([...cache.mask],[43]);
  const s=sceneFor(image);s.lights=[];s.ambient={intensity:1,color:'#FFFFFF'};
  const direct=await renderRelightPreview(image,s,mask,{maxEdge:1});
  const fromCache=await renderRelightPreview(cache.image,s,cache.mask);
  assert.deepEqual(fromCache,direct);assert.deepEqual([...fromCache.rgba],[85,85,85,192]);
  cache.image.rgba.fill(0);cache.mask.fill(0);assert.deepEqual([...image.rgba],[70,70,70,128,70,70,70,255]);assert.deepEqual([...mask],[128,0]);
});

test('prepared preview handles native 16-bit independently, has a no-resize copy path and can abort',()=>{
  const prepare=prepareRelightPreview;
  const image:Raster={width:1,height:1,rgba:new Uint16Array([12345,23456,34567,32769])},mask=new Uint8Array([128]);
  const cache=prepare(image,mask);assert.deepEqual([...cache.image.rgba],[48,91,135,128]);assert.deepEqual([...cache.mask],[128]);
  assert.notEqual(cache.image.rgba,image.rgba);assert.notEqual(cache.mask,mask);assert.ok(image.rgba instanceof Uint16Array);
  assert.throws(()=>prepare(image,mask,{cancelled:()=>true}),{name:'AbortError'});
  assert.throws(()=>prepare(image,mask,{maxEdge:1025}),/maxEdge/i);
});
