import test from 'node:test';import assert from 'node:assert/strict';
import {PhotoshopAdapter,Snapshot} from '../src/photoshop';

function host() {
  const calls:any[]=[];let inside=false;let serial=0;
  let layerSerial=55;
  const doc:any={id:11,width:100,height:80,colorProfileName:'sRGB IEC61966-2.1',mode:'rgb',bitsPerChannel:8,activeHistoryState:{id:91},selection:{bounds:{left:40,top:30,right:42,bottom:32}},layers:[{id:2,kind:'normal',blendMode:'normal',visible:true,opacity:100,fillOpacity:100,isClippingMask:false}],activeLayers:[],createLayer:async()=>{assert.equal(inside,true);calls.push('new-layer');const layer={id:layerSerial++,isClippingMask:false,move:async(...args:any[])=>calls.push(['move',...args]),delete:async()=>{calls.push(['delete',layer.id]);doc.layers=doc.layers.filter((l:any)=>l.id!==layer.id);}};doc.layers.unshift(layer);return layer;}};
  const data=(bytes:Uint8Array|Uint16Array,w:number,h:number,components:number)=>({width:w,height:h,components,componentSize:bytes instanceof Uint16Array?16:8,getData:async()=>bytes,dispose:()=>calls.push('dispose')});
  const ps:any={app:{documents:[doc],activeDocument:doc},constants:{DocumentMode:{RGB:'rgb',GRAYSCALE:'gray'},BitsPerChannelType:{EIGHT:8,SIXTEEN:16},LayerKind:{NORMAL:'normal'},BlendMode:{NORMAL:'normal'},ElementPlacement:{PLACEBEFORE:'before'}},
    core:{executeAsModal:async(fn:any)=>{assert.equal(inside,false);inside=true;try{return await fn({hostControl:{suspendHistory:async(args:any)=>{calls.push(['suspend',args]);return ++serial;},resumeHistory:async(id:number,commit:boolean)=>{calls.push(['resume',id,commit]);if(commit)doc.activeHistoryState={id:doc.activeHistoryState.id+1};}}});}finally{inside=false;}}},
    action:{batchPlay:async(commands:any[])=>{assert.equal(inside,true);calls.push(['batch',commands]);return commands.map(()=>({}));}},
    imaging:{getSelection:async(options:any)=>{calls.push(['getSelection',options]);return {imageData:data(new Uint8Array([255,128,0,255]),2,2,1),sourceBounds:{left:40,top:30,right:42,bottom:32}};},
      getPixels:async(options:any)=>{calls.push(['getPixels',options]);return {imageData:data(new Uint8Array([20,30,40,255]),1,1,4),sourceBounds:{left:40,top:30,right:41,bottom:31},level:0};},
      createImageDataFromBuffer:async(bytes:Uint8Array|Uint16Array,options:any)=>{calls.push(['buffer',bytes.slice(),options]);return data(bytes,options.width,options.height,options.components);},
      putPixels:async(options:any)=>{calls.push(['putPixels',options]);},putLayerMask:async(options:any)=>calls.push(['putMask',options])}
  };return {ps,doc,calls,adapter:new PhotoshopAdapter(ps,'session-a')};
}
function snap():Snapshot {return {documentId:11,width:100,height:80,profile:'sRGB IEC61966-2.1',mode:'rgb',depth:8,historyId:91,sessionId:'session-a',bounds:{left:40,top:30,right:42,bottom:32},mask:new Uint8Array([255,128,0,255]),sourceHash:'fixture'};}
const patch={width:2,height:2,rgba:new Uint8Array([255,0,0,128,255,0,0,255,255,0,0,255,255,0,0,255])};
test('没有打开文档时捕获给出明确错误，参考导入可独立读取并关闭自建文档',async()=>{
  const h=host();h.ps.app.documents=[];Object.defineProperty(h.ps.app,'activeDocument',{get(){if(!h.ps.app.documents.length)throw new Error('No active document');return h.ps.app.documents[0];},set(){},configurable:true});
  await assert.rejects(h.adapter.capture(),/请先打开/);
  let closed=false;const reference={...h.doc,id:22,closeWithoutSaving:async()=>{closed=true;h.ps.app.documents=[];}};h.ps.app.open=async()=>{h.ps.app.documents=[reference];return reference;};
  const modal=h.ps.core.executeAsModal;h.ps.core.executeAsModal=(fn:any)=>modal((ctx:any)=>fn({...ctx,hostControl:{...ctx.hostControl,registerAutoCloseDocument:async()=>{},unregisterAutoCloseDocument:async()=>{}}}));
  await h.adapter.importReference({name:'reference.png'});assert.equal(closed,true);
});
test('捕获真实选区灰度和透明裁边，保护区在原坐标减去',async()=>{
  const h=host();const p={documentId:11,width:100,height:80,bounds:{left:40,top:30,right:42,bottom:32},mask:new Uint8Array([0,255,0,0]),sessionId:'session-a'};
  const c=await h.adapter.capture(0,p);
  assert.deepEqual(c.snapshot.bounds,{left:8,top:0,right:74,bottom:64});
  assert.equal(c.snapshot.mask[30*66+32],255);assert.equal(c.snapshot.mask[30*66+33],0);
  assert.equal(c.image.rgba[(30*66+32)*4],20);assert.equal(c.image.rgba[3],0);
  assert.equal(h.calls.filter(c=>c==='dispose').length,2);
});
test('拒绝不同会话、关闭、尺寸、颜色与内容改变，写入前无新图层',async()=>{
  for(const mutate of [(s:Snapshot,h:any)=>s.sessionId='old-session',(s:Snapshot,h:any)=>h.ps.app.documents=[],(s:Snapshot,h:any)=>h.doc.width=101,(s:Snapshot,h:any)=>h.doc.colorProfileName='Adobe RGB',(s:Snapshot,h:any)=>h.doc.activeHistoryState.id=92]){
    const h=host(),s=snap();mutate(s,h);await assert.rejects(h.adapter.apply(s,patch,'AI'));assert.equal(h.calls.includes('new-layer'),false);
  }
});
test('切换到别的文档仍指定来源，新蒙版先 hideAll，再写真实灰度；RGBA 不预乘',async()=>{
  const h=host();h.ps.app.activeDocument={id:22};
  await h.adapter.apply(snap(),patch,'AI');
  const pixel=h.calls.find(c=>c[0]==='putPixels')[1];assert.equal(pixel.documentID,11);assert.equal(pixel.layerID,55);
  const bytes=h.calls.find(c=>c[0]==='buffer'&&c[2].components===4)[1];assert.deepEqual([...bytes.slice(0,4)],[255,0,0,128]);
  const commands=h.calls.filter(c=>c[0]==='batch').flatMap(c=>c[1]);assert.equal(commands.some((c:any)=>c.using?._value==='hideAll'),true);
  const mask=h.calls.find(c=>c[0]==='putMask')[1];assert.equal(mask.replace,false);assert.deepEqual(mask.targetBounds,{left:40,top:30});
  assert.deepEqual(h.calls.find(c=>c[0]==='resume').slice(1),[1,true]);
});
test('写入失败回滚整次新建层事务并释放 pixel/mask 数据',async()=>{
  const h=host();h.ps.imaging.putLayerMask=async()=>{throw new Error('host write failed');};
  await assert.rejects(h.adapter.apply(snap(),patch,'AI'),/host write failed/);
  assert.deepEqual(h.calls.find(c=>c[0]==='resume').slice(1),[1,false]);
  assert.equal(h.calls.filter(c=>c==='dispose').length,2);
});
test('RGB 和灰度的 8/16 位捕获不改变原文档模式、位深或 ICC',async()=>{
  for(const mode of ['rgb','gray'])for(const depth of [8,16]){
    const h=host();h.doc.mode=mode;h.doc.bitsPerChannel=depth;h.doc.colorProfileName=mode==='gray'?'Gray Gamma 2.2':'Adobe RGB (1998)';
    const c=await h.adapter.capture();assert.equal(c.snapshot.depth,depth);assert.equal(c.snapshot.mode,mode);assert.equal(h.doc.bitsPerChannel,depth);
    assert.equal(h.calls.find(c=>c[0]==='getPixels')[1].colorProfile,'sRGB IEC61966-2.1');
  }
  for(const [mode,depth] of [['cmyk',8],['lab',8],['rgb',32]]){const h=host();h.doc.mode=mode;h.doc.bitsPerChannel=depth;await assert.rejects(h.adapter.capture(),/RGB|灰度/);assert.equal(h.calls.some(c=>c[0]==='getPixels'),false);}
  const h=host();h.doc.selection.bounds=null;await assert.rejects(h.adapter.capture(),/选区/);
});

test('16 位选区按完整范围归一化，不截断成 8 位或改变羽化',async()=>{
  const h=host();h.doc.bitsPerChannel=16;
  h.ps.imaging.getSelection=async()=>({imageData:{width:2,height:2,componentSize:16,components:1,getData:async(o:any)=>{assert.equal(o.fullRange,true);return new Uint16Array([0,32768,65535,16384]);},dispose(){}},sourceBounds:{left:40,top:30,right:42,bottom:32}});
  const c=await h.adapter.capture(0);const p=30*66+32;
  assert.deepEqual([c.snapshot.mask[p],c.snapshot.mask[p+1],c.snapshot.mask[p+66],c.snapshot.mask[p+67]],[0,128,255,64]);
});

test('16 位来源按原生位深读取后转换模型字节，避免宿主 getPixels 直接降位错误',async()=>{
  const h=host();h.doc.bitsPerChannel=16;
  h.ps.imaging.getPixels=async(o:any)=>{assert.equal(o.componentSize,16);return {imageData:{width:1,height:1,components:4,componentSize:16,getData:async(opts:any)=>{assert.equal(opts.fullRange,true);return new Uint16Array([65535,32768,16384,32768]);},dispose(){}},sourceBounds:{left:40,top:30,right:41,bottom:31},level:0};};
  const c=await h.adapter.capture(0);assert.deepEqual([...c.image.rgba.slice((30*66+32)*4,(30*66+32)*4+4)],[255,128,64,128]);
});

test('16 位回填的颜色和灰度蒙版都按宿主位深传入，不使用原生隐式降位转换',async()=>{
  const h=host();h.doc.bitsPerChannel=16;const s={...snap(),depth:16};
  await h.adapter.apply(s,patch,'AI16');
  const buffers=h.calls.filter(c=>c[0]==='buffer');assert.equal(buffers.length,2);
  for(const b of buffers){assert.ok(b[1] instanceof Uint16Array);assert.equal(b[2].fullRange,true);}
  assert.deepEqual([...buffers[0][1].slice(0,4)],[65535,0,0,32896]);
  assert.deepEqual([...buffers[1][1]],[65535,32896,0,65535]);
});

test('切换同次捕获的候选只替换插件上次图层；外部修改仍阻止回填',async()=>{
  const h=host(),s=snap();assert.equal(await h.adapter.apply(s,patch,'AI1'),55);
  assert.equal(await h.adapter.apply({...s,mask:new Uint8Array(s.mask)},patch,'AI2'),56);
  assert.deepEqual(h.calls.filter(c=>c[0]==='delete'),[['delete',55]]);assert.deepEqual(h.doc.layers.map((l:any)=>l.id),[56,2]);
  h.doc.activeHistoryState.id++;
  await assert.rejects(h.adapter.apply(s,patch,'AI3'),/状态已改变/);assert.equal(h.calls.filter(c=>c==='new-layer').length,2);
});

test('半透明编辑剪贴到经过验证的来源底层，文档 alpha 不因 NORMAL 叠加加倍',async()=>{
  const h=host();h.ps.imaging.getPixels=async(o:any)=>({imageData:{width:1,height:1,components:4,componentSize:8,getData:async()=>new Uint8Array([30,40,50,128]),dispose(){}},sourceBounds:{left:40,top:30,right:41,bottom:31}});
  const c=await h.adapter.capture(0);assert.equal(c.snapshot.clipBaseLayerId,2);
  await h.adapter.apply(c.snapshot,patch,'alpha edit',c.image);
  assert.equal(h.doc.layers[0].isClippingMask,true);
  const written=h.calls.find(c=>c[0]==='buffer'&&c[2].components===4)[1];const p=(30*66+32)*4;
  assert.equal(written[p+3],255); // Clipping supplies alpha128 exactly once.
  assert.equal(await h.adapter.apply(c.snapshot,patch,'replace alpha edit',c.image),56);
  assert.equal(h.doc.layers[0].isClippingMask,true);assert.equal(h.doc.layers.length,2);
  await h.adapter.apply(c.snapshot,patch,'preservation off');assert.equal(h.doc.layers[0].isClippingMask,false);
  await h.adapter.apply(c.snapshot,patch,'preservation on',c.image);assert.equal(h.doc.layers[0].isClippingMask,true);
});

test('半透明复杂合成没有安全剪贴底层时拒绝回填，仍允许不保留透明度的普通应用',async()=>{
  const h=host(),s=snap(),source={...patch,rgba:new Uint8Array(patch.rgba)};
  await assert.rejects(h.adapter.apply(s,patch,'unsafe alpha',source),/半透明.*副本/);
  assert.equal(h.calls.includes('new-layer'),false);
  await h.adapter.apply(s,patch,'ordinary overlay');assert.equal(h.doc.layers[0].isClippingMask,false);
});

test('捕获不会把 alpha 不同的来源层当成安全剪贴底层',async()=>{
  const h=host();h.ps.imaging.getPixels=async(o:any)=>({imageData:{width:1,height:1,components:4,componentSize:8,getData:async()=>new Uint8Array([30,40,50,o.layerID?64:128]),dispose(){}},sourceBounds:{left:40,top:30,right:41,bottom:31}});
  const c=await h.adapter.capture(0);assert.equal(c.snapshot.clipBaseLayerId,undefined);
  await assert.rejects(h.adapter.apply(c.snapshot,patch,'unsafe alpha',c.image),/半透明.*副本/);
  assert.equal(h.calls.includes('new-layer'),false);
});

test('其他文档相同图层和历史 ID 的不透明度操作不授权来源文档的新历史',async()=>{
  const h=host(),s=snap();await h.adapter.apply(s,patch,'AI1');
  const other:any={id:22,activeHistoryState:{id:h.doc.activeHistoryState.id},layers:[]};
  const layer:any={id:55};Object.defineProperty(layer,'opacity',{set(){other.activeHistoryState.id++;}});other.layers=[layer];h.ps.app.documents.push(other);
  await h.adapter.opacity(22,55,50);assert.equal(await h.adapter.apply(s,patch,'AI2'),56);
});
test('新文档显式使用 sRGB profile，失败时留给宿主自动关闭',async()=>{
  const h=host();h.ps.constants.NewDocumentMode={RGB:'RGBColorMode'};h.ps.constants.DocumentFill={TRANSPARENT:'transparent'};
  let registered=false,unregistered=false;
  h.ps.core.executeAsModal=async(fn:any)=>fn({hostControl:{registerAutoCloseDocument:()=>{registered=true;},unregisterAutoCloseDocument:()=>{unregistered=true;}}});
  h.ps.app.createDocument=async(options:any)=>{assert.equal(options.profile,'sRGB IEC61966-2.1');return {...h.doc,createLayer:async()=>({id:55})};};
  assert.equal(await h.adapter.newDocument(patch,'candidate'),11);assert.equal(registered,true);assert.equal(unregistered,true);
});
test('modal 等待期间切换文档时，捕获拒绝错文档',async()=>{
  const h=host();h.ps.core.executeAsModal=async(fn:any)=>{h.ps.app.activeDocument={...h.doc,id:22};return fn({});};
  await assert.rejects((h.adapter as any).capture(0,undefined,11),/文档/);assert.equal(h.calls.some(c=>c[0]==='getPixels'),false);
});
test('外部参考通过 Photoshop 转 sRGB8，关闭自建参考文档并恢复原活动文档',async()=>{
  const h=host();let closed=false;
  const reference={...h.doc,id:22,colorProfileName:'Adobe RGB (1998)',closeWithoutSaving:async()=>{closed=true;}};
  h.ps.app.open=async()=>{h.ps.app.documents.push(reference);h.ps.app.activeDocument=reference;return reference;};
  const originalModal=h.ps.core.executeAsModal;h.ps.core.executeAsModal=(fn:any)=>originalModal((ctx:any)=>fn({...ctx,hostControl:{...ctx.hostControl,registerAutoCloseDocument:async()=>{},unregisterAutoCloseDocument:async()=>{}}}));
  const result=await h.adapter.importReference({name:'color-reference.png'});
  const request=h.calls.find(c=>c[0]==='getPixels')[1];assert.equal(request.documentID,22);assert.equal(request.colorProfile,'sRGB IEC61966-2.1');assert.equal(request.componentSize,8);
  assert.equal(result.width,100);assert.equal(closed,true);assert.equal(h.ps.app.activeDocument.id,11);
});
