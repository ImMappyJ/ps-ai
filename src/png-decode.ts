import Pako from 'pako';
import {ColorContractError} from './color';

// Called only after signature, dimensions, CRCs and color metadata are validated.
// Do not give UPNG ancillary metadata: its text parsers are not chunk bounded.
export function checkedPixelPng(bytes:Uint8Array):{bytes:Uint8Array;paletteEntries?:number} {
  const invalid=()=>new ColorContractError('invalid-output','PNG 像素数据、格式或解压长度错误，原始候选已保留');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const width=view.getUint32(16),height=view.getUint32(20),type=bytes[25];
  const channels:Record<number,number>={0:1,2:3,3:1,4:2,6:4};
  if(!channels[type]||bytes[26]!==0||bytes[27]!==0||bytes[28]>1)throw invalid();
  const kept=[bytes.subarray(0,8)],data:Uint8Array[]=[];
  let dataSeen=false,dataEnded=false,paletteEntries:number|undefined,transparent=false;
  for(let at=8;at<bytes.length;){
    const length=view.getUint32(at),end=at+length+12,kind=String.fromCharCode(...bytes.subarray(at+4,at+8));
    if(kind[2]!==kind[2].toUpperCase()||['acTL','fcTL','fdAT'].includes(kind))throw invalid();
    if(dataSeen&&kind!=='IDAT')dataEnded=true;
    if(kind==='PLTE'){
      if(dataSeen||transparent||paletteEntries!==undefined||type===0||type===4||length<3||length>768||length%3)throw invalid();
      paletteEntries=length/3;
    }
    if(kind==='tRNS'){
      if(dataSeen||transparent||!((type===0&&length===2)||(type===2&&length===6)||(type===3&&paletteEntries!==undefined&&length>0&&length<=paletteEntries)))throw invalid();
      transparent=true;
    }
    if(kind==='IDAT'){
      if(dataEnded||(type===3&&paletteEntries===undefined))throw invalid();
      dataSeen=true;data.push(bytes.subarray(at+8,end-4));
    }
    if(['IHDR','PLTE','tRNS','IDAT','IEND'].includes(kind))kept.push(bytes.subarray(at,end));
    at=end;
  }
  const passes=(bytes[28]===0?[[0,0,1,1]]:[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]])
    .map(([x,y,dx,dy])=>({rowBytes:Math.max(0,Math.ceil((width-x)/dx))*channels[type],rows:Math.max(0,Math.ceil((height-y)/dy))}))
    .filter(pass=>pass.rowBytes&&pass.rows);
  const expected=passes.reduce((n,p)=>n+(p.rowBytes+1)*p.rows,0);
  const compressed=new Uint8Array(data.reduce((n,d)=>n+d.length,0));let at=0;
  for(const part of data){compressed.set(part,at);at+=part.length;}
  // Streaming preflight allocates at most one 16K output chunk, even for zip bombs.
  // A second bounded decode keeps the existing, tested UPNG unfilter/Adam7 path.
  const inflate=new Pako.Inflate({windowBits:15,chunkSize:16384});let total=0,pass=0,rows=passes[0].rows,rowRemaining=0;
  inflate.onData=chunk=>{
    total+=chunk.length;if(total>expected)throw invalid();
    for(let i=0;i<chunk.length;){
      if(rowRemaining===0){
        if(rows===0){pass++;rows=passes[pass]?.rows??0;}
        if(!rows||chunk[i]>4)throw invalid();
        rowRemaining=passes[pass].rowBytes+1;rows--;
      }
      const take=Math.min(rowRemaining,chunk.length-i);rowRemaining-=take;i+=take;
    }
  };
  if(!inflate.push(compressed,false)||!inflate.ended||inflate.err||inflate.strm.avail_in!==0||total!==expected)throw invalid();
  const clean=new Uint8Array(kept.reduce((n,p)=>n+p.length,0));at=0;
  for(const part of kept){clean.set(part,at);at+=part.length;}
  return {bytes:clean,paletteEntries:type===3?paletteEntries:undefined};
}
