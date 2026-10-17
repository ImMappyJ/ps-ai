import {ServiceError} from './errors';
export async function readBounded(response:Response,limit:number,submission=false):Promise<Uint8Array>{
  // Losing a 2xx creation response must not release duplicate-submission guards.
  const exceeded=()=>new ServiceError(502,submission?'incompatible-api':'invalid-output','Provider response exceeds byte limit',submission);
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw exceeded();}
  if(!response.body)return new Uint8Array();
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let length=0;
  try{while(true){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>limit){await reader.cancel();throw exceeded();}parts.push(next.value);}}
  finally{reader.releaseLock();}
  const result=new Uint8Array(length);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
}
