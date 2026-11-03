import {sha256} from '@noble/hashes/sha2.js';
import {validateRgbProfile} from './icc-profile';
import {IMAGE_BUDGETS} from './budget';
import type {Raster} from './image';
export interface NativeLightingIdentity {version:'native-rgb-v1';width:number;height:number;depth:8|16;profileName:string;profileHash:string;pixelsHash:string;calibration:string}
/** Deliberately NOT a Raster: native encoded samples must never enter sRGB paths. */
export interface NativeLightingSource {width:number;height:number;depth:8|16;profileName:string;profileBytes:Uint8Array;nativePixels:Uint8Array|Uint16Array;calibration:string}
export interface LightingColorService {
  toLinear(source:NativeLightingSource,srgb?:Raster,signal?:AbortSignal):Promise<Float32Array>;
  fromLinear(source:NativeLightingSource,linear:Float32Array,signal?:AbortSignal):Promise<Uint8Array|Uint16Array>;
  toSrgb(source:NativeLightingSource,signal?:AbortSignal):Promise<Raster>;
  calibrate(profileBytes:Uint8Array,profileName:string,depth:8|16,signal?:AbortSignal):Promise<string>;
}
export const colorHash=(b:Uint8Array):string=>Array.from(sha256(b),v=>v.toString(16).padStart(2,'0')).join('');
function dimensions(w:number,h:number,depth:8|16){if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>IMAGE_BUDGETS.analysisPixels||Math.max(w,h)>IMAGE_BUDGETS.analysisSide||![8,16].includes(depth))throw new Error('原 ICC 光影尺寸或位深无效');}
export function encodeNativePixels(s:NativeLightingSource):Uint8Array {
  dimensions(s.width,s.height,s.depth);if(s.nativePixels.length!==s.width*s.height*4||!(s.depth===16?s.nativePixels instanceof Uint16Array:s.nativePixels instanceof Uint8Array))throw new Error('原 ICC 像素长度或位深无效');
  if(s.depth===8)return new Uint8Array(s.nativePixels);const bytes=new Uint8Array(s.nativePixels.length*2),v=new DataView(bytes.buffer);s.nativePixels.forEach((n,i)=>v.setUint16(i*2,n,true));return bytes;
}
export function decodeNativePixels(bytes:Uint8Array,w:number,h:number,depth:8|16):Uint8Array|Uint16Array {
  dimensions(w,h,depth);if(!(bytes instanceof Uint8Array)||bytes.length!==w*h*4*(depth/8))throw new Error('原 ICC 像素文件长度无效');if(depth===8)return bytes.slice();
  const out=new Uint16Array(w*h*4),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let i=0;i<out.length;i++)out[i]=v.getUint16(i*2,true);return out;
}
export function nativeLightingIdentity(s:NativeLightingSource):NativeLightingIdentity {
  validateRgbProfile(s.profileBytes);if(typeof s.profileName!=='string'||!s.profileName.trim()||s.profileName.length>256||!/^[a-f0-9]{64}$/.test(s.calibration))throw new Error('原 ICC 身份无效');
  return {version:'native-rgb-v1',width:s.width,height:s.height,depth:s.depth,profileName:s.profileName,profileHash:colorHash(s.profileBytes),pixelsHash:colorHash(encodeNativePixels(s)),calibration:s.calibration};
}
export function validateNativeLightingSource(s:NativeLightingSource,identity:NativeLightingIdentity):void {
  const actual=nativeLightingIdentity(s);if(!identity||Object.keys(identity).length!==Object.keys(actual).length||Object.entries(actual).some(([k,v])=>identity[k as keyof NativeLightingIdentity]!==v))throw new Error('原 ICC 光影缓存身份不一致；请重新读取来源');
}
