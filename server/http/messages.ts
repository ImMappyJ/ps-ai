import type {IncomingMessage,ServerResponse} from 'node:http';
import {ServiceError} from '../shared/errors';

export function readBody(req:IncomingMessage,limit:number):Promise<Uint8Array>{
  if(Number(req.headers['content-length'])>limit){req.resume();return Promise.reject(new ServiceError(413,'invalid-input','Request exceeds byte limit'));}
  return new Promise((resolve,reject)=>{let length=0;const parts:Buffer[]=[];
    const clean=()=>{req.off('data',data);req.off('end',end);req.off('error',error);};
    const data=(part:Buffer)=>{length+=part.length;if(length>limit){clean();req.resume();reject(new ServiceError(413,'invalid-input','Request exceeds byte limit'));}else parts.push(part);};
    const end=()=>{clean();resolve(new Uint8Array(Buffer.concat(parts)));};const error=()=>{clean();reject(new ServiceError(400,'invalid-input','Request body interrupted'));};
    req.on('data',data);req.on('end',end);req.on('error',error);
  });
}
export function writeJson(res:ServerResponse,status:number,data:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
