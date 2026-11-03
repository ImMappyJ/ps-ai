/** Bounded ICC transport only. Photoshop, not this parser, interprets color. */
export const MAX_ICC_BYTES=4*1024*1024,MAX_ICC_PSD_BYTES=8*1024*1024;
const fail=():never=>{throw new Error('实际 RGB ICC 数据缺失、损坏或超过预算');};
function view(bytes:Uint8Array,max:number):DataView {if(!(bytes instanceof Uint8Array)||bytes.length>max)fail();return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
const text=(b:Uint8Array,p:number,n:number)=>String.fromCharCode(...b.subarray(p,p+n));
export function validateRgbProfile(bytes:Uint8Array):void {
  const v=view(bytes,MAX_ICC_BYTES);if(bytes.length<132||v.getUint32(0)!==bytes.length||text(bytes,36,4)!=='acsp'||text(bytes,16,4)!=='RGB '||!['XYZ ','Lab '].includes(text(bytes,20,4))||![2,4].includes(bytes[8]))fail();
  const count=v.getUint32(128);if(!count||count>4096||132+count*12>bytes.length)fail();
  const names=new Set<string>(),ranges:{start:number;end:number}[]=[];
  for(let i=0;i<count;i++){
    const p=132+i*12,name=text(bytes,p,4),start=v.getUint32(p+4),size=v.getUint32(p+8),end=start+size;
    if(names.has(name)||start<132+count*12||start%4||size<8||end>bytes.length)fail();names.add(name);
    if(ranges.some(r=>start<r.end&&end>r.start&&(start!==r.start||end!==r.end)))fail();ranges.push({start,end});
  }
}
export function extractPsdRgbProfile(bytes:Uint8Array):Uint8Array {
  const v=view(bytes,MAX_ICC_PSD_BYTES),u32=(p:number)=>{if(p<0||p+4>bytes.length)fail();return v.getUint32(p);};
  if(bytes.length<34||text(bytes,0,4)!=='8BPS'||v.getUint16(4)!==1||v.getUint16(24)!==3)fail();
  let p=30+u32(26);const length=u32(p),end=p+4+length;p+=4;if(end>bytes.length)fail();let profile:Uint8Array|undefined;
  while(p<end){
    if(p+12>end||text(bytes,p,4)!=='8BIM')fail();const id=v.getUint16(p+4);p+=6;const name=bytes[p];p+=1+name+(1+name)%2;
    if(p+4>end)fail();const size=u32(p);p+=4;if(p+size+size%2>end)fail();
    if(id===1039){if(profile||size>MAX_ICC_BYTES)fail();profile=bytes.slice(p,p+size);validateRgbProfile(profile);}
    if(id===1041&&size&&bytes[p]!==0)fail(); // Explicitly untagged is not color proof.
    p+=size+size%2;
  }
  if(!profile)return fail();return profile;
}
/** One opaque RGB8 pixel, no layers or source metadata; resource1039 is exact. */
export function createIccSeed(profile:Uint8Array):Uint8Array {
  validateRgbProfile(profile);const size=profile.length+profile.length%2,b=new Uint8Array(55+size),v=new DataView(b.buffer);
  b.set([56,66,80,83]);v.setUint16(4,1);v.setUint16(12,3);v.setUint32(14,1);v.setUint32(18,1);v.setUint16(22,8);v.setUint16(24,3);
  v.setUint32(30,12+size);b.set([56,66,73,77],34);v.setUint16(38,1039);v.setUint32(42,profile.length);b.set(profile,46);return b;
}
