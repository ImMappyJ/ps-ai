import test from 'node:test';import assert from 'node:assert/strict';
import {deriveRelightLayers,previewRelightLayers,renderRelightLayerStrip} from '../src/features/relight/relight-layers';
import {createRelightScene,type RelightScene} from '../src/features/relight/relight-scene';
import {resize,convertDepth,type Raster} from '../src/imaging/image';

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

test('native16 texture beside nearly white gradients has finite identity confidence despite filter roundoff',async()=>{
  const source=image((x,y)=>x<33?(x+y)%2?65500:2000:65500+x%30,16),s=scene();s.source.documentDepth=16;
  const fields=await deriveRelightLayers(source,convertDepth(convertDepth(source,8),16),s);assert.equal(fields.summary.structureConfidence,1);assert.equal(fields.channels.length,0);
});

test('negative variance roundoff cannot poison native16 shadow channels after confidence calculation',async()=>{
  const source=image((x,y)=>x<33?(x+y)%2?65500:2000:65500+x%30,16),target={...source,rgba:Uint16Array.from(source.rgba,(v,i)=>i%4===3?v:Math.round(v*.9))},s=scene();s.source.documentDepth=16;s.shadow.strength=1;
  const fields=await deriveRelightLayers(source,target,s);assert.ok(fields.channels.some(c=>c.kind==='shadow'));assert.ok(fields.channels.every(c=>c.amount.every(Number.isFinite)));
});

test('known smooth illumination on dark colored texture survives integer quantization without importing texture',async()=>{
  const source=image((x,y)=>[8+(x*13+y*7)%80,15+(x*5+y*11)%100,20+(x*17+y*3)%150]);
  const target=changed(source,(v,x,_y,c)=>v*(.82+.28*x/(W-1))*(c===0?1.06:c===2?.96:1)),fields=await deriveRelightLayers(source,target,scene());
  assert.ok(fields.summary.structureConfidence>.9);assert.ok(fields.channels.length>0);
  const preview=previewRelightLayers(source,fields);assert.ok(preview.rgba.some((v,i)=>i%4!==3&&v!==source.rgba[i]));
});

test('smooth lighting across black and clipped highlights does not create boundaries from a logarithm floor',async()=>{
  const source=image((x,y)=>[(x*13+y*7)%256,(x*5+y*11)%256,(x*17+y*3)%256]),target=changed(source,(v,x,_y,c)=>v*(.82+.28*x/(W-1))*(c===0?1.06:c===2?.96:1));
  const fields=await deriveRelightLayers(source,target,scene());assert.ok(fields.channels.length>0);assert.ok(fields.summary.structureConfidence>.9);
});

test('known model input resampling is neutral rather than an unsupported new boundary',async()=>{
  const source=image((x,y)=>(x+y)%2?[35,120,220]:[210,65,12]),target=resize(source,120,90);
  const fields=await deriveRelightLayers(source,target,scene());assert.equal(fields.summary.structureConfidence,1);assert.equal(fields.channels.length,0);
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
    assert.equal(fields.summary.structureConfidence,1);assert.equal(fields.channels.length,0);assert.deepEqual(previewRelightLayers(source,fields),source);
  }
});

test('same-size SDR16 neutral output compares to the uploaded sRGB8 source while preserving native source samples',async()=>{
  const source=image((x,y)=>[(x*1301+y*701)%65536,(x*509+y*1103)%65536,(x*1709+y*307)%65536],16),before=source.rgba.slice(),s=scene();s.source.documentDepth=16;
  const output=convertDepth(convertDepth(source,8),16),fields=await deriveRelightLayers(source,output,s);
  assert.equal(fields.summary.structureConfidence,1);assert.equal(fields.channels.length,0);assert.deepEqual(previewRelightLayers(source,fields),source);assert.deepEqual(source.rgba,before);
});

test('sRGB8 input projection cannot turn native16 semitransparency into an opaque editable source',async()=>{
  const source=image(()=>12000,16),s=scene();s.source.documentDepth=16;for(let i=3;i<source.rgba.length;i+=4)source.rgba[i]=65534;
  await assert.rejects(deriveRelightLayers(source,convertDepth(convertDepth(source,8),16),s),/结构|透明/);
});

test('a genuine frame-spanning colored shadow creates independent shadow and color fields',async()=>{
  const source=image(()=>180),target=changed(source,(v,x,_y,c)=>x<W/2?v*(c===0?.65:c===1?.8:.9):v),s=scene();s.shadow.strength=1;
  const fields=await deriveRelightLayers(source,target,s);assert.ok(fields.channels.some(c=>c.kind==='shadow'));assert.ok(fields.channels.some(c=>c.kind==='color-atmosphere'));
  assert.ok(previewRelightLayers(source,fields).rgba[(48*W+20)*4]<source.rgba[(48*W+20)*4]);
});

test('resampling uncertainty cannot hide newly drawn black or isoluminant colored text',async()=>{
  const source=image(()=>180),model=resize(source,120,90);
  for(const colored of [false,true]){
    const target={...model,rgba:Uint8Array.from(model.rgba,(v,i)=>{
      if(i%4===3)return v;const x=Math.floor(i/4)%120,y=Math.floor(Math.floor(i/4)/120),letter=y>=20&&y<=70&&(x>=35&&x<=42||x>=75&&x<=82)||x>=35&&x<=82&&y>=42&&y<=49;
      return letter?(colored?i%4===1?251:0:0):v;
    })};
    await assert.rejects(deriveRelightLayers(source,target,scene()),/结构|文字|纹理/);
  }
});

test('structure changes confined to context or protection cannot reject or bleed into the editable field',async()=>{
  const source=image(()=>180),target=changed(source,(v,x,y)=>x>80&&x<112&&y>20&&y<70?40:v),mask=new Uint8Array(W*H);
  for(let y=0;y<H;y++)mask.fill(255,y*W,y*W+48);
  const fields=await deriveRelightLayers(source,target,scene(),{editMask:mask});assert.equal(fields.summary.structureConfidence,1);assert.equal(fields.channels.length,0);
  const inside=changed(source,(v,x,y)=>x>15&&x<35&&y>20&&y<70?40:v);
  await assert.rejects(deriveRelightLayers(source,inside,scene(),{editMask:mask}),/结构|文字|纹理/);
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
      assert.equal(fields.summary.structureConfidence,1);assert.equal(fields.channels.length,0);assert.deepEqual(previewRelightLayers(source,fields),source);
      assert.deepEqual(mask,before);assert.deepEqual(output.rgba,rawBefore);
    }
  }
});

test('narrow scope resampling retains real inside lighting and still rejects new inside structure',async()=>{
  const source=image(()=>180),model=resize(source,64,48),mask=new Uint8Array(W*H),s=scene();s.shadow.strength=1;
  for(let y=0;y<H;y++)mask.fill(255,y*W+60,y*W+64);
  const target=(structure:boolean)=>({...model,rgba:Uint8Array.from(model.rgba,(v,i)=>{
    if(i%4===3)return v;const x=Math.floor(i/4)%64,y=Math.floor(Math.floor(i/4)/64);
    return x>=30&&x<32?(structure&&y>14&&y<34?40:structure?v:144):v;
  })});
  const fields=await deriveRelightLayers(source,target(false),s,{editMask:mask});assert.ok(fields.channels.some(c=>c.kind==='shadow'));assert.ok(previewRelightLayers(source,fields).rgba[(48*W+61)*4]<180);
  const feather=Uint8Array.from(mask,(v,p)=>v?[64,128,192,255][p%W-60]:0),soft=await deriveRelightLayers(source,target(false),s,{editMask:feather});assert.deepEqual(soft.channels,fields.channels,'feather coverage belongs only to the external editable mask');
  await assert.rejects(deriveRelightLayers(source,target(true),s,{editMask:mask}),/结构|文字|纹理/);
});

test('global disagreement and unsupported local boundaries report distinct finite redacted extraction reasons',async()=>{
  const source=image((x,y)=>((Math.floor(x/3)+Math.floor(y/3))%2)?210:45),shifted=image((x,y)=>((Math.floor((x+3)/3)+Math.floor(y/3))%2)?210:45);
  const error=(reason:string)=>(value:any)=>value?.code==='relight-extraction'&&value?.stage==='lighting-extraction'&&value?.reason===reason&&Object.values(value.metrics).every(v=>typeof v==='number'&&Number.isFinite(v));
  await assert.rejects(deriveRelightLayers(source,shifted,scene()),error('structure-mismatch'));
  const flat=image(()=>180),letter=changed(flat,(v,x,y)=>y>=20&&y<=75&&(x>=40&&x<=47||x>=80&&x<=87)||x>=40&&x<=87&&y>=44&&y<=51?40:v);
  await assert.rejects(deriveRelightLayers(flat,letter,scene()),error('unsupported-boundary'));
});
