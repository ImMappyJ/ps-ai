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

test('automatic color inspection never opens a source picker for absent or unavailable grants',async()=>{
  let picks=0;
  const reader=createSourceColorReader({storage:{localFileSystem:{getFileForOpening:async()=>{picks++;throw Error('must not pick');}}}});
  assert.equal(await reader({path:'D:\\composite.psd',width:100,height:80}),undefined);
  assert.equal(await reader({path:undefined,width:100,height:80}),undefined);
  assert.equal(picks,0);
});
test('explicit source grants bind actual paths and dimensions with bounded reads, retaining unsaved edits',async()=>{
  let reads=0,picks=0;const bytes=webpFixture();
  const file:any={nativePath:'D:\\Pictures\\test.webp',isFile:true,getMetadata:async()=>({size:bytes.length}),read:async()=>{reads++;return bytes.buffer;}};
  const uxp:any={storage:{formats:{binary:'binary'},localFileSystem:{getFileForOpening:async()=>{picks++;return file;}}}};
  const reader=createSourceColorReader(uxp),doc={path:'D:\\Pictures\\test.webp',saved:true,width:100,height:80,bitsPerChannel:8};
  assert.equal((await reader(doc,file))?.reason,'webp-default');assert.equal(picks,0);assert.equal(reads,1);
  file.nativePath='D:\\Pictures\\other.webp';assert.equal(await reader(doc),undefined);assert.equal(reads,1);
  assert.equal((await reader(doc,file)),undefined);assert.equal(reads,1);
  file.nativePath=doc.path;await reader(doc,file);
  assert.equal((await reader({...doc,saved:false}))?.kind,'srgb');assert.equal(reads,3);
  assert.equal(await reader({...doc,path:''}),undefined);assert.equal(reads,3);
  file.getMetadata=async()=>({size:MAX_SOURCE_FILE_BYTES+1});assert.equal(await reader(doc),undefined);assert.equal(reads,3);
  file.getMetadata=async()=>({size:bytes.length});assert.equal(await reader({...doc,width:101}),undefined);
});

test('unavailable file access returns unknown without exposing private source paths',async()=>{
  const reader=createSourceColorReader({storage:{localFileSystem:{getFileForOpening:async()=>{throw new Error('access denied D:\\private\\image.webp');}}}});
  assert.equal(await reader({path:'D:\\private\\image.webp',saved:true}),undefined);
});

function accessFixture(){
  let bytes:Uint8Array=webpFixture(),picks=0,reads=0,tokens=0;let saved:any=null;
  const path='D:\\Pictures\\test.webp',entries=new Map<string,any>();
  const file:any={nativePath:path,isFile:true,getMetadata:async()=>({size:bytes.length}),read:async()=>{reads++;return bytes.buffer;}};
  const uxp:any={storage:{formats:{binary:'binary'},localFileSystem:{getFileForOpening:async()=>{picks++;return file;},createPersistentToken:async(entry:any)=>{const token=`opaque-${++tokens}`;entries.set(token,entry);return token;},getEntryForPersistentToken:async(token:string)=>{if(!entries.has(token))throw Error('revoked private-token');return entries.get(token);}}}};
  const storage:any={readJson:async()=>saved,json:async(_name:string,value:any)=>{saved=JSON.parse(JSON.stringify(value));}};
  const doc={path,width:100,height:80,bitsPerChannel:8};
  return {uxp,storage,doc,file,entries,counts:()=>({picks,reads,tokens}),saved:()=>saved,replace:(next:Uint8Array)=>bytes=next};
}

test('session source access reuses only the exact path and re-inspects changed bytes on every read',async()=>{
  const h=accessFixture();let notices=0;const reader=createSourceColorReader(h.uxp,{onPicker:()=>notices++} as any);
  assert.equal((await reader(h.doc,h.file))?.kind,'srgb');assert.equal((await reader({...h.doc,path:'d:/pictures/TEST.webp'}))?.kind,'srgb');
  assert.deepEqual(h.counts(),{picks:0,reads:2,tokens:0});assert.equal(notices,0);
  h.replace(webpFixture(100,80,true));assert.equal((await reader(h.doc))?.kind,'icc','old sRGB proof must never be cached');
  h.replace(webpFixture(101,80));assert.equal(await reader(h.doc),undefined);
  h.replace(webpFixture().slice(0,-1));assert.equal(await reader(h.doc),undefined);
  assert.equal(h.counts().picks,0,'invalid bytes never reopen a picker');
});

test('enabling private remembering persists a previously authorized handle and a fresh reader restores it',async()=>{
  const h=accessFixture(),reader:any=createSourceColorReader(h.uxp,{storage:h.storage} as any);
  await reader(h.doc,h.file);assert.equal(h.saved(),null);await reader.setRemember(true);
  assert.equal(h.saved().remember,true);assert.equal(h.saved().entries.length,1);assert.equal(h.counts().tokens,1);
  const restored:any=createSourceColorReader(h.uxp,{storage:h.storage} as any);await restored.ready();assert.equal(restored.remember,true);
  assert.equal((await restored(h.doc))?.reason,'webp-default');assert.equal(h.counts().picks,0);assert.equal(h.counts().reads,2);
  assert.doesNotMatch(JSON.stringify(h.saved()),/rgba|srgb|webp-default|width|height/);
});

test('revoked, moved and unreadable restored grants return unknown without another picker',async()=>{
  for(const failure of ['revoked','wrong-path','unreadable']){
    const h=accessFixture(),first:any=createSourceColorReader(h.uxp,{storage:h.storage} as any);await first.setRemember(true);await first(h.doc,h.file);
    const token=h.saved().entries[0].token;
    if(failure==='revoked')h.entries.delete(token);
    if(failure==='wrong-path')h.entries.set(token,{...h.file,nativePath:'D:\\Private\\other.webp',read:async()=>{throw Error('wrong file must not be read');}});
    if(failure==='unreadable')h.entries.set(token,{...h.file,read:async()=>{throw Error('access denied D:\\Private\\image.webp');}});
    const next=createSourceColorReader(h.uxp,{storage:h.storage} as any);assert.equal(await next(h.doc),undefined);assert.equal(h.counts().picks,0);
  }
});

test('remembering is optional when token APIs or private storage are unavailable, preserving session reads',async()=>{
  for(const unavailable of ['tokens','storage']){
    const h=accessFixture(),statuses:string[]=[];
    if(unavailable==='tokens')delete h.uxp.storage.localFileSystem.createPersistentToken;
    if(unavailable==='storage')h.storage.json=async()=>{throw Error('private path and token must stay redacted');};
    const reader:any=createSourceColorReader(h.uxp,{storage:h.storage,onStatus:(value:string)=>statuses.push(value)} as any);
    await reader.setRemember(true).catch(()=>{});assert.equal((await reader(h.doc,h.file))?.kind,'srgb');assert.equal((await reader(h.doc))?.kind,'srgb');
    assert.equal(h.counts().picks,0);assert.ok(statuses.length>0);assert.doesNotMatch(statuses.join(' '),/private path|opaque-/);
  }
});

test('opting out removes private grants while clear also drops session handles',async()=>{
  const h=accessFixture(),reader:any=createSourceColorReader(h.uxp,{storage:h.storage} as any);
  await reader.setRemember(true);await reader(h.doc,h.file);await reader.setRemember(false);
  assert.equal(h.saved().remember,false);assert.deepEqual(h.saved().entries,[]);assert.equal((await reader(h.doc))?.kind,'srgb');
  await reader.forget();assert.equal(await reader(h.doc),undefined);assert.equal(h.counts().picks,0);
});

test('opt-out and clear serialize after an in-flight grant write so stale grants cannot return',async()=>{
  for(const clear of [false,true]){
    const h=accessFixture(),reader:any=createSourceColorReader(h.uxp,{storage:h.storage} as any);await reader.setRemember(true);
    const write=h.storage.json;let release!:()=>void,start!:()=>void;const started=new Promise<void>(r=>start=r),barrier=new Promise<void>(r=>release=r);
    h.storage.json=async(name:string,value:any)=>{if(value.entries.length){start();await barrier;}await write(name,value);};
    const reading=reader(h.doc,h.file);await started;const removing=clear?reader.forget():reader.setRemember(false);release();await Promise.all([reading,removing]);
    assert.deepEqual(h.saved().entries,[]);if(!clear)assert.equal(h.saved().remember,false);
    assert.equal((await reader(h.doc))?.kind,clear?undefined:'srgb');assert.equal(h.counts().picks,0);
  }
});

test('a read started while Clear waits for a write cannot restore the grant being cleared',async()=>{
  const h=accessFixture(),reader:any=createSourceColorReader(h.uxp,{storage:h.storage} as any);await reader.setRemember(true);
  const write=h.storage.json;let release!:()=>void,start!:()=>void;const started=new Promise<void>(r=>start=r),barrier=new Promise<void>(r=>release=r);
  h.storage.json=async(name:string,value:any)=>{if(value.entries.length){start();await barrier;}await write(name,value);};
  const first=reader(h.doc,h.file);await started;const clearing=reader.forget(),next=reader(h.doc);
  try{assert.equal(await next,undefined,'the old persistent token must disappear immediately');assert.equal(h.counts().picks,0);}
  finally{release();await Promise.all([first,clearing,next]);}
});

test('failed Clear keeps newly authorized session handles as well as earlier useful access',async()=>{
  const h=accessFixture(),reader:any=createSourceColorReader(h.uxp,{storage:h.storage} as any);await reader(h.doc,h.file);
  let release!:()=>void,start!:()=>void;const started=new Promise<void>(r=>start=r),barrier=new Promise<void>(r=>release=r);
  h.storage.json=async()=>{start();await barrier;throw Error('private storage unavailable');};
  const clearing=reader.forget().catch(()=>{});await started;const path='D:\\Pictures\\new.webp';h.file.nativePath=path;const next=reader({...h.doc,path},h.file);
  await new Promise(r=>setTimeout(r,0));release();await Promise.all([clearing,next]);
  assert.equal((await reader({...h.doc,path}))?.kind,'srgb','a failed removal must not discard a newly approved handle');assert.equal(h.counts().picks,0);
});

test('failed grant removal is actionable and redacted, retaining useful authorized session access',async()=>{
  const h=accessFixture(),reader:any=createSourceColorReader(h.uxp,{storage:h.storage} as any);await reader.setRemember(true);await reader(h.doc,h.file);
  h.storage.json=async()=>{throw Error('cannot delete D:\\private\\opaque-1');};
  await assert.rejects(reader.forget(),(e:any)=>/清除|clear/i.test(e.message)&&!/private|opaque-1/.test(e.message));
  assert.equal(h.saved().entries.length,1);assert.equal((await reader(h.doc))?.kind,'srgb');assert.equal(h.counts().picks,0);
});

test('private storage rejects unknown schema, missing/native URL paths and more than 32 grants',async()=>{
  for(const malformed of [{schemaVersion:2,remember:true,entries:[]},{schemaVersion:1,remember:true,entries:[{token:'secret'}]},{schemaVersion:1,remember:true,entries:[{path:'file:///D:/private.webp',token:'secret'}]},{schemaVersion:1,remember:true,entries:Array.from({length:33},(_,i)=>({path:`d:/pictures/${i}.webp`,token:`opaque-${i}`}))}]){
    const h=accessFixture();h.storage.readJson=async()=>malformed;
    const reader:any=createSourceColorReader(h.uxp,{storage:h.storage} as any);await reader.ready();assert.equal(reader.remember,false);assert.equal(await reader(h.doc),undefined);assert.equal(h.counts().picks,0);
  }
});

test('source entry moved during reading cannot provide color proof for its previous path',async()=>{
  const h=accessFixture(),reader=createSourceColorReader(h.uxp);h.file.read=async()=>{h.file.nativePath='D:\\Pictures\\other.webp';return webpFixture().buffer;};
  assert.equal(await reader(h.doc,h.file),undefined);
});

test('private remembering remains bounded after approving more than 32 distinct native paths',async()=>{
  const h=accessFixture(),reader:any=createSourceColorReader(h.uxp,{storage:h.storage} as any);await reader.setRemember(true);
  for(let i=0;i<33;i++){const path=`D:\\Pictures\\${i}.webp`,entry={...h.file,nativePath:path};await reader({...h.doc,path},entry);}
  assert.equal(h.saved().entries.length,32);assert.equal(h.saved().entries.some((e:any)=>e.path==='d:/pictures/0.webp'),false);assert.equal(h.saved().entries.some((e:any)=>e.path==='d:/pictures/32.webp'),true);
});
