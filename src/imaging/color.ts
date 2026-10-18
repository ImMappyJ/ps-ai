// Raster channels are straight (unassociated) sRGB RGBA8 or RGBA16.
// UPNG does not perform ICC/gamma conversion. Reject metadata we cannot honor.
export class ColorContractError extends Error {
  constructor(public code:'invalid-output'|'source-profile',message:string){super(message);this.name='ColorContractError';}
}
export function requireSourceProfile(doc:{colorProfileName?:string;colorProfileType?:unknown},noneType?:unknown):void {
  const name=doc.colorProfileName?.trim();
  if(!name||/^(none|untagged|未标记|无配置|无$)/i.test(name)||(noneType!==undefined&&doc.colorProfileType===noneType))
    throw new ColorContractError('source-profile','无法确定来源色彩空间；请在副本中指定正确配置文件后重试，原文档不会自动修改');
}
export function hasSourceProfile(doc:{colorProfileName?:string;colorProfileType?:unknown},noneType?:unknown):boolean {
  try{requireSourceProfile(doc,noneType);return true;}catch{return false;}
}
const crcTable=Uint32Array.from({length:256},(_,i)=>{for(let k=0;k<8;k++)i=(i>>>1)^((i&1)?0xedb88320:0);return i>>>0;});
function crc(bytes:Uint8Array,start:number,end:number):number {let n=0xffffffff;for(let i=start;i<end;i++)n=(n>>>8)^crcTable[(n^bytes[i])&255];return (n^0xffffffff)>>>0;}
export function validatePngColor(bytes:Uint8Array,allowUntagged=false):void {
  const invalid=()=>new ColorContractError('invalid-output','PNG 结构或校验错误，原始候选已保留，请检查后端输出');
  const unsupported=()=>new ColorContractError('invalid-output','PNG 色彩标记不兼容；仅接受 sRGB 8/16-bit，请在后端转换为 sRGB 后输出');
  if(bytes.length>128_000_000)throw invalid();
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),seen=new Set<string>();
  let at=8,dataSeen=false,ended=false,tagged=false;
  while(at+12<=bytes.length){
    const length=view.getUint32(at),end=at+length+12;if(end>bytes.length)throw invalid();
    const type=String.fromCharCode(...bytes.subarray(at+4,at+8));
    if(!/^[A-Za-z]{4}$/.test(type)||crc(bytes,at+4,end-4)!==view.getUint32(end-4))throw invalid();
    if(at===8&&(type!=='IHDR'||length!==13))throw invalid();
    if(['IHDR','IEND','sRGB','gAMA','cHRM','iCCP','cICP'].includes(type)&&seen.has(type))throw invalid();
    if(['sRGB','gAMA','cHRM','iCCP','cICP'].includes(type)&&dataSeen)throw invalid();
    seen.add(type);
    if(type==='sRGB'){if(length!==1||bytes[at+8]>3)throw invalid();tagged=true;}
    if(type==='gAMA'&&(length!==4||Math.abs(view.getUint32(at+8)-45455)>1))throw unsupported();
    if(type==='cHRM'){
      const srgb=[31270,32900,64000,33000,30000,60000,15000,6000];
      if(length!==32||srgb.some((n,i)=>Math.abs(view.getUint32(at+8+i*4)-n)>2))throw unsupported();
    }
    if(['iCCP','cICP','mDCv','cLLi'].includes(type))throw unsupported();
    if(type==='acTL')throw new ColorContractError('invalid-output','不支持动画 PNG');
    if(type==='IDAT')dataSeen=true;
    if(type==='IEND'){if(length!==0||!dataSeen||end!==bytes.length)throw invalid();ended=true;break;}
    // Unknown critical chunks must never be silently decoded.
    if(type[0]===type[0].toUpperCase()&&!['IHDR','PLTE','IDAT'].includes(type))throw invalid();
    at=end;
  }
  if(!ended)throw invalid();
  if(!tagged&&!allowUntagged)throw new ColorContractError('invalid-output','PNG 未标记 sRGB；只有已验证的 Qwen 2.1 模板允许按 sRGB 解释无标记输出');
}
