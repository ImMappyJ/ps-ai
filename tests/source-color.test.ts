import test from 'node:test';import assert from 'node:assert/strict';
import {inspectSourceColor,createSourceColorReader,MAX_SOURCE_FILE_BYTES} from '../src/infrastructure/photoshop/source-color';
import {encodePng} from '../src/imaging/image';

function chunk(kind:string,data:Uint8Array){const out=new Uint8Array(8+data.length+(data.length%2));out.set([...kind].map(c=>c.charCodeAt(0)));new DataView(out.buffer).setUint32(4,data.length,true);out.set(data,8);return out;}
export function webpFixture(width=100,height=80,icc=false){
  const header=new Uint8Array(10);header[0]=icc?32:0;for(let n=0;n<3;n++){header[4+n]=((width-1)>>>8*n)&255;header[7+n]=((height-1)>>>8*n)&255;}
  const frame=new Uint8Array([0,0,0,157,1,42,width&255,width>>>8,height&255,height>>>8]);
  const profile=new Uint8Array(132);new DataView(profile.buffer).setUint32(0,132);profile.set([82,71,66,32],16);profile.set([97,99,115,112],36);
  const chunks=[chunk('VP8X',header),...(icc?[chunk('ICCP',profile)]:[]),chunk('VP8 ',frame)];
  const out=new Uint8Array(12+chunks.reduce((n,p)=>n+p.length,0));out.set([82,73,70,70],0);new DataView(out.buffer).setUint32(4,out.length-8,true);out.set([87,69,66,80],8);let at=12;for(const c of chunks){out.set(c,at);at+=c.length;}return out;
}
test('static WebP without ICC uses the format sRGB default; ICC and corrupt containers never take that default',()=>{
  assert.deepEqual(inspectSourceColor(webpFixture()),{kind:'srgb',format:'webp',width:100,height:80,depth:8,reason:'webp-default'});
  assert.equal(inspectSourceColor(webpFixture(100,80,true))?.kind,'icc');
  for(const mutate of [(b:Uint8Array)=>b.slice(0,-1),(b:Uint8Array)=>{b[20]=32;return b;},(b:Uint8Array)=>{b[20]=2;return b;}])assert.throws(()=>inspectSourceColor(mutate(webpFixture())),/颜色|WebP/);
  assert.equal(inspectSourceColor(new Uint8Array([1,2,3])),undefined);
  const animated=webpFixture();animated[20]=2;assert.throws(()=>inspectSourceColor(animated),/动画 WebP.*静态副本/);
});
test('PNG explicit sRGB is saved color information without ICC; bad CRCs are rejected',()=>{
  const bytes=encodePng({width:2,height:2,rgba:new Uint8Array(16).fill(255)});
  assert.equal(inspectSourceColor(bytes)?.reason,'png-srgb');
  const bad=bytes.slice();bad[bad.length-1]^=1;assert.throws(()=>inspectSourceColor(bad),/颜色|校验/);
});
test('source picker binds the actual file path and dimensions with a bounded read, retaining unsaved edits',async()=>{
  let reads=0,picks=0;const bytes=webpFixture();
  const file:any={nativePath:'D:\\Pictures\\test.webp',isFile:true,getMetadata:async()=>({size:bytes.length}),read:async()=>{reads++;return bytes.buffer;}};
  const uxp:any={storage:{formats:{binary:'binary'},localFileSystem:{getFileForOpening:async()=>{picks++;return file;}}}};
  const reader=createSourceColorReader(uxp),doc={path:'D:\\Pictures\\test.webp',saved:true,width:100,height:80,bitsPerChannel:8};
  assert.equal((await reader(doc))?.reason,'webp-default');assert.equal(picks,1);assert.equal(reads,1);
  file.nativePath='D:\\Pictures\\other.webp';await assert.rejects(reader(doc),/当前文档/);assert.equal(reads,1);
  file.nativePath=doc.path;assert.equal((await reader({...doc,saved:false}))?.kind,'srgb');assert.equal(reads,2);
  await assert.rejects(reader({...doc,path:''}),/原文件/);assert.equal(reads,2);
  file.getMetadata=async()=>({size:MAX_SOURCE_FILE_BYTES+1});await assert.rejects(reader(doc),/过大/);assert.equal(reads,2);
  file.getMetadata=async()=>({size:bytes.length});await assert.rejects(reader({...doc,width:101}),/尺寸|位深/);
});

test('file access errors stay actionable without exposing private source paths',async()=>{
  const reader=createSourceColorReader({storage:{localFileSystem:{getFileForOpening:async()=>{throw new Error('access denied D:\\private\\image.webp');}}}});
  await assert.rejects(reader({path:'D:\\private\\image.webp',saved:true}),e=>e instanceof Error&&!e.message.includes('private')&&/读取|文件/.test(e.message));
});
