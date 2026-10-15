import type {JobRecord} from './jobs';
// UXP entry-based IO only. No Node filesystem at runtime.
export class Storage {
  private chain:Promise<void>=Promise.resolve();
  private traceChain:Promise<void>=Promise.resolve();
  constructor(private uxp:any){}
  async root():Promise<any>{return this.uxp.storage.localFileSystem.getDataFolder();}
  async binary(name:string,bytes:Uint8Array):Promise<void> {
    const root=await this.root(),file=await root.createFile(name,{overwrite:true});
    await file.write(new Uint8Array(bytes).buffer,{format:this.uxp.storage.formats.binary});
  }
  async readBinary(name:string):Promise<Uint8Array>{const root=await this.root();return new Uint8Array(await(await root.getEntry(name)).read({format:this.uxp.storage.formats.binary}));}
  async json(name:string,data:unknown):Promise<void> {
    const root=await this.root();const temp=await root.createFile(name+'.tmp',{overwrite:true});
    await temp.write(JSON.stringify(data,null,2));await temp.moveTo(root,{newName:name,overwrite:true});
  }
  async readJson<T>(name:string,fallback:T):Promise<T> {
    const root=await this.root();const entries=await root.getEntries();
    if(!entries.some((entry:any)=>entry.name===name))return fallback;
    // Corrupt existing metadata must not silently become an empty history.
    return JSON.parse(await(await root.getEntry(name)).read()) as T;
  }
  save(record:JobRecord):Promise<void> {
    const operation=this.chain.catch(()=>{}).then(async()=>{const records=await this.readJson<JobRecord[]>('history.json',[]);const index=records.findIndex(r=>r.id===record.id);const clean=JSON.parse(JSON.stringify(record));if(index<0)records.unshift(clean);else records[index]=clean;await this.json('history.json',records);});
    this.chain=operation;return operation;
  }
  async history():Promise<JobRecord[]>{await this.chain;return this.readJson<JobRecord[]>('history.json',[]);}
  trace(stage:string,taskId?:string):Promise<void> {
    const event={at:new Date().toISOString(),stage,taskId};
    const operation=this.traceChain.catch(()=>{}).then(async()=>{
      const log=await this.readJson<{events:unknown[]}|null>('runtime-trace.json',{events:[]}).catch(()=>null);
      await this.json('runtime-trace.json',{schemaVersion:1,events:[...(Array.isArray(log?.events)?log.events:[]),event].slice(-80)});
    });
    this.traceChain=operation;
    // Diagnostics must not block editing when their own storage is unavailable.
    return operation.catch(error=>console.warn('ps-ai diagnostic write failed',error));
  }
}
