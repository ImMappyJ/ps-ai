import test from 'node:test';import assert from 'node:assert/strict';import {deflateSync,inflateSync} from 'node:zlib';
import {encodePng,decodePng,decodeModelPng,resize,expandPixels,convertDepth,rasterDepth} from '../src/image';
import {retainSourceAlpha,prepareEditCandidate,alphaBounds} from '../src/composite';
function chunk(type:string,data:Uint8Array){const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);out.set(data,8);let n=0xffffffff;for(const v of out.subarray(4,-4)){n^=v;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}out.writeUInt32BE((n^0xffffffff)>>>0,out.length-4);return out;}
function fixture(depth=16,type=6,tagged=true,extra=0){const samples=[12345,23456,34567,45678,65432,54321,43210,32109];const head=Buffer.alloc(13);head.writeUInt32BE(2);head.writeUInt32BE(1,4);head[8]=depth;head[9]=type;const raw=Buffer.alloc(1+2*(type===2?3:4)*2+extra);for(let i=0;i<(type===2?6:8);i++)raw.writeUInt16BE(samples[i],1+i*2);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),...(tagged?[chunk('sRGB',new Uint8Array([1]))]:[]),chunk('IDAT',deflateSync(raw)),chunk('IEND',new Uint8Array())]);}
test('independent RGB16/RGBA16 fixtures preserve all sample bits and the 16-bit template requires tagged16',()=>{
  const rgba=decodePng(fixture());assert.ok(rgba.rgba instanceof Uint16Array);assert.deepEqual([...rgba.rgba],[12345,23456,34567,45678,65432,54321,43210,32109]);
  assert.deepEqual([...decodePng(fixture(16,2)).rgba],[12345,23456,34567,65535,45678,65432,54321,65535]);
  assert.deepEqual(decodeModelPng(fixture(),'qwen21-local-v3-rgba16'),rgba);
  assert.throws(()=>decodeModelPng(fixture(16,6,false),'qwen21-local-v3-rgba16'),/sRGB/);
  assert.throws(()=>decodeModelPng(fixture(),'qwen21-local-v2-rgba'),/8|位深/);
  assert.throws(()=>decodeModelPng(encodePng({width:1,height:1,rgba:new Uint8Array(4)}),'qwen21-local-v3-rgba16'),/16|位深/);
  for(const f of [fixture(16,6,true,1),fixture(12),fixture(16,3)])assert.throws(()=>decodePng(f));
});
test('16-bit PNG writer stores network-order samples with explicit sRGB, independent inflate and exact roundtrip',()=>{
  const input={width:2,height:1,rgba:new Uint16Array([17,1025,65530,0,65433,12345,32769,45678])};const bytes=encodePng(input);assert.equal(bytes[24],16);assert.equal(bytes[25],6);assert.ok(Buffer.from(bytes).includes(Buffer.from('sRGB')));
  let at=8;const parts:Uint8Array[]=[];while(at<bytes.length){const n=new DataView(bytes.buffer,bytes.byteOffset).getUint32(at);if(Buffer.from(bytes.subarray(at+4,at+8)).toString()==='IDAT')parts.push(bytes.subarray(at+8,at+8+n));at+=n+12;}
  const raw=inflateSync(Buffer.concat(parts));assert.equal(raw[0],0);for(let i=0;i<input.rgba.length;i++)assert.equal(raw.readUInt16BE(1+i*2),input.rgba[i]);assert.deepEqual(decodePng(bytes),input);
});
test('16-bit resize/alignment/alpha keep fractional samples; preview conversion is a separate copy',()=>{
  const image={width:2,height:1,rgba:new Uint16Array([65001,0,0,0,12345,23456,34567,65535])};const out=resize(image,3,1);assert.ok(out.rgba instanceof Uint16Array);assert.deepEqual([...out.rgba.slice(4,8)],[12345,23456,34567,32768]);
  const source={width:3,height:1,rgba:new Uint16Array([1,2,3,0,4444,5555,6666,30001,7777,8888,9999,65535])};const retained=retainSourceAlpha(out,source);assert.equal(retained.rgba[7],30001);assert.equal(retained.rgba[4],12345);
  const p=prepareEditCandidate(out,source,{preserveAlpha:true,align:false});assert.equal(p.rgba[7],30001);assert.equal(rasterDepth(p),16);assert.deepEqual(alphaBounds(p),{left:1,top:0,right:3,bottom:1});
  assert.ok(expandPixels(p,{left:0,top:0,right:3,bottom:1},{left:0,top:0,right:4,bottom:1}).rgba instanceof Uint16Array);
  const preview=convertDepth(p,8);assert.ok(preview.rgba instanceof Uint8Array);assert.equal(preview.rgba[4],48);assert.equal(p.rgba[4],12345);assert.equal(convertDepth(preview,16).rgba[4],48*257);
});
test('16-bit context matching keeps sample residue and scales calibration thresholds',()=>{
  const rgba=new Uint16Array(12*12*4),src=new Uint16Array(rgba.length);for(let p=0;p<144;p++){rgba.set([20561,25813,30953,65535],p*4);src.set([20561-2570,25813-2570,30953-2570,65535],p*4);}
  const out=prepareEditCandidate({width:12,height:12,rgba},{width:12,height:12,rgba:src},{preserveAlpha:true,align:false,matchColor:true,mask:new Uint8Array(144)});assert.deepEqual([...out.rgba.slice(0,4)],[17991,23243,28383,65535]);assert.ok(out.rgba instanceof Uint16Array);
});
test('independent16 scanlines cover every filter and Adam7 empty passes without reducing samples',()=>{
  const width=5,height=3;
  for(const channels of [3,4])for(const interlace of [0,1])for(let filter=0;filter<5;filter++){
    const expected=new Uint16Array(width*height*4);for(let p=0;p<width*height;p++)expected.set([12345+p*7,23456+p*11,34567+p*13,channels===4?45678+p*17:65535],p*4);
    const rows:Buffer[]=[];const passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
    for(const [x0,y0,dx,dy] of passes){const xs=Array.from({length:Math.max(0,Math.ceil((width-x0)/dx))},(_,i)=>x0+i*dx);if(!xs.length)continue;let prior=Buffer.alloc(xs.length*channels*2);
      for(let y=y0;y<height;y+=dy){const raw=Buffer.alloc(prior.length);xs.forEach((x,j)=>{for(let c=0;c<channels;c++)raw.writeUInt16BE(expected[(y*width+x)*4+c],(j*channels+c)*2);});const encoded=Buffer.alloc(raw.length+1);encoded[0]=filter;
        for(let i=0;i<raw.length;i++){const a=i>=channels*2?raw[i-channels*2]:0,b=prior[i],c=i>=channels*2?prior[i-channels*2]:0,p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);const prediction=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):da<=db&&da<=dc?a:db<=dc?b:c;encoded[i+1]=(raw[i]-prediction)&255;}rows.push(encoded);prior=raw;
      }
    }
    const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header.set([16,channels===4?6:2,0,0,interlace],8);const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('sRGB',new Uint8Array([1])),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',new Uint8Array())]);
    assert.deepEqual(decodePng(png),{width,height,rgba:expected},`channels=${channels} interlace=${interlace} filter=${filter}`);
  }
});
