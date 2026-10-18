import fs from 'node:fs/promises';import path from 'node:path';import {randomBytes,createHmac} from 'node:crypto';
import {createGateway} from '../http/gateway';import {BailianProvider} from '../providers/bailian';import {GeminiProvider} from '../providers/gemini';import {OpenAIImagesProvider} from '../providers/openai';
import type {ImageProvider} from '../providers/contract';import {ServiceError} from '../shared/errors';
import {PLATFORM_IDS,PLATFORMS} from '../../src/infrastructure/backends/platforms';import type {PlatformId} from '../../src/infrastructure/backends/platforms';

export async function startManagedRelay(options:{dataDir:string;ports?:Record<PlatformId,number>}){
  if(Number(process.versions.node.split('.')[0])<24)throw new Error('PS-AI relay requires Node.js 24 or later');
  await fs.mkdir(options.dataDir,{recursive:true,mode:0o700});
  const sessionPath=path.join(options.dataDir,'relay-session.json');
  let token=randomBytes(32).toString('hex');
  try{const old=JSON.parse(await fs.readFile(sessionPath,'utf8'));if(/^[a-f0-9]{64}$/.test(old.token))token=old.token;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('Invalid relay session file');}
  const gateways:Awaited<ReturnType<typeof createGateway>>[]=[];let closing:Promise<void>|undefined;
  const close=()=>closing??=(async()=>{await Promise.all(gateways.map(g=>g.close()));})();
  const session={protocol:'ps-ai-relay/1',token,ports:{} as Record<PlatformId,number>};
  try{
    for(const id of PLATFORM_IDS){
      const dataDir=path.join(options.dataDir,id);let key='',activeCalls=0;
      const credentialFile=path.join(dataDir,'credential-id.json');
      let credentialId='';try{credentialId=JSON.parse(await fs.readFile(credentialFile,'utf8')).id;if(!/^[a-f0-9]{64}$/.test(credentialId))throw new Error('Invalid credential identity');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      const factory=(apiKey:string):ImageProvider=>id==='bailian'?new BailianProvider({apiKey}):id==='gemini'?new GeminiProvider({apiKey}):new OpenAIImagesProvider({apiKey});
      let delegate=factory('');
      // Stable provider identity and endpoint; key replacement does not reroute jobs.
      const provider:ImageProvider={id,execution:delegate.execution,get baseUrl(){return delegate.baseUrl;},get configured(){return delegate.configured;},capabilities:()=>delegate.capabilities(),
        async submit(request,images){const current=delegate;activeCalls++;try{return await current.submit(request,images);}finally{activeCalls--; }},
        ...(delegate.poll?{async poll(taskId:string){activeCalls++;try{return await delegate.poll!(taskId);}finally{activeCalls--;}}}:{}),
        ...(delegate.download?{download:(...args:Parameters<NonNullable<ImageProvider['download']>>)=>delegate.download!(...args)}:{}),
        ...(delegate.normalizeOutput?{normalizeOutput:(...args:Parameters<NonNullable<ImageProvider['normalizeOutput']>>)=>delegate.normalizeOutput!(...args)}:{})};
      let configureChain=Promise.resolve();
      const gateway=await createGateway({dataDir,provider,token,shutdown:()=>{void close().catch(()=>{});},configure(apiKey){
        const change=configureChain.catch(()=>{}).then(async()=>{
          if(apiKey===key&&(key!==''||credentialId===''))return;
          const nextId=apiKey?createHmac('sha256',token).update(apiKey).digest('hex'):'';
          if(nextId!==credentialId||activeCalls){
            const files=await fs.readdir(path.join(dataDir,'jobs'));
            const pending=(await Promise.all(files.filter(f=>/^[a-f0-9-]{36}\.json$/.test(f)).map(f=>gateway.store.job(f.slice(0,-5))))).some(j=>j&&!['ready','failed','cancelled'].includes(j.state));
            if(activeCalls||pending)throw new ServiceError(409,'conflict','Resolve unfinished jobs before replacing or clearing this provider key');
          }
          const next=factory(apiKey);const temp=credentialFile+'.tmp';if(nextId){await fs.writeFile(temp,JSON.stringify({id:nextId}),{mode:0o600});await fs.rename(temp,credentialFile);}else{await fs.rm(credentialFile,{force:true});}credentialId=nextId;delegate=next;key=apiKey;
        });configureChain=change;return change;
      }});
      gateways.push(gateway);
      await new Promise<void>((resolve,reject)=>{gateway.server.once('error',reject);gateway.server.listen(options.ports?.[id]??PLATFORMS[id].port,'127.0.0.1',()=>{gateway.server.off('error',reject);resolve();});});
      session.ports[id]=(gateway.server.address() as {port:number}).port;
    }
    const temp=sessionPath+'.tmp';await fs.writeFile(temp,JSON.stringify(session),{mode:0o600});await fs.rename(temp,sessionPath);
    return {session,close};
  }catch(error){await close();throw error;}
}
