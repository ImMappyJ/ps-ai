import {encodePng} from '../src/imaging/image';
export const testId='00000000-0000-4000-8000-000000000001';
export function cloudPng(width=512,height=512,transparent=false){const rgba=new Uint8Array(width*height*4).fill(255);if(transparent)rgba[3]=0;return encodePng({width,height,rgba});}
export function untagPng(bytes:Uint8Array){const b=Buffer.from(bytes),parts=[b.subarray(0,8)];for(let at=8;at<b.length;){const end=at+b.readUInt32BE(at)+12;if(b.toString('ascii',at+4,at+8)!=='sRGB')parts.push(b.subarray(at,end));at=end;}return new Uint8Array(Buffer.concat(parts));}
export const cloudRequest={model:'qwen-image-2.1-pro',kind:'t2i' as const,mode:'generate',prompt:'white over-knee stockings',seed:42,width:512,height:512,outputDepth:8 as const};
