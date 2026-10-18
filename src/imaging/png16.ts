import Pako from 'pako';

function chunk(kind:string,data:Uint8Array):Uint8Array {
  const out=new Uint8Array(data.length+12),view=new DataView(out.buffer);view.setUint32(0,data.length);
  out.set(Array.from(kind,c=>c.charCodeAt(0)),4);out.set(data,8);
  let crc=0xffffffff;for(let i=4;i<out.length-4;i++){crc^=out[i];for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  view.setUint32(out.length-4,(crc^0xffffffff)>>>0);return out;
}
// PNG samples are big-endian, unlike native Uint16Array buffers on Windows.
export function encodeRgba16(width:number,height:number,rgba:Uint16Array):Uint8Array {
  const head=new Uint8Array(13),hv=new DataView(head.buffer);hv.setUint32(0,width);hv.setUint32(4,height);head[8]=16;head[9]=6;
  const scan=new Uint8Array(height*(width*8+1)),view=new DataView(scan.buffer);
  for(let y=0;y<height;y++)for(let x=0;x<width*4;x++)view.setUint16(y*(width*8+1)+1+x*2,rgba[y*width*4+x]);
  const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('sRGB',new Uint8Array([1])),chunk('IDAT',Pako.deflate(scan)),chunk('IEND',new Uint8Array())];
  const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;
}
