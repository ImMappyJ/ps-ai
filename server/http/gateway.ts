import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {UUID,UPLOAD} from '../../src/gateway-protocol';
import {createJobService} from '../application/jobs';
import type {JobServiceOptions} from '../application/jobs';
import {ServiceError} from '../shared/errors';
import {MAX_INPUT_BYTES} from '../shared/images';
import {readBody,writeJson} from './messages';

export type GatewayOptions=JobServiceOptions & {token?:string;configure?:(apiKey:string)=>Promise<void>;shutdown?:()=>void};
export async function createGateway(options:GatewayOptions){
  const jobs=await createJobService(options),store=jobs.store;
  const handlers=new Set<Promise<void>>();let closing=false;
  const server=createServer((req,res)=>{const handler=(async()=>{
    if(closing)throw new ServiceError(503,'connection','Gateway is shutting down; recover the original task ID');
    const port=(server.address() as any)?.port;
    if(![`localhost:${port}`,`127.0.0.1:${port}`].includes(req.headers.host??'')||(req.headers.origin&&req.headers.origin!=='null'))throw new ServiceError(403,'forbidden','This gateway accepts local plugin requests only');
    if(options.token){const received=Buffer.from(req.headers.authorization??''),expected=Buffer.from(`Bearer ${options.token}`);if(received.length!==expected.length||!timingSafeEqual(received,expected))throw new ServiceError(401,'authentication','Local relay authentication required');}
    const route=req.url??'';
    if(req.method==='POST'&&route==='/psai/v1/configure'&&options.token&&options.configure){
      if(!/^application\/json(?:;|$)/.test(req.headers['content-type']??''))throw new ServiceError(415,'invalid-input','Expected application/json');
      let value:any;try{value=JSON.parse(new TextDecoder().decode(await readBody(req,2048)));}catch{throw new ServiceError(400,'invalid-input','Invalid configuration');}
      if(!value||Object.keys(value).length!==1||typeof value.apiKey!=='string'||value.apiKey.length>512||/[^\x21-\x7e]/.test(value.apiKey))throw new ServiceError(400,'invalid-input','Expected only a printable API key, or an empty key to clear');
      await options.configure(value.apiKey);writeJson(res,200,{configured:jobs.capabilities().configured});return;
    }
    if(req.method==='POST'&&route==='/psai/v1/shutdown'&&options.token&&options.shutdown){await readBody(req,1024);writeJson(res,200,{stopping:true});setTimeout(options.shutdown,0);return;}
    if(req.method==='GET'&&route==='/psai/v1/capabilities'){writeJson(res,200,jobs.capabilities());return;}
    const input=route.match(/^\/psai\/v1\/uploads\/([^/]+)$/);
    if(req.method==='PUT'&&input){
      if(!UPLOAD.test(input[1])||req.headers['content-type']!=='image/png')throw new ServiceError(400,'invalid-input','Expected task PNG upload');
      const bytes=await readBody(req,MAX_INPUT_BYTES);
      await jobs.upload(input[1],bytes);writeJson(res,200,{name:input[1]});return;
    }
    if(req.method==='POST'&&route==='/psai/v1/jobs'){
      if(!/^application\/json(?:;|$)/.test(req.headers['content-type']??''))throw new ServiceError(415,'invalid-input','Expected application/json');
      const bytes=await readBody(req,64*1024);let value:any;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ServiceError(400,'invalid-input','Invalid request JSON');}
      const job=await jobs.submit(value);writeJson(res,202,{id:job.id,state:job.state});return;
    }
    const task=route.match(/^\/psai\/v1\/jobs\/([0-9a-f-]{36})(\/cancel)?$/);
    if(task&&UUID.test(task[1])){
      if(req.method==='GET'&&!task[2]){writeJson(res,200,await jobs.status(task[1]));return;}
      if(req.method==='POST'&&task[2]){await readBody(req,1024);writeJson(res,200,{cancelled:false,detail:'Stop future candidates; the current platform request continues'});return;}
    }
    const output=route.match(/^\/psai\/v1\/outputs\/([0-9a-f-]{36})\.png$/);
    if(req.method==='GET'&&output&&UUID.test(output[1])){
      const bytes=await jobs.output(output[1]);res.writeHead(200,{'Content-Type':'image/png','Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);return;
    }
    throw new ServiceError(404,'not-found','Unknown PS-AI gateway route');
  })().catch(error=>{if(!res.headersSent)writeJson(res,error instanceof ServiceError?error.status:500,{code:error instanceof ServiceError?error.code:'internal',message:error instanceof ServiceError?error.message:'Internal gateway error; private details were not returned'});else res.destroy();});handlers.add(handler);void handler.finally(()=>handlers.delete(handler)).catch(()=>{});});
  server.requestTimeout=15000;server.headersTimeout=10000;
  let closePromise:Promise<void>|undefined;
  return {server,store,close(){return closePromise??=(async()=>{
    closing=true;
    if(server.listening)await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
    // Disconnected handlers can still persist a submission and create workers.
    // Drain them first, then workers and their final serialized writes.
    while(handlers.size)await Promise.allSettled([...handlers]);
    await jobs.drain();
    await store.close();
  })();}};
}
