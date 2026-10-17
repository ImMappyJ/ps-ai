import {decodePng,encodePng,rasterDepth} from '../../src/image';
import type {GenerationRequest} from '../../src/gateway-protocol';
import {ServiceError} from './errors';
export const MAX_INPUT_BYTES=10*1024*1024;
export function validateInput(bytes:Uint8Array){
  if(bytes.length>MAX_INPUT_BYTES)throw new ServiceError(413,'invalid-input','Input PNG exceeds 10 MB');
  // These are plugin-generated sRGB8 inputs, not untagged provider outputs.
  const image=decodePng(bytes);
  if(rasterDepth(image)!==8||Math.max(image.width,image.height)>8000||Math.max(image.width/image.height,image.height/image.width)>10)throw new ServiceError(400,'invalid-input','Input dimensions or depth exceed gateway limits');
  return image;
}
export function normalizeOutput(bytes:Uint8Array,request:GenerationRequest,assumeSrgb=false):Uint8Array {
  const image=decodePng(bytes,{allowUntagged:assumeSrgb});
  if(rasterDepth(image)!==8)throw new ServiceError(502,'invalid-output','Bailian output must be genuine 8-bit PNG');
  if(image.width!==request.width||image.height!==request.height)throw new ServiceError(502,'invalid-output','Provider output dimensions differ from the requested canvas');
  if(request.kind==='asset'&&!image.rgba.some((v,i)=>i%4===3&&v<255))throw new ServiceError(502,'invalid-output','Provider did not return a transparent asset');
  // Re-encode checked, straight RGBA pixels; UPNG writes the sRGB chunk.
  return encodePng(image);
}
