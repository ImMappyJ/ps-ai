import test from 'node:test';
import assert from 'node:assert/strict';
import {encodePng,decodePng,decodeModelPng} from '../src/imaging/image';
import {deflateSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';

const image={width:2,height:1,rgba:new Uint8Array([230,20,10,0,20,90,240,7])};
// Test fixtures create valid chunks independently of the decoder under test.
function crc(bytes:Uint8Array){let n=0xffffffff;for(const b of bytes){n^=b;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
function chunk(type:string,data:Uint8Array){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);b.set(data,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;}
function chunks(bytes:Uint8Array){const out:Buffer[]=[];for(let at=8;at<bytes.length;){const n=new DataView(bytes.buffer,bytes.byteOffset).getUint32(at);out.push(Buffer.from(bytes.subarray(at,at+n+12)));at+=n+12;}return out;}
function fixture(extra:Buffer[],tagged=false){const list=chunks(encodePng(image)).filter(b=>b.toString('ascii',4,8)!=='sRGB'||tagged);return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),list[0],...extra,...list.slice(1)]));}
function u32(n:number){const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;}
function pixelsPng(scan:Uint8Array,ctype=2,interlace=0,extra:Buffer[]=[],width=2,height=1){
  const header=Buffer.concat([u32(width),u32(height),Buffer.from([8,ctype,0,0,interlace])]);
  return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('sRGB',new Uint8Array([1])),...extra,chunk('IDAT',deflateSync(scan)),chunk('IEND',new Uint8Array())]));
}

test('empty iTXt cannot hang a decoder; irrelevant metadata never enters UPNG',()=>{
  const png=encodePng(image),list=chunks(png);
  const malformed=Buffer.concat([Buffer.from(png.subarray(0,8)),...list.slice(0,-1),chunk('iTXt',new Uint8Array()),list[list.length-1]]);
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',"import {decodePng} from './src/imaging/image.ts'; process.stdout.write(JSON.stringify([...decodePng(Buffer.from(process.argv[1],'hex')).rgba]));",malformed.toString('hex')],{timeout:3000,encoding:'utf8'});
  assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),[...image.rgba]);
});
test('pixel inflation must exactly match scanlines, finish its zlib stream and use valid filters',()=>{
  for(const scan of [new Uint8Array([0]),new Uint8Array(1024*1024),new Uint8Array([5,1,2,3,4,5,6])])
    assert.throws(()=>decodePng(pixelsPng(scan)),(e:any)=>e.code==='invalid-output');
  const list=chunks(pixelsPng(new Uint8Array([0,1,2,3,4,5,6])));
  for(const transform of [(data:Buffer)=>data.subarray(0,-1),(data:Buffer)=>Buffer.concat([data,Buffer.from([0])])]){
    const modified=list.map(b=>b.toString('ascii',4,8)==='IDAT'?chunk('IDAT',transform(b.subarray(8,-4))):b);
    assert.throws(()=>decodePng(new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),...modified]))),(e:any)=>e.code==='invalid-output');
  }
});
test('supported scanline layouts retain gray, palette transparency and Adam7 pixels',()=>{
  assert.deepEqual([...decodePng(pixelsPng(new Uint8Array([0,10,250]),0)).rgba],[10,10,10,255,250,250,250,255]);
  const palette=chunk('PLTE',new Uint8Array([10,20,30,100,110,120])),alpha=chunk('tRNS',new Uint8Array([0,7]));
  assert.deepEqual([...decodePng(pixelsPng(new Uint8Array([0,0,1]),3,0,[palette,alpha])).rgba],[10,20,30,0,100,110,120,7]);
  assert.throws(()=>decodePng(pixelsPng(new Uint8Array([0,0,2]),3,0,[palette])),(e:any)=>e.code==='invalid-output');
  // A 2x1 Adam7 raster stores pixel 0 in pass 1 and pixel 1 in pass 6.
  assert.deepEqual([...decodePng(pixelsPng(new Uint8Array([0,10,20,30,0,40,50,60]),2,1)).rgba],[10,20,30,255,40,50,60,255]);
  assert.throws(()=>decodePng(pixelsPng(new Uint8Array([0]),2,1)),(e:any)=>e.code==='invalid-output');
});

test('encoded PNG declares sRGB and keeps straight low-alpha and hidden RGB',()=>{
  const png=encodePng(image),tag=chunks(png).find(b=>b.toString('ascii',4,8)==='sRGB');
  assert.ok(tag);assert.equal(tag[8],1);assert.deepEqual(decodePng(png),image);
});
test('invalid PNG signature and unsupported depth are classified as output errors',()=>{
  assert.throws(()=>decodePng(new Uint8Array([1,2,3])),(e:any)=>e.code==='invalid-output');
  const png=encodePng(image);png[24]=16;
  assert.throws(()=>decodePng(png),(e:any)=>e.code==='invalid-output');
});
test('untagged output needs an explicit verified-template allowance',()=>{
  const png=fixture([]);assert.throws(()=>decodePng(png),/未标记|untagged/i);
  assert.deepEqual(decodePng(png,{allowUntagged:true}),image);
});
test('a new template cannot inherit the untagged-output convention',()=>{
  const png=fixture([]);
  assert.deepEqual(decodeModelPng(png,'qwen21-local-v2-rgba'),image);
  assert.throws(()=>decodeModelPng(png,'new-template'),/未标记/);
});
test('conflicting gamma, chromaticities, ICC and HDR metadata cannot silently become sRGB',()=>{
  for(const extra of [chunk('gAMA',u32(100000)),chunk('cHRM',new Uint8Array(32)),chunk('iCCP',new Uint8Array([65,0,0,120,156])),chunk('cICP',new Uint8Array([9,16,0,1]))]){
    assert.throws(()=>decodePng(fixture([extra],true),{allowUntagged:true}),/色彩|profile|sRGB/i);
  }
  assert.throws(()=>decodePng(fixture([chunk('gAMA',u32(45455))])),/未标记|untagged/i);
  assert.deepEqual(decodePng(fixture([chunk('gAMA',u32(45455))],true)),image);
});
test('truncated, duplicated, misplaced and corrupt color chunks fail before decoding pixels',()=>{
  const png=encodePng(image),bad=new Uint8Array(png);bad[41]^=1;
  assert.throws(()=>decodePng(bad),/PNG/);
  assert.throws(()=>decodePng(png.subarray(0,png.length-3)),/PNG/);
  assert.throws(()=>decodePng(fixture([chunk('sRGB',new Uint8Array([1]))],true)),/PNG|色彩/);
  assert.throws(()=>decodePng(fixture([chunk('sRGB',new Uint8Array([5]))])),/PNG|色彩/);
  const list=chunks(png),tag=list.find(b=>b.toString('ascii',4,8)==='sRGB')!;
  const late=Buffer.concat([Buffer.from(png.subarray(0,8)),...list.filter(b=>b!==tag).slice(0,-1),tag,list[list.length-1]]);
  assert.throws(()=>decodePng(late),/PNG|色彩/);
});
