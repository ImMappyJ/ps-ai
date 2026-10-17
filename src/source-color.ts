import {ColorContractError,validatePngColor} from './color';

export type SourceColorReason='webp-default'|'png-srgb';
export interface SavedSourceColor {kind:'srgb'|'icc'|'unknown';format:'webp'|'png';width:number;height:number;depth:number;reason?:SourceColorReason}
export type SourceColorReader=(doc:any,file?:any)=>Promise<SavedSourceColor|undefined>;
export const MAX_SOURCE_FILE_BYTES=64_000_000;
const invalid=(message='来源文件颜色声明或结构错误；请检查原图，或在副本中指定正确配置文件')=>new ColorContractError('source-profile',message);
const text=(bytes:Uint8Array,at:number,n:number)=>String.fromCharCode(...bytes.subarray(at,at+n));

// Inspect declarations only; Photoshop remains the pixel/ICC decoder. Never infer
// a color space from the filename, RGB mode, bit depth or an unknown file format.
export function inspectSourceColor(bytes:Uint8Array):SavedSourceColor|undefined {
  if(bytes.length>MAX_SOURCE_FILE_BYTES)throw invalid('来源文件过大；请在副本中指定正确配置文件');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(text(bytes,0,4)==='RIFF'&&text(bytes,8,4)==='WEBP'){
    if(bytes.length<20||view.getUint32(4,true)+8!==bytes.length)throw invalid();
    let width=0,height=0,frameWidth=0,frameHeight=0,flags:number|undefined,icc=false,frame=false,at=12;
    const seen=new Set<string>();
    while(at+8<=bytes.length){
      const kind=text(bytes,at,4),length=view.getUint32(at+4,true),start=at+8,end=start+length,padded=end+(length%2);
      if(padded>bytes.length||(length%2&&bytes[end]!==0))throw invalid();
      if(['VP8X','ICCP','VP8 ','VP8L','ANIM','ANMF'].includes(kind)&&seen.has(kind))throw invalid();
      seen.add(kind);
      if(kind==='VP8X'){
        if(at!==12||length!==10||bytes[start]&0xc1||bytes[start+1]||bytes[start+2]||bytes[start+3])throw invalid();
        flags=bytes[start];width=1+bytes[start+4]+(bytes[start+5]<<8)+(bytes[start+6]<<16);height=1+bytes[start+7]+(bytes[start+8]<<8)+(bytes[start+9]<<16);
        if(flags&2)throw invalid('动画 WebP 不能自动确定当前帧颜色；请准备带配置文件的静态副本');
      }
      if(kind==='ICCP'){
        if(frame||flags===undefined||!(flags&32)||length<132||view.getUint32(start)!==length||text(bytes,start+36,4)!=='acsp'||text(bytes,start+16,4)!=='RGB ')throw invalid();
        icc=true;
      }
      if(kind==='VP8 '){
        if(frame||length<10||bytes[start]&1||text(bytes,start+3,3)!=='\x9d\x01\x2a')throw invalid();
        frameWidth=view.getUint16(start+6,true)&16383;frameHeight=view.getUint16(start+8,true)&16383;frame=true;
      }
      if(kind==='VP8L'){
        if(frame||length<5||bytes[start]!==47||bytes[start+4]&224)throw invalid();
        const bits=view.getUint32(start+1,true);frameWidth=(bits&16383)+1;frameHeight=((bits>>>14)&16383)+1;frame=true;
      }
      if(kind==='ANIM'||kind==='ANMF')throw invalid();
      at=padded;
    }
    if(at!==bytes.length||!frame||!frameWidth||!frameHeight||(flags!==undefined&&!!(flags&32)!==icc))throw invalid();
    if(flags!==undefined&&(width!==frameWidth||height!==frameHeight))throw invalid();
    return {kind:icc?'icc':'srgb',format:'webp',width:width||frameWidth,height:height||frameHeight,depth:8,...(icc?{}:{reason:'webp-default'})};
  }
  if(bytes.length>=8&&text(bytes,0,8)==='\x89PNG\r\n\x1a\n'){
    if(bytes.length<33||view.getUint32(8)!==13||text(bytes,12,4)!=='IHDR')throw invalid();
    const info={format:'png' as const,width:view.getUint32(16),height:view.getUint32(20),depth:bytes[24]};
    let srgb=false,custom=false,at=8;
    while(at+12<=bytes.length){
      const length=view.getUint32(at),end=at+length+12;if(end>bytes.length)throw invalid();
      const kind=text(bytes,at+4,4);if(['iCCP','cICP','mDCv','cLLi'].includes(kind))custom=true;if(kind==='sRGB')srgb=true;
      at=end;
    }
    if(at!==bytes.length)throw invalid();
    // Do not replace embedded/custom declarations with a lower-priority sRGB tag.
    // They must be handled by Photoshop's actual document ICC instead.
    if(custom)return {...info,kind:'icc'};
    if(!srgb)return {...info,kind:'unknown'};
    try{validatePngColor(bytes);}catch{throw invalid('来源 PNG 颜色声明或校验错误；请检查原图');}
    return {...info,kind:'srgb',reason:'png-srgb'};
  }
  return undefined;
}

function samePath(left:string,right:string):boolean {
  const normalize=(path:string)=>path.replace(/\\/g,'/');
  const a=normalize(left),b=normalize(right);return /^[A-Za-z]:\//.test(a)?a.toLowerCase()===b.toLowerCase():a===b;
}
// Request-only UXP access: a picker grants access to exactly the source entry.
// No arbitrary file: URL, persistent path grant or file content enters history.
export function createSourceColorReader(uxp:any):SourceColorReader {
  return async(doc,file)=>{
    try {
      if(typeof doc.path!=='string'||!doc.path)throw invalid('来源没有可核对的原文件；请在副本中指定正确配置文件后重试');
      file??=await uxp.storage.localFileSystem.getFileForOpening({types:['webp','png','jpg','jpeg','psd','psb','tif','tiff']});
      if(!file)throw invalid('未选择来源文件；请重试并选择当前文档对应的原图');
      if(!file.isFile||typeof file.nativePath!=='string'||!samePath(doc.path,file.nativePath))throw invalid('请选择当前文档对应的原文件，不能使用另一张图片的颜色信息');
      const metadata=await file.getMetadata();
      if(!Number.isSafeInteger(metadata.size)||metadata.size<0||metadata.size>MAX_SOURCE_FILE_BYTES)throw invalid('来源文件过大；请在副本中指定正确配置文件');
      const bytes=new Uint8Array(await file.read({format:uxp.storage.formats.binary}));
      const color=inspectSourceColor(bytes);
      if(color&&(color.width!==doc.width||color.height!==doc.height))throw invalid('来源文件尺寸或位深与当前文档不同；请在副本中指定正确配置文件');
      return color;
    }catch(error){if(error instanceof ColorContractError)throw error;throw invalid('无法读取来源文件；请重新选择原图，或在副本中指定正确配置文件');}
  };
}
