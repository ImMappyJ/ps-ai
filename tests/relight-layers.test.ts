import test from 'node:test';import assert from 'node:assert/strict';
import {deriveRelightLayers,previewRelightLayers,renderRelightLayerStrip} from '../src/features/relight/relight-layers';
import {createRelightScene,type RelightScene} from '../src/features/relight/relight-scene';
import type {Raster} from '../src/imaging/image';

const W=128,H=96;
function scene():RelightScene{return createRelightScene({documentId:7,layerIds:[1],sessionId:'s',historyId:3,sourceHash:'source',snapshotId:'snap',docWidth:W,docHeight:H,bounds:{left:0,top:0,right:W,bottom:H},profile:'sRGB IEC61966-2.1',documentMode:'rgb',documentDepth:8,maskRef:'mask'},'key');}
function image(pixel:(x:number,y:number)=>number|number[],depth:8|16=8):Raster{const rgba=depth===16?new Uint16Array(W*H*4):new Uint8Array(W*H*4),max=depth===16?65535:255;for(let y=0;y<H;y++)for(let x=0;x<W;x++){const value=pixel(x,y),v=Array.isArray(value)?value:[value,value,value];for(let c=0;c<3;c++)rgba[(y*W+x)*4+c]=v[c];rgba[(y*W+x)*4+3]=max;}return {width:W,height:H,rgba};}
function changed(source:Raster,transform:(v:number,x:number,y:number,c:number)=>number):Raster{return {...source,rgba:Uint8Array.from(source.rgba,(v,i)=>i%4===3?v:Math.round(Math.max(0,Math.min(255,transform(v,Math.floor(i/4)%W,Math.floor(Math.floor(i/4)/W),i%4)))))};}

test('neutral fields create no empty channels and preserve source detail/native16 sample values',async()=>{
  const source=image((x,y)=>12345+(x+y)%17,16),before=source.rgba.slice(),s=scene();s.source.documentDepth=16;
  const fields=await deriveRelightLayers(source,source,s);assert.equal(fields.channels.length,0);assert.deepEqual(previewRelightLayers(source,fields),source);assert.deepEqual(source.rgba,before);
});
test('the verified Photoshop RGBColorMode identity is supported without accepting arbitrary RGB prefixes',async()=>{
  const source=image(()=>180),s=scene();s.source.documentMode='RGBColorMode';assert.equal((await deriveRelightLayers(source,source,s)).channels.length,0);
  s.source.documentMode='RGBUnsupported';await assert.rejects(deriveRelightLayers(source,source,s),/sRGB/);
});
test('unchanged clipped black and white content stays neutral rather than inventing a shadow or lift',async()=>{
  const source=image((x)=>x<W/2?0:255),fields=await deriveRelightLayers(source,source,scene());assert.equal(fields.channels.length,0);assert.deepEqual(previewRelightLayers(source,fields),source);
});
test('Light and Shadow are independent bounded influence fields, never target photo pixels',async()=>{
  const source=image((x,y)=>110+((x+y)%2)*14),target=changed(source,(v,x)=>v*(x<W/2?.78:1.2)),s=scene();
  s.lights[0].type='directional';s.lights[0].direction=0;s.shadow.strength=1;
  const fields=await deriveRelightLayers(source,target,s),kinds=fields.channels.map(c=>c.kind);assert.ok(kinds.includes('light'));assert.ok(kinds.includes('shadow'));
  const preview=previewRelightLayers(source,fields),dark=(48*W+20)*4,light=(48*W+104)*4;
  assert.ok(preview.rgba[dark]<source.rgba[dark]);assert.ok(preview.rgba[light]>source.rgba[light]);
  for(const c of fields.channels)assert.ok(c.amount.length===W*H&&c.amount.every(v=>v>=0&&v<=1));
  const noLight={...fields,channels:fields.channels.filter(c=>c.kind!=='light')};assert.equal(previewRelightLayers(source,noLight).rgba[light],source.rgba[light]);
});
test('Color Atmosphere has alpha-controlled support and a measurable independent chroma effect',async()=>{
  const source=image(()=>[120,120,120]),target=changed(source,(v,_x,_y,c)=>v*(c===0?1.15:c===2?.9:1)),fields=await deriveRelightLayers(source,target,scene());
  assert.ok(fields.channels.some(c=>c.kind==='color-atmosphere'));
  const colorOnly={...fields,channels:fields.channels.filter(c=>c.kind==='color-atmosphere')},preview=previewRelightLayers(source,colorOnly);
  assert.ok(preview.rgba[0]>preview.rgba[2]);
  const strip=renderRelightLayerStrip(fields,fields.channels.find(c=>c.kind==='color-atmosphere')!,{left:0,top:0,right:W,bottom:H},{left:0,top:0,right:W,bottom:H},8);
  assert.ok(strip.rgba[3]>0&&strip.rgba[3]<255);
});
test('Cast Shadow uses an observed downstream receiver lobe and never crosses the explicit edit mask',async()=>{
  const source=image((x,y)=>x>=35&&x<65&&y>20&&y<75?90:180),target=changed(source,(v,x,y)=>x>=65&&x<85&&y>32&&y<66?v*.65:v),s=scene();s.lights[0].x=.05;s.lights[0].y=.5;s.lights[0].range=2;s.shadow.strength=1;
  const fields=await deriveRelightLayers(source,target,s),cast=fields.channels.find(c=>c.kind==='cast-shadow');assert.ok(cast);assert.ok(cast.amount[48*W+72]>0);assert.equal(cast.amount[48*W+25],0);
  const mask=new Uint8Array(W*H);for(let y=21;y<75;y++)mask.fill(255,y*W+35,y*W+65);
  const subjectOnly=await deriveRelightLayers(source,target,s,{editMask:mask});assert.equal(subjectOnly.channels.some(c=>c.kind==='cast-shadow'),false);
});
test('Rim Light needs a rim scene role and a real observed edge highlight',async()=>{
  const source=image((x,y)=>x>=35&&x<90&&y>15&&y<80?100:160),target=changed(source,(v,x,y)=>x>=35&&x<40&&y>18&&y<77?v*1.35:v),s=scene();s.lights[0].role='rim';s.lights[0].x=.05;s.lights[0].y=.5;s.lights[0].range=2;
  const fields=await deriveRelightLayers(source,target,s);assert.ok(fields.channels.some(c=>c.kind==='rim-light'));
  s.lights[0].role='key';assert.equal((await deriveRelightLayers(source,target,s)).channels.some(c=>c.kind==='rim-light'),false);
});
test('content/geometry disagreement fails instead of transferring changed high frequency texture',async()=>{
  const source=image((x,y)=>((Math.floor(x/3)+Math.floor(y/3))%2)?210:45),target=image((x,y)=>((Math.floor((x+3)/3)+Math.floor(y/3))%2)?210:45),before=source.rgba.slice();
  await assert.rejects(deriveRelightLayers(source,target,scene()),/结构|对齐|structure|alignment/i);assert.deepEqual(source.rgba,before);
});
test('new local H text is rejected as a whole even when its flat interior regains high local confidence',async()=>{
  const source=image(()=>180),target=changed(source,(v,x,y)=>y>=20&&y<=75&&(x>=40&&x<=47||x>=80&&x<=87)||x>=40&&x<=87&&y>=44&&y<=51?40:v),s=scene();s.shadow.strength=1;
  await assert.rejects(deriveRelightLayers(source,target,s),/结构|文字|纹理/);assert.equal(source.rgba[(48*W+64)*4],180);assert.equal(source.rgba[(30*W+44)*4],180);
});
test('local replaced structure cannot hide inside otherwise valid broad lighting or tint',async()=>{
  const source=image((x,y)=>140+((x+y)%2)*40),s=scene();s.shadow.strength=1;
  for(const replacement of ['flat','text','chroma']){
    const target=changed(source,(v,x,y,c)=>{
      const lit=v*(.88+.2*x/(W-1));
      if(replacement==='flat'&&x>=40&&x<88&&y>=20&&y<76)return 90;
      const letter=y>=20&&y<=75&&(x>=40&&x<=47||x>=80&&x<=87)||x>=40&&x<=87&&y>=44&&y<=51;
      if(letter&&replacement==='text')return 40;
      if(letter&&replacement==='chroma')return c===1?230:20;
      return lit;
    });
    await assert.rejects(deriveRelightLayers(source,target,s),/结构|文字|纹理/,replacement);
  }
});
test('new isoluminant colored text is rejected independently of luminance high-pass confidence',async()=>{
  const source=image(()=>180),target=changed(source,(v,x,y,c)=>y>=20&&y<=75&&(x>=40&&x<=47||x>=80&&x<=87)||x>=40&&x<=87&&y>=44&&y<=51?c===1?251:0:v);
  await assert.rejects(deriveRelightLayers(source,target,scene()),/结构|文字|纹理/);
});
test('genuine low-frequency illumination and colored atmosphere retain source high-frequency texture',async()=>{
  const source=image((x,y)=>120+((x+y)%2)*24),target=changed(source,(v,x,y,c)=>v*(.82+.28*x/(W-1)+.03*Math.sin(y/20))*(c===0?1.06:c===2?.96:1)),s=scene();s.shadow.strength=1;
  const fields=await deriveRelightLayers(source,target,s),preview=previewRelightLayers(source,fields);assert.ok(fields.channels.some(c=>c.kind==='light'));assert.ok(fields.channels.some(c=>c.kind==='shadow'));assert.ok(fields.channels.some(c=>c.kind==='color-atmosphere'));
  for(const [x,y] of [[20,30],[80,50]]){const p=(y*W+x)*4;assert.ok(preview.rgba[p+4]>preview.rgba[p],'the source checker texture remains the detail source');}
});
test('analysis work yields, honors cancellation and refuses non-sRGB numeric field conversion',async()=>{
  const source=image(()=>120),target=image(()=>140);let yields=0;const control=new AbortController();
  await assert.rejects(deriveRelightLayers(source,target,scene(),{signal:control.signal,yieldControl:async()=>{if(++yields===2)control.abort();}}),/取消|cancel/i);assert.ok(yields>=2);
  const s=scene();s.source.profile='Adobe RGB (1998)';await assert.rejects(deriveRelightLayers(source,target,s),/sRGB/);
});
