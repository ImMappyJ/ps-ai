import test from 'node:test';import assert from 'node:assert/strict';
import {previewRelightLayers,renderRelightLayerStrip,validateRelightLayerFields,type RelightLayerFields,type RelightLayersOptions} from '../src/features/relight/relight-layers';
import {deriveBlendLayers} from '../src/features/blend/blend-layers';
import type {RelightSource} from '../src/features/relight/relight-scene';
import {convertDepth,resize,type Raster} from '../src/imaging/image';
import {planRelightMemory} from '../src/imaging/budget';

const W=128,H=96;
function identity(depth:8|16=8):RelightSource{return {documentId:7,layerIds:[1],sessionId:'session',historyId:3,sourceHash:'source',snapshotId:'snapshot',docWidth:W,docHeight:H,bounds:{left:0,top:0,right:W,bottom:H},profile:'sRGB IEC61966-2.1',documentMode:'RGBColorMode',documentDepth:depth,maskRef:'blend-mask-v1:sha256:mask'};}
function image(pixel:(x:number,y:number)=>number|number[],depth:8|16=8):Raster{const rgba=depth===16?new Uint16Array(W*H*4):new Uint8Array(W*H*4),max=depth===16?65535:255;for(let y=0;y<H;y++)for(let x=0;x<W;x++){const v=pixel(x,y),rgb=Array.isArray(v)?v:[v,v,v];for(let c=0;c<3;c++)rgba[(y*W+x)*4+c]=rgb[c];rgba[(y*W+x)*4+3]=max;}return {width:W,height:H,rgba};}
function changed(source:Raster,transform:(v:number,x:number,y:number,c:number)=>number):Raster{return {...source,rgba:Uint8Array.from(source.rgba,(v,i)=>i%4===3?v:Math.round(Math.max(0,Math.min(255,transform(v,Math.floor(i/4)%source.width,Math.floor(Math.floor(i/4)/source.width),i%4)))))};}
async function derive(source:Raster,target:Raster,binding:RelightSource=identity(),options:RelightLayersOptions={}):Promise<RelightLayerFields>{
  return deriveBlendLayers(source,target,binding,options);
}
function peak(fields:RelightLayerFields):number{return fields.channels.reduce((max,c)=>Math.max(max,...c.amount),0);}

test('identical inputs preserve original samples and produce no empty lighting group or fabricated scene',async()=>{
  const source=image((x,y)=>[80+(x*13+y*7)%100,90+(x*5+y*11)%100,100+(x*17+y*3)%100]),binding=identity(),fields=await derive(source,source,binding);
  assert.equal(fields.version,'blend-fields-v1');assert.equal(Object.prototype.hasOwnProperty.call(fields,'sceneFingerprint'),false);assert.equal(Object.prototype.hasOwnProperty.call(fields,'scene'),false);assert.deepEqual(fields.source,binding);assert.notEqual(fields.source,binding);
  assert.equal(fields.channels.length,0);assert.deepEqual(previewRelightLayers(source,fields),source);assert.equal(fields.summary.method,'rgb-guided-v2');assert.ok(fields.summary.warnings.every(w=>!/Cast Shadow|承影|灯具/.test(w)));
});

test('RGB lighting retains observed broad warmth and cool shadows with only Multiply and Screen',async()=>{
  const source=image(()=>120),target=image(()=>[202,141,67]),fields=await derive(source,target),preview=previewRelightLayers(source,fields);
  assert.deepEqual(fields.channels.map(c=>[c.kind,c.blendMode]),[['shadow','multiply'],['light','screen']]);
  for(let c=0;c<3;c++)assert.ok(Math.abs(preview.rgba[c]-target.rgba[c])<=3);
  assert.ok(fields.channels.every(c=>c.rgbAmount&&c.energy>0));validateRelightLayerFields(fields);
});

test('fine shifted reference texture stays smooth while the source retains its checker detail',async()=>{
  const source=image((x,y)=>(Math.floor(x/3)+Math.floor(y/3))%2?210:45),target=image((x,y)=>(Math.floor((x+3)/3)+Math.floor(y/3))%2?210:45),before=source.rgba.slice(),fields=await derive(source,target),preview=previewRelightLayers(source,fields);
  assert.ok(peak(fields)<.13);assert.deepEqual(source.rgba,before);assert.ok(preview.rgba[(48*W+33)*4]>preview.rgba[(48*W+30)*4]+120);
  for(const c of fields.channels)for(let y=16;y<H-16;y++)for(let x=16;x<W-17;x++)assert.ok(Math.abs(c.amount[y*W+x+1]-c.amount[y*W+x])<.003);
});

test('broad RGB light transfers on original fine texture without copying a narrow redraw boundary',async()=>{
  const source=image((x,y)=>110+((x+y)%2)*30),target=changed(source,(v,x,_y,c)=>v*(c===0?1.3:1)+(x>=61&&x<=66?50:0));
  const loose=previewRelightLayers(source,await derive(source,target,identity(),{extraction:{fidelity:1,detailProtection:0}})),protectedDetail=previewRelightLayers(source,await derive(source,target,identity(),{extraction:{fidelity:1,detailProtection:1}})),p=(48*W+64)*4;
  assert.ok(loose.rgba[p+1]>protectedDetail.rgba[p+1]+5);assert.ok(protectedDetail.rgba[0]>135);assert.ok(protectedDetail.rgba[p+4]>protectedDetail.rgba[p]+20);
  assert.deepEqual(previewRelightLayers(source,await derive(source,target,identity(),{extraction:{fidelity:0,detailProtection:.65}})),source);
});

test('default blend retains local warm and cool form shading while rejecting displaced fine redraw texture in RGB8 and RGB16',async()=>{
  for(const depth of [8,16] as const){
    const scale=depth===16?257:1,source=image(x=>(120+(x%2?10:-10))*scale,depth),target=image((x,y)=>{
      const form=Math.sin(x*Math.PI/12),redraw=x%2?-10:10;
      return [120+42*form+redraw,120+14*Math.cos(y*Math.PI/18)+redraw,120-34*form+redraw].map(v=>Math.round(v*scale));
    },depth),before=source.rgba.slice(),fields=await derive(source,target,identity(depth)),preview=previewRelightLayers(source,fields);
    const at=(x:number,c:number)=>preview.rgba[(48*W+x)*4+c]/scale;
    // Both measurements use an original dark texture sample (110). Applying
    // the observed multiplicative light to that sample gives about 77 red /
    // 62 blue codes of contrast, rather than the reference's 84 / 68 codes.
    // Retain over three quarters while suppressing the displaced fine band.
    assert.ok(at(30,0)-at(42,0)>60,`local red form contrast was flattened: ${at(30,0)-at(42,0)}`);
    assert.ok(at(42,2)-at(30,2)>47,`local cool form contrast was flattened: ${at(42,2)-at(30,2)}`);
    for(let x=24;x<72;x+=2)assert.ok(at(x+1,1)-at(x,1)>15,'original fine texture stays in its original phase');
    assert.deepEqual(source.rgba,before);
  }
});

test('dark sources and extreme references have finite bounded gains without amplifying weak changes',async()=>{
  const source=image((x,y)=>(x+y)%3),fields=await derive(source,image((x,y)=>x<W/2?0:220+(y%2)));
  assert.ok(fields.channels.length>0);assert.ok(peak(fields)<=.65);assert.ok(fields.channels.every(c=>c.amount.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&c.rgbAmount!.every(v=>Number.isFinite(v)&&v>=0&&v<=1)));assert.ok(Number.isFinite(fields.summary.clippedFraction));
  const ordinary=image((x,y)=>[60+(x*13+y*7)%110,70+(x*5+y*11)%120,80+(x*17+y*3)%100]),weak=await derive(ordinary,changed(ordinary,(v,x,y,c)=>v+((x*19+y*31+c*7)%5)-2));assert.ok(peak(weak)<.015);
});

test('excluded reference background and protected holes cannot contaminate feathered subject lighting',async()=>{
  const source=image(()=>180),mask=new Uint8Array(W*H);for(let y=12;y<84;y++)for(let x=8;x<64;x++)if(!(x>24&&x<40&&y>32&&y<64))mask[y*W+x]=[64,128,192,255][x%4];
  const outside=changed(source,(v,x,y,c)=>mask[y*W+x]?v:c===0?255:0),fields=await derive(source,outside,identity(),{editMask:mask});assert.equal(fields.channels.length,0);assert.deepEqual(previewRelightLayers(source,fields),source);
  const lit=changed(outside,(v,x,y,c)=>mask[y*W+x]?c===0?210:c===1?144:120:v),soft=await derive(source,lit,identity(),{editMask:mask}),hard=await derive(source,lit,identity(),{editMask:Uint8Array.from(mask,v=>v?255:0)});
  assert.deepEqual(soft.channels,hard.channels,'gray edit coverage belongs to the external group mask exactly once');
  for(const channel of soft.channels)for(let p=0;p<mask.length;p++)if(!mask[p]){assert.equal(channel.amount[p],0);for(let c=0;c<3;c++)assert.equal(channel.rgbAmount![p*3+c],0);}
});

test('model-grid sampling cannot import excluded background through a narrow subject boundary',async()=>{
  const source=image(()=>180),model=resize(source,64,48),mask=new Uint8Array(W*H);for(let y=0;y<H;y++)mask.set([64,128,192,255],y*W+60);
  for(const depth of [8,16] as const){const target={...model,rgba:Uint8Array.from(model.rgba,(v,i)=>i%4===3?v:Math.floor(i/4)%64>=32?i%4===0?255:0:v)},fields=await derive(source,convertDepth(target,depth),identity(),{editMask:mask});assert.equal(fields.channels.length,0);}
});

test('native RGB16 identity and strips retain native precision separately from sRGB8 model uncertainty',async()=>{
  const source=image((x,y)=>[12345+(x+y)%17,22003+(x+y)%13,31001+(x+y)%11],16),binding=identity(16),before=source.rgba.slice();
  for(const target of [source,convertDepth(source,8),convertDepth(convertDepth(source,8),16),resize(convertDepth(source,8),256,192)]){const fields=await derive(source,target,binding);assert.equal(fields.channels.length,0);assert.deepEqual(previewRelightLayers(source,fields),source);}
  const fields=await derive(source,image(()=>[45000,11000,41000],16),binding),preview=previewRelightLayers(source,fields),out=source.rgba.slice(),bounds={left:0,top:0,right:W,bottom:H};
  for(const channel of fields.channels){const strip=renderRelightLayerStrip(fields,channel,bounds,bounds,16);assert.ok(strip.rgba instanceof Uint16Array);for(let p=0;p<W*H;p++)for(let c=0;c<3;c++){const b=out[p*4+c]/65535,f=strip.rgba[p*4+c]/65535;out[p*4+c]=Math.round(65535*(channel.blendMode==='multiply'?b*f:1-(1-b)*(1-f)));}}
  for(let i=0;i<out.length;i++)assert.ok(Math.abs(out[i]-preview.rgba[i])<=1);assert.deepEqual(source.rgba,before);
});

test('blend extraction rejects unsupported color, mismatched depth, malformed identity and nonopaque editable pixels',async()=>{
  const source=image(()=>120),target=image(()=>140),binding=identity();
  for(const change of [{documentId:0},{sessionId:''},{sourceHash:''},{snapshotId:''},{layerIds:[1,1]},{bounds:{left:0,top:0,right:W+1,bottom:H}},{documentDepth:32},{unknown:true}])await assert.rejects(derive(source,target,{...binding,...change} as any));
  for(const change of [{profile:'Adobe RGB (1998)'},{profile:'untagged'},{documentMode:'GrayScale'},{documentDepth:16}])await assert.rejects(derive(source,target,{...binding,...change} as any));
  const alpha={...source,rgba:source.rgba.slice()};alpha.rgba[3]=254;await assert.rejects(derive(alpha,target),/透明|opaque/);
  const mask=new Uint8Array(W*H).fill(255);mask[0]=0;assert.ok((await derive(alpha,target,binding,{editMask:mask})).channels.length>0,'excluded alpha does not reject the opaque editable scope');
  await assert.rejects(derive(source,target,binding,{editMask:new Uint8Array(3)}));await assert.rejects(derive(source,target,binding,{extraction:{fidelity:1,detailProtection:NaN}}));
});

test('opacity rejection sees a single original-grid nonopaque pixel lost by bounded analysis sampling',async()=>{
  for(const depth of [8,16] as const){
    const width=16000,height=1,max=depth===16?65535:255,rgba=depth===16?new Uint16Array(width*4):new Uint8Array(width*4);rgba.fill(max);
    const source={width,height,rgba},binding={...identity(depth),docWidth:width,docHeight:height,bounds:{left:0,top:0,right:width,bottom:height}},size=planRelightMemory(width,height,depth),target=resize(source,size.width,size.height);
    rgba[3*4+3]=max-1;assert.ok(resize(source,size.width,size.height).rgba.every(v=>v===max),'fixture opacity defect is missed by image downsampling');
    await assert.rejects(derive(source,target,binding),/透明|opaque/);
    const mask=new Uint8Array(size.width*size.height).fill(255);mask[0]=0;
    const fields=await derive(source,target,binding,{editMask:mask});assert.equal(fields.channels.length,0,'a nonopaque pixel wholly outside supported analysis scope remains excluded');
    mask[0]=1;await assert.rejects(derive(source,target,binding,{editMask:mask}),/透明|opaque/);
  }
});

test('blend field validation rejects fabricated scene authority and lamp-specific channels',async()=>{
  const fields=await derive(image(()=>120),image(()=>180)),light=fields.channels[0];
  assert.throws(()=>validateRelightLayerFields({...fields,sceneFingerprint:'invented'} as any));
  for(const kind of ['cast-shadow','rim-light','color-atmosphere'])assert.throws(()=>validateRelightLayerFields({...fields,channels:[{...light,kind,blendMode:kind==='cast-shadow'?'multiply':kind==='color-atmosphere'?'color':'screen'}]} as any));
});

test('blend analysis yields and cancels during filtering without changing source or target',async()=>{
  const source=image(()=>120),target=image(()=>140),before=target.rgba.slice(),control=new AbortController();let yields=0;
  await assert.rejects(derive(source,target,identity(),{signal:control.signal,yieldControl:async()=>{if(++yields===2)control.abort();}}),{name:'AbortError'});assert.ok(yields>=2);assert.deepEqual(target.rgba,before);
});
