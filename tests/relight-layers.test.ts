import test from 'node:test';import assert from 'node:assert/strict';
import {deriveRelightLayers,previewRelightLayers,renderRelightLayerStrip,RelightExtractionError,type RelightLayerFields} from '../src/features/relight/relight-layers';
import * as extractionApi from '../src/features/relight/relight-layers';
import {createRelightScene,type RelightScene} from '../src/features/relight/relight-scene';
import {resize,convertDepth,type Raster} from '../src/imaging/image';
import {createHash} from 'node:crypto';

const W=128,H=96;
function scene():RelightScene{return createRelightScene({documentId:7,layerIds:[1],sessionId:'s',historyId:3,sourceHash:'source',snapshotId:'snap',docWidth:W,docHeight:H,bounds:{left:0,top:0,right:W,bottom:H},profile:'sRGB IEC61966-2.1',documentMode:'rgb',documentDepth:8,maskRef:'mask'},'key');}
function image(pixel:(x:number,y:number)=>number|number[],depth:8|16=8):Raster{const rgba=depth===16?new Uint16Array(W*H*4):new Uint8Array(W*H*4),max=depth===16?65535:255;for(let y=0;y<H;y++)for(let x=0;x<W;x++){const value=pixel(x,y),v=Array.isArray(value)?value:[value,value,value];for(let c=0;c<3;c++)rgba[(y*W+x)*4+c]=v[c];rgba[(y*W+x)*4+3]=max;}return {width:W,height:H,rgba};}
function changed(source:Raster,transform:(v:number,x:number,y:number,c:number)=>number):Raster{return {...source,rgba:Uint8Array.from(source.rgba,(v,i)=>i%4===3?v:Math.round(Math.max(0,Math.min(255,transform(v,Math.floor(i/4)%W,Math.floor(Math.floor(i/4)/W),i%4)))))};}
function peak(fields:RelightLayerFields):number{return Math.max(0,...fields.channels.map(c=>c.amount.reduce((a,b)=>Math.max(a,b),0)));}
function maxInteriorStep(fields:RelightLayerFields):number{let largest=0;for(const c of fields.channels)for(let y=16;y<H-16;y++)for(let x=16;x<W-17;x++){const p=y*W+x;largest=Math.max(largest,Math.abs(c.amount[p+1]-c.amount[p]),Math.abs(c.amount[p+W]-c.amount[p]));}return largest;}
function maxCompositeStep(image:Raster):number{let largest=0;for(let y=16;y<H-16;y++)for(let x=16;x<W-17;x++)for(let c=0;c<3;c++){const p=(y*W+x)*4+c;largest=Math.max(largest,Math.abs(image.rgba[p+4]-image.rgba[p]),Math.abs(image.rgba[p+W*4]-image.rgba[p]));}return largest;}

test('shared extraction preserves the prior default relight fields and native preview samples exactly',async()=>{
  // Captured before extracting the shared numeric core: model-grid sampling,
  // feather support, RGB ratios and lamp channel decomposition at both depths.
  for(const [depth,expected] of [[8,'7ca51438197789e85c62229ee7f33eb85e262baefbc192f5a2825d23c3446a50'],[16,'eb2d1c729f15facf5771f65abfc05b59d28685f572300c6707540b8d10d3cb9e']] as const){
    const max=depth===16?65535:255,source=image((x,y)=>[0,1,2].map(c=>Math.round(max*(.25+((x*(13+c*2)+y*(7+c*3))%100)/220))),depth),model=resize(source,120,90),target={...model,rgba:model.rgba.map((v,i)=>i%4===3?v:Math.round(Math.min(max,v*(.72+.55*(Math.floor(i/4)%120)/119)*(i%4===0?1.12:i%4===2?.85:1))))},s=scene();
    s.source.documentDepth=depth;s.lights[0].role='rim';s.shadow.strength=1;const mask=new Uint8Array(W*H);for(let y=5;y<91;y++)mask.fill(192,y*W+7,y*W+117);
    const fields=await deriveRelightLayers(source,target,s,{editMask:mask}),hash=createHash('sha256');hash.update(new Uint8Array(fields.guide.buffer));
    for(const channel of fields.channels){hash.update(channel.kind);hash.update(new Uint8Array(channel.amount.buffer));hash.update(new Uint8Array(channel.rgbAmount!.buffer));}
    hash.update(new Uint8Array(previewRelightLayers(source,fields).rgba.buffer));assert.equal(hash.digest('hex'),expected);
  }
});

test('RGB transfer retains strong broad red and blue lighting rather than compressing the tint',async()=>{
  const source=image(()=>[120,120,120]),target=image(()=>[202,141,67]);
  const fields=await deriveRelightLayers(source,target,scene()),preview=previewRelightLayers(source,fields);
  for(let c=0;c<3;c++)assert.ok(Math.abs(preview.rgba[c]-target.rgba[c])<=3,`channel ${c}: ${preview.rgba[c]} versus ${target.rgba[c]}`);
  assert.equal(fields.summary.method,'rgb-guided-v2');
});

test('middle-scale colored shading survives while original high-frequency details stay visible',async()=>{
  const source=image((x,y)=>105+((x+y)%2)*28),target=changed(source,(v,x,_y,c)=>v*(1+Math.exp(-(((x-64)/17)**2))*(c===0?.48:c===1?-.18:-.42)));
  const fields=await deriveRelightLayers(source,target,scene()),preview=previewRelightLayers(source,fields);
  for(const x of [56,64,72])for(let c=0;c<3;c++){const p=(48*W+x)*4+c;assert.ok(Math.abs(preview.rgba[p]-target.rgba[p])<8,`${x},${c}: ${preview.rgba[p]} versus ${target.rgba[p]}`);}
  assert.ok(preview.rgba[(48*W+65)*4]>preview.rgba[(48*W+64)*4]+20);
});

test('local fidelity can disable or continuously reduce the saved reference transfer',async()=>{
  const source=image(()=>[120,120,120]),target=image(()=>[190,145,70]),s=scene();
  const run=async(fidelity:number)=>previewRelightLayers(source,await deriveRelightLayers(source,target,s,{extraction:{fidelity,detailProtection:.65}} as any));
  assert.ok((await run(0)).rgba.every((v,i)=>v===source.rgba[i]),'zero fidelity keeps every native source sample');const half=await run(.5),full=await run(1);
  assert.ok(half.rgba[0]>120&&half.rgba[0]<full.rgba[0]);assert.ok(half.rgba[2]<120&&half.rgba[2]>full.rgba[2]);
});

test('detail protection reduces a narrow reference redraw without discarding broad colored light',async()=>{
  const source=image(()=>120),target=changed(source,(v,x,_y,c)=>v*(c===0?1.3:1)+(x>=61&&x<=66?50:0));
  const run=async(detailProtection:number)=>previewRelightLayers(source,await deriveRelightLayers(source,target,scene(),{extraction:{fidelity:1,detailProtection}} as any));
  const loose=await run(0),protectedDetail=await run(1),p=(48*W+64)*4;
  assert.ok(loose.rgba[p+1]>protectedDetail.rgba[p+1]+5);assert.ok(protectedDetail.rgba[0]>145);
});

test('local extraction settings default only when absent and reject malformed or unknown fields',()=>{
  const validate=(extractionApi as any).validateRelightExtractionSettings;assert.equal(typeof validate,'function');
  assert.deepEqual(validate(),{fidelity:1,detailProtection:.65});assert.deepEqual(validate({fidelity:0,detailProtection:1}),{fidelity:0,detailProtection:1});
  for(const bad of [null,[],{},1,{fidelity:1},{fidelity:1,detailProtection:NaN},{fidelity:-.1,detailProtection:0},{fidelity:1,detailProtection:1.1},{fidelity:1,detailProtection:.5,extra:true}])assert.throws(()=>validate(bad));
});

test('RGB strips reproduce the local composite at native depth and retain legacy scalar fields',async()=>{
  for(const depth of [8,16] as const){
    const source=depth===8?image(()=>[120,150,80]):image(()=>[30001,22003,17005],16),target=depth===8?image(()=>[190,80,140]):image(()=>[45000,11000,31000],16),s=scene();s.source.documentDepth=depth;
    const fields=await deriveRelightLayers(source,target,s),preview=previewRelightLayers(source,fields),max=depth===16?65535:255,out=source.rgba.slice();
    for(const channel of fields.channels){const strip=renderRelightLayerStrip(fields,channel,{left:0,top:0,right:W,bottom:H},{left:0,top:0,right:W,bottom:H},depth);assert.notEqual(strip.rgba[0],strip.rgba[1],'colored fields need RGB strip samples');
      for(let p=0;p<W*H;p++)for(let c=0;c<3;c++){const b=out[p*4+c]/max,f=strip.rgba[p*4+c]/max;out[p*4+c]=Math.round(max*(channel.blendMode==='multiply'?b*f:1-(1-b)*(1-f)));}
    }
    for(let p=0;p<out.length;p++)assert.ok(Math.abs(out[p]-preview.rgba[p])<=1,`depth ${depth}, sample ${p}`);
    const legacy={...fields,channels:[{kind:'shadow' as const,blendMode:'multiply' as const,amount:new Float32Array(W*H).fill(.25),energy:.25}]};
    assert.equal(previewRelightLayers(source,legacy).rgba[0],Math.round(source.rgba[0]*.75));
  }
});

test('RGB channel samples remain authoritative when a legacy scalar support is zero',async()=>{
  const source=image(()=>120),fields=await deriveRelightLayers(source,image(()=>[180,150,130]),scene());
  const channel=fields.channels.find(c=>c.kind==='light')!;channel.amount.fill(0);
  const preview=previewRelightLayers(source,fields),strip=renderRelightLayerStrip(fields,channel,{left:0,top:0,right:W,bottom:H},{left:0,top:0,right:W,bottom:H},8);
  assert.ok(preview.rgba[0]>source.rgba[0]);assert.ok(strip.rgba[0]>strip.rgba[1]);
});

test('malformed RGB planes and RGB data attached to legacy COLOR are rejected before preview',async()=>{
  const source=image(()=>120),fields=await deriveRelightLayers(source,image(()=>[180,140,130]),scene()),channel=fields.channels.find(c=>c.kind==='light')!;
  for(const bad of [new Uint8Array(W*H*3),new Float32Array(3),new Float32Array(W*H*3).fill(NaN),new Float32Array(W*H*3).fill(1.1)]){
    const invalid={...fields,channels:[{...channel,rgbAmount:bad}]};assert.throws(()=>previewRelightLayers(source,invalid as any),/RGB/);
  }
  const color={kind:'color-atmosphere' as const,blendMode:'color' as const,amount:new Float32Array(W*H).fill(.2),color:new Float32Array(W*H*3).fill(.6),rgbAmount:new Float32Array(W*H*3).fill(.2),energy:.2};
  assert.throws(()=>previewRelightLayers(source,{...fields,channels:[color]}),/RGB/);
});

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
test('legacy Color Atmosphere retains alpha-controlled support and its independent chroma effect',async()=>{
  const source=image(()=>[120,120,120]),fields=await deriveRelightLayers(source,source,scene());
  const color=new Float32Array(W*H*3);for(let p=0;p<W*H;p++)color.set([.7,.5,.35],p*3);
  fields.channels=[{kind:'color-atmosphere',blendMode:'color',amount:new Float32Array(W*H).fill(.35),color,energy:.35}];fields.summary.method='soft-guided-v1';
  const preview=previewRelightLayers(source,fields);
  assert.ok(preview.rgba[0]>preview.rgba[2]);
  const strip=renderRelightLayerStrip(fields,fields.channels.find(c=>c.kind==='color-atmosphere')!,{left:0,top:0,right:W,bottom:H},{left:0,top:0,right:W,bottom:H},8);
  assert.ok(strip.rgba[3]>0&&strip.rgba[3]<255);
});
test('Cast Shadow labels observed broad downstream darkness and never crosses the explicit edit mask',async()=>{
  const source=image((x,y)=>x>=35&&x<65&&y>20&&y<75?90:180),target=changed(source,(v,x,y)=>x>=65&&x<85&&y>32&&y<66?v*.65:v),s=scene();s.lights[0].x=.05;s.lights[0].y=.5;s.lights[0].range=2;s.shadow.strength=1;
  const fields=await deriveRelightLayers(source,target,s),cast=fields.channels.find(c=>c.kind==='cast-shadow');assert.ok(cast);assert.ok(cast.amount[48*W+80]>0);assert.equal(cast.amount[48*W+25],0);
  const mask=new Uint8Array(W*H);for(let y=21;y<75;y++)mask.fill(255,y*W+35,y*W+65);
  const subjectOnly=await deriveRelightLayers(source,target,s,{editMask:mask});assert.equal(subjectOnly.channels.some(c=>c.kind==='cast-shadow'),false);
});
test('Rim Light needs a rim scene role and a real observed edge highlight',async()=>{
  const source=image((x,y)=>x>=35&&x<90&&y>15&&y<80?100:160),target=changed(source,(v,x,y)=>x>=35&&x<40&&y>18&&y<77?v*1.35:v),s=scene();s.lights[0].role='rim';s.lights[0].x=.05;s.lights[0].y=.5;s.lights[0].range=2;
  const fields=await deriveRelightLayers(source,target,s);assert.ok(fields.channels.some(c=>c.kind==='rim-light'));
  s.lights[0].role='key';assert.equal((await deriveRelightLayers(source,target,s)).channels.some(c=>c.kind==='rim-light'),false);
});
test('shifted fine texture yields weak smooth fields while the original supplies all detail',async()=>{
  const source=image((x,y)=>((Math.floor(x/3)+Math.floor(y/3))%2)?210:45),target=image((x,y)=>((Math.floor((x+3)/3)+Math.floor(y/3))%2)?210:45),before=source.rgba.slice();
  const fields=await deriveRelightLayers(source,target,scene());assert.ok(peak(fields)<.13);assert.ok(maxInteriorStep(fields)<.003);assert.deepEqual(source.rgba,before);
  const preview=previewRelightLayers(source,fields);assert.ok(preview.rgba[(48*W+33)*4]>preview.rgba[(48*W+30)*4]+120,'reference texture must not replace the original checker');
});
test('a changed reference boundary becomes a soft bounded field without replacing original content',async()=>{
  const source=image(()=>180),target=changed(source,(v,x,y)=>y>=20&&y<=75&&(x>=40&&x<=47||x>=80&&x<=87)||x>=40&&x<=87&&y>=44&&y<=51?40:v),s=scene();s.shadow.strength=1;
  const fields=await deriveRelightLayers(source,target,s),preview=previewRelightLayers(source,fields);assert.ok(fields.channels.length>0);assert.ok(peak(fields)<1);assert.ok(maxCompositeStep(preview)<35);assert.equal(source.rgba[(30*W+44)*4],180);
  assert.ok(preview.rgba[(30*W+40)*4]>target.rgba[(30*W+40)*4]+20,'a reference glyph boundary is softened instead of copied');
});
test('local reference replacements do not gate otherwise valid broad lighting or tint',async()=>{
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
    const fields=await deriveRelightLayers(source,target,s);assert.ok(fields.channels.length>0,replacement);assert.ok(fields.channels.every(c=>c.amount.every(Number.isFinite)),replacement);
  }
});
test('isoluminant reference boundaries produce bounded smooth color rather than a content rejection',async()=>{
  const source=image(()=>180),target=changed(source,(v,x,y,c)=>y>=20&&y<=75&&(x>=40&&x<=47||x>=80&&x<=87)||x>=40&&x<=87&&y>=44&&y<=51?c===1?251:0:v);
  const fields=await deriveRelightLayers(source,target,scene()),preview=previewRelightLayers(source,fields),p=(48*W+44)*4;
  assert.ok(fields.channels.some(c=>c.rgbAmount));assert.ok(preview.rgba[p+1]>preview.rgba[p]);assert.ok(peak(fields)<1);assert.ok(maxCompositeStep(preview)<35);
});
test('genuine low-frequency illumination and colored atmosphere retain source high-frequency texture',async()=>{
  const source=image((x,y)=>120+((x+y)%2)*24),target=changed(source,(v,x,y,c)=>v*(.82+.28*x/(W-1)+.03*Math.sin(y/20))*(c===0?1.06:c===2?.96:1)),s=scene();s.shadow.strength=1;
  const fields=await deriveRelightLayers(source,target,s),preview=previewRelightLayers(source,fields);assert.ok(fields.channels.some(c=>c.kind==='light'));assert.ok(fields.channels.some(c=>c.kind==='shadow'));assert.ok(fields.channels.some(c=>c.rgbAmount));
  for(const [x,y] of [[20,30],[80,50]]){const p=(y*W+x)*4;assert.ok(preview.rgba[p+4]>preview.rgba[p],'the source checker texture remains the detail source');}
});
test('analysis work yields, honors cancellation and refuses non-sRGB numeric field conversion',async()=>{
  const source=image(()=>120),target=image(()=>140);let yields=0;const control=new AbortController();
  await assert.rejects(deriveRelightLayers(source,target,scene(),{signal:control.signal,yieldControl:async()=>{if(++yields===2)control.abort();}}),/取消|cancel/i);assert.ok(yields>=2);
  const s=scene();s.source.profile='Adobe RGB (1998)';await assert.rejects(deriveRelightLayers(source,target,s),/sRGB/);
});

test('native16 texture beside nearly white gradients has finite identity confidence despite filter roundoff',async()=>{
  const source=image((x,y)=>x<33?(x+y)%2?65500:2000:65500+x%30,16),s=scene();s.source.documentDepth=16;
  const fields=await deriveRelightLayers(source,convertDepth(convertDepth(source,8),16),s);assert.equal(fields.summary.method,'rgb-guided-v2');assert.equal(fields.channels.length,0);
});

test('negative variance roundoff cannot poison native16 shadow channels after confidence calculation',async()=>{
  const source=image((x,y)=>x<33?(x+y)%2?65500:2000:65500+x%30,16),target={...source,rgba:Uint16Array.from(source.rgba,(v,i)=>i%4===3?v:Math.round(v*.9))},s=scene();s.source.documentDepth=16;s.shadow.strength=1;
  const fields=await deriveRelightLayers(source,target,s);assert.ok(fields.channels.some(c=>c.kind==='shadow'));assert.ok(fields.channels.every(c=>c.amount.every(Number.isFinite)));
});

test('known smooth illumination on dark colored texture survives integer quantization without importing texture',async()=>{
  const source=image((x,y)=>[8+(x*13+y*7)%80,15+(x*5+y*11)%100,20+(x*17+y*3)%150]);
  const target=changed(source,(v,x,_y,c)=>v*(.82+.28*x/(W-1))*(c===0?1.06:c===2?.96:1)),fields=await deriveRelightLayers(source,target,scene());
  assert.equal(fields.summary.method,'rgb-guided-v2');assert.ok(fields.channels.length>0);
  const preview=previewRelightLayers(source,fields);assert.ok(preview.rgba.some((v,i)=>i%4!==3&&v!==source.rgba[i]));
});

test('smooth lighting across black and clipped highlights does not create boundaries from a logarithm floor',async()=>{
  const source=image((x,y)=>[(x*13+y*7)%256,(x*5+y*11)%256,(x*17+y*3)%256]),target=changed(source,(v,x,_y,c)=>v*(.82+.28*x/(W-1))*(c===0?1.06:c===2?.96:1));
  const fields=await deriveRelightLayers(source,target,scene());assert.ok(fields.channels.length>0);assert.equal(fields.summary.method,'rgb-guided-v2');
});

test('known model input resampling is neutral rather than an unsupported new boundary',async()=>{
  const source=image((x,y)=>(x+y)%2?[35,120,220]:[210,65,12]),target=resize(source,120,90);
  const fields=await deriveRelightLayers(source,target,scene());assert.equal(fields.summary.method,'rgb-guided-v2');assert.equal(fields.channels.length,0);
});

test('normal model-grid lighting retains usable fields after interpolation of quantized colored texture',async()=>{
  const source=image((x,y)=>[(x*13+y*7)%256,(x*5+y*11)%256,(x*17+y*3)%256]),model=resize(source,120,90);
  const target={...model,rgba:Uint8Array.from(model.rgba,(v,i)=>i%4===3?v:Math.round(Math.min(255,v*(.82+.28*(Math.floor(i/4)%120)/119)*(i%4===0?1.06:i%4===2?.96:1))))};
  const s=scene();s.shadow.strength=1;const fields=await deriveRelightLayers(source,target,s);
  assert.ok(fields.channels.some(c=>c.kind==='shadow'||c.kind==='light'));assert.ok(fields.channels.every(c=>c.amount.every(Number.isFinite)));
});

test('native16 source remains neutral through same-size and upsampled 8/16-bit model outputs without losing native preview values',async()=>{
  const source=image((x,y)=>[(x*1301+y*701)%65536,(x*509+y*1103)%65536,(x*1709+y*307)%65536],16),s=scene();s.source.documentDepth=16;
  for(const [width,height] of [[W,H],[256,192]])for(const depth of [8,16] as const){
    const output=convertDepth(convertDepth(resize(source,width,height),8),depth),fields=await deriveRelightLayers(source,output,s);
    assert.equal(fields.summary.method,'rgb-guided-v2');assert.equal(fields.channels.length,0);assert.deepEqual(previewRelightLayers(source,fields),source);
  }
});

test('same-size SDR16 neutral output compares to the uploaded sRGB8 source while preserving native source samples',async()=>{
  const source=image((x,y)=>[(x*1301+y*701)%65536,(x*509+y*1103)%65536,(x*1709+y*307)%65536],16),before=source.rgba.slice(),s=scene();s.source.documentDepth=16;
  const output=convertDepth(convertDepth(source,8),16),fields=await deriveRelightLayers(source,output,s);
  assert.equal(fields.summary.method,'rgb-guided-v2');assert.equal(fields.channels.length,0);assert.deepEqual(previewRelightLayers(source,fields),source);assert.deepEqual(source.rgba,before);
});

test('sRGB8 input projection cannot turn native16 semitransparency into an opaque editable source',async()=>{
  const source=image(()=>12000,16),s=scene();s.source.documentDepth=16;for(let i=3;i<source.rgba.length;i+=4)source.rgba[i]=65534;
  await assert.rejects(deriveRelightLayers(source,convertDepth(convertDepth(source,8),16),s),/结构|透明/);
});

test('a genuine frame-spanning colored shadow retains independent RGB attenuation',async()=>{
  const source=image(()=>180),target=changed(source,(v,x,_y,c)=>x<W/2?v*(c===0?.65:c===1?.8:.9):v),s=scene();s.shadow.strength=1;
  const fields=await deriveRelightLayers(source,target,s);assert.ok(fields.channels.some(c=>c.kind==='shadow'&&c.rgbAmount));
  const preview=previewRelightLayers(source,fields),p=(48*W+20)*4;assert.ok(preview.rgba[p]<preview.rgba[p+1]&&preview.rgba[p+1]<preview.rgba[p+2]);
  for(let c=0;c<3;c++)assert.ok(Math.abs(preview.rgba[p+c]-target.rgba[p+c])<3);
});

test('resampled black or colored reference boundaries succeed as bounded soft lighting',async()=>{
  const source=image(()=>180),model=resize(source,120,90);
  for(const colored of [false,true]){
    const target={...model,rgba:Uint8Array.from(model.rgba,(v,i)=>{
      if(i%4===3)return v;const x=Math.floor(i/4)%120,y=Math.floor(Math.floor(i/4)/120),letter=y>=20&&y<=70&&(x>=35&&x<=42||x>=75&&x<=82)||x>=35&&x<=82&&y>=42&&y<=49;
      return letter?(colored?i%4===1?251:0:0):v;
    })};
    const fields=await deriveRelightLayers(source,target,scene());assert.ok(fields.channels.length>0);assert.ok(peak(fields)<1);assert.ok(maxCompositeStep(previewRelightLayers(source,fields))<35);
  }
});

test('context and protection never supply observations while inside changes remain usable',async()=>{
  const source=image(()=>180),target=changed(source,(v,x,y)=>x>80&&x<112&&y>20&&y<70?40:v),mask=new Uint8Array(W*H);
  for(let y=0;y<H;y++)mask.fill(255,y*W,y*W+48);
  const fields=await deriveRelightLayers(source,target,scene(),{editMask:mask});assert.equal(fields.summary.method,'rgb-guided-v2');assert.equal(fields.channels.length,0);
  const inside=changed(source,(v,x,y)=>x>15&&x<35&&y>20&&y<70?40:v);
  assert.ok((await deriveRelightLayers(source,inside,scene(),{editMask:mask})).channels.length>0);
});

test('excluded model pixels adjacent to a narrow feathered scope cannot enter editable observations through resize',async()=>{
  const source=image(()=>180),model=resize(source,64,48);
  for(const left of [60,64]){
    const mask=new Uint8Array(W*H);for(let y=0;y<H;y++)mask.set([64,128,192,255],y*W+left);const before=mask.slice();
    for(const outside of [0,40,255,[30,210,70]])for(const depth of [8,16] as const){
      const changed={...model,rgba:Uint8Array.from(model.rgba,(v,i)=>{
        if(i%4===3)return v;const x=Math.floor(i/4)%64,excluded=left===60?x>=32:x<32;
        return excluded?(Array.isArray(outside)?outside[i%4]:outside):v;
      })},output=convertDepth(changed,depth),rawBefore=output.rgba.slice();
      const fields=await deriveRelightLayers(source,output,scene(),{editMask:mask});
      assert.equal(fields.summary.method,'rgb-guided-v2');assert.equal(fields.channels.length,0);assert.deepEqual(previewRelightLayers(source,fields),source);
      assert.deepEqual(mask,before);assert.deepEqual(output.rgba,rawBefore);
    }
  }
});

test('narrow scope resampling retains real inside lighting without baking feather coverage',async()=>{
  const source=image(()=>180),model=resize(source,64,48),mask=new Uint8Array(W*H),s=scene();s.shadow.strength=1;
  for(let y=0;y<H;y++)mask.fill(255,y*W+60,y*W+64);
  const target=(structure:boolean)=>({...model,rgba:Uint8Array.from(model.rgba,(v,i)=>{
    if(i%4===3)return v;const x=Math.floor(i/4)%64,y=Math.floor(Math.floor(i/4)/64);
    return x>=30&&x<32?(structure&&y>14&&y<34?40:structure?v:144):v;
  })});
  const fields=await deriveRelightLayers(source,target(false),s,{editMask:mask});assert.ok(fields.channels.some(c=>c.kind==='shadow'));assert.ok(previewRelightLayers(source,fields).rgba[(48*W+61)*4]<180);
  const feather=Uint8Array.from(mask,(v,p)=>v?[64,128,192,255][p%W-60]:0),soft=await deriveRelightLayers(source,target(false),s,{editMask:feather});assert.deepEqual(soft.channels,fields.channels,'feather coverage belongs only to the external editable mask');
  assert.ok((await deriveRelightLayers(source,target(true),s,{editMask:mask})).channels.length>0);
});

test('new summaries identify RGB extraction without fabricating historical similarity scores',async()=>{
  const fields=await deriveRelightLayers(image(()=>120),image(()=>144),scene());
  assert.equal(fields.summary.method,'rgb-guided-v2');assert.equal(Object.prototype.hasOwnProperty.call(fields.summary,'structureConfidence'),false);assert.equal(Object.prototype.hasOwnProperty.call(fields.summary,'rejectedFraction'),false);
  for(const reason of ['structure-mismatch','unsupported-boundary'] as const){const old=new RelightExtractionError(reason,{structureConfidence:.3,rejectedFraction:.7,boundaryPixels:21});assert.equal(old.code,'relight-extraction');assert.deepEqual(old.metrics,{structureConfidence:.3,rejectedFraction:.7,boundaryPixels:21});}
});

test('small uncorrelated noise remains weak rather than being normalized into a strong light',async()=>{
  const source=image((x,y)=>[60+(x*13+y*7)%110,70+(x*5+y*11)%120,80+(x*17+y*3)%100]),target=changed(source,(v,x,y,c)=>v+((x*19+y*31+c*7)%5)-2);
  const fields=await deriveRelightLayers(source,target,scene());assert.ok(peak(fields)<.015);assert.ok(maxInteriorStep(fields)<.003);
});

test('broad illumination survives without source checker texture being reimprinted into the field',async()=>{
  const source=image((x,y)=>110+((x+y)%2)*30),target=changed(source,(v,x)=>v*(.75+.55*x/(W-1))),s=scene();s.shadow.strength=1;
  const fields=await deriveRelightLayers(source,target,s),preview=previewRelightLayers(source,fields),dark=(48*W+16)*4,light=(48*W+110)*4;
  assert.ok(source.rgba[dark]-preview.rgba[dark]>12);assert.ok(preview.rgba[light]-source.rgba[light]>12);
  for(let y=16;y<H-16;y++)for(let x=16;x<W-16;x++){const p=(y*W+x)*4;assert.ok(Math.abs(preview.rgba[p]-target.rgba[p])<4,'smooth transfer must retain the original checker response');}
});

test('near-black source and extreme illumination stay finite and smoothly bounded',async()=>{
  const source=image((x,y)=>(x+y)%3),target=image((x,y)=>x<W/2?0:220+(y%2)),s=scene();s.shadow.strength=1;
  const fields=await deriveRelightLayers(source,target,s);assert.ok(fields.channels.length>0);assert.ok(peak(fields)<=.65);assert.ok(fields.channels.every(c=>c.amount.every(Number.isFinite)));assert.ok(Number.isFinite(fields.summary.clippedFraction));
});

test('sparse disconnected scopes exclude every outside and fully protected observation',async()=>{
  const source=image(()=>120),mask=new Uint8Array(W*H);for(const [x,y] of [[12,12],[34,29],[91,70],[112,18]])mask[y*W+x]=128;
  const outside=changed(source,(v,x,y,c)=>mask[y*W+x]?v:c===0?255:c===1?0:210),fields=await deriveRelightLayers(source,outside,scene(),{editMask:mask});
  assert.equal(fields.channels.length,0);assert.deepEqual(previewRelightLayers(source,fields),source);
  const lit=changed(outside,(v,x,y)=>mask[y*W+x]?150:v),s=scene();s.shadow.strength=1;
  const inside=await deriveRelightLayers(source,lit,s,{editMask:mask});assert.ok(inside.channels.some(c=>c.kind==='light'));for(const c of inside.channels)for(let p=0;p<mask.length;p++)if(!mask[p])assert.equal(c.amount[p],0);
});

test('a downsampled reference cannot observe outside values through isolated native scope pixels',async()=>{
  const source=image(()=>120),mask=new Uint8Array(W*H);for(const [x,y] of [[12,12],[34,29],[91,70],[112,18]])mask[y*W+x]=255;
  const model=resize(source,64,48),target={...model,rgba:Uint8Array.from(model.rgba,(v,i)=>i%4===3?v:i%4===0?255:0)};
  const fields=await deriveRelightLayers(source,target,scene(),{editMask:mask});assert.equal(fields.channels.length,0);assert.deepEqual(previewRelightLayers(source,fields),source);
});

test('identical dark native16 samples stay neutral even between adjacent sRGB8 input codes',async()=>{
  const s=scene();s.source.documentDepth=16;
  for(const value of [100,200,300,400]){const source=image(()=>value,16),copy={...source,rgba:source.rgba.slice()},fields=await deriveRelightLayers(source,copy,s);assert.equal(fields.channels.length,0,`native value ${value}`);assert.deepEqual(previewRelightLayers(source,fields),source);}
});

test('fine source texture alone cannot manufacture a rim or cast receiver from broad lighting',async()=>{
  const source=image(x=>110+(Math.floor(x/2)%2)*60),s=scene();s.shadow.strength=1;s.lights[0].role='rim';
  for(const gain of [.8,1.2]){
    const fields=await deriveRelightLayers(source,changed(source,v=>v*gain),s);
    for(const c of fields.channels)if(c.kind==='rim-light'||c.kind==='cast-shadow')for(let y=16;y<H-16;y++)for(let x=16;x<W-16;x++)assert.ok(c.amount[y*W+x]<.002,`${c.kind} invented from fine texture at ${x},${y}`);
    const preview=previewRelightLayers(source,fields),target=changed(source,v=>v*gain);
    for(let y=16;y<H-16;y++)for(let x=16;x<W-16;x++){const p=(y*W+x)*4;assert.ok(Math.abs(preview.rgba[p]-target.rgba[p])<3,'encoded fields reconstruct smooth gain on original fine texture');}
  }
});
