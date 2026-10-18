import type {JobRecord} from '../../generation/jobs';
export interface HistoryCleanupStatus {
  removedIds:string[];
  pendingFiles:number;
  retainedSharedFiles:number;
  skippedUnsafeFiles:number;
  metadataPending:boolean;
}
interface CleanupJournal {
  schemaVersion:1;
  removedIds:string[];
  files:string[];
  skippedUnsafeFiles:number;
  metadataPending:boolean;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_FILE=/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(source\.png|mask\.bin|output\.png|subject-mask\.bin|protection-mask\.bin)$/i;
const SUFFIXES=['source.png','mask.bin','output.png','subject-mask.bin','protection-mask.bin'];
const CLEANUP='history-cleanup.json';
const emptyCleanup=():CleanupJournal=>({schemaVersion:1,removedIds:[],files:[],skippedUnsafeFiles:0,metadataPending:false});
const taskFiles=(id:string)=>UUID.test(id)?SUFFIXES.map(suffix=>`${id.toLowerCase()}-${suffix}`):[];
const identity=(id:string)=>UUID.test(id)?id.toLowerCase():id;
const pointers=(record:JobRecord):unknown[]=>[record.outputFile,(record.relight as any)?.result?.outputFile];
const cleared=(journal:CleanupJournal,record:JobRecord)=>journal.removedIds.some(id=>identity(id)===identity(record.id));
// UXP entry-based IO only. No Node filesystem at runtime.
export class Storage {
  private chain:Promise<void>=Promise.resolve();
  private traceChain:Promise<void>=Promise.resolve();
  constructor(private uxp:any){}
  async root():Promise<any>{return this.uxp.storage.localFileSystem.getDataFolder();}
  async binary(name:string,bytes:Uint8Array):Promise<void> {
    const write=async()=>{const root=await this.root(),file=await root.createFile(name,{overwrite:true});await file.write(new Uint8Array(bytes).buffer,{format:this.uxp.storage.formats.binary});};
    const task=TASK_FILE.exec(name);
    if(!task)return write();
    return this.queued(async()=>{this.assertWritable(await this.readCleanup(),task[1]);await write();});
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
    return this.queued(async()=>{
      const journal=await this.readCleanup();this.assertWritable(journal,record.id);
      const records=(await this.readHistory()).filter(record=>!cleared(journal,record)),index=records.findIndex(r=>r.id===record.id),clean=JSON.parse(JSON.stringify(record));
      if(index<0)records.unshift(clean);else records[index]=clean;await this.json('history.json',records);
    });
  }
  history():Promise<JobRecord[]>{return this.queued(async()=>{const journal=await this.readCleanup();return(await this.readHistory()).filter(record=>!cleared(journal,record));});}
  clearHistory(ids:readonly string[]):Promise<HistoryCleanupStatus> {
    return this.queued(async()=>{
      const records=await this.readHistory(),journal=await this.readCleanup(),existing=new Set(records.map(record=>record.id));
      const removedIds=[...new Set(ids)].filter(id=>existing.has(id)&&!journal.removedIds.some(removed=>identity(removed)===identity(id)));
      if(!removedIds.length)return {...await this.cleanupStatus(journal,records),removedIds:[]};
      const selected=new Set(removedIds),authorized=new Set([...journal.removedIds,...removedIds].map(identity)),files=new Set(journal.files),unsafe=new Set<unknown>();
      for(const record of records.filter(record=>selected.has(record.id))){
        const owned=taskFiles(record.id);
        if(owned.length)owned.forEach(name=>files.add(name));else SUFFIXES.forEach(suffix=>unsafe.add(`${record.id}-${suffix}`));
        for(const pointer of pointers(record))if(pointer!==undefined){
          const task=typeof pointer==='string'?TASK_FILE.exec(pointer):null;
          if(!task||!authorized.has(identity(task[1])))unsafe.add(task?String(pointer).toLowerCase():pointer);
        }
      }
      const intent:CleanupJournal={schemaVersion:1,removedIds:[...journal.removedIds,...removedIds],files:[...files],skippedUnsafeFiles:journal.skippedUnsafeFiles+unsafe.size,metadataPending:true};
      // The atomic journal move is the authorization boundary. No deletion precedes it.
      await this.json(CLEANUP,intent);
      return {...await this.cleanup(intent,records),removedIds};
    });
  }
  retryHistoryCleanup():Promise<HistoryCleanupStatus>{return this.queued(async()=>{const records=await this.readHistory(),journal=await this.readCleanup();return this.cleanup(journal,records);});}
  historyCleanupStatus():Promise<HistoryCleanupStatus>{return this.queued(async()=>{const records=await this.readHistory(),journal=await this.readCleanup();return this.cleanupStatus(journal,records);});}
  private queued<T>(action:()=>Promise<T>):Promise<T> {
    const operation=this.chain.then(action);this.chain=operation.then(()=>{},()=>{});return operation;
  }
  private assertWritable(journal:CleanupJournal,id:string):void {
    if(typeof id!=='string')throw new Error('Invalid local history ID');
    if(journal.removedIds.some(removed=>identity(removed)===identity(id)))throw new Error('This local history ID was cleared');
  }
  private async readHistory():Promise<JobRecord[]> {
    const records=await this.readJson<unknown>('history.json',[]);
    if(!Array.isArray(records)||records.some(record=>!record||typeof record!=='object'||typeof record.id!=='string'))throw new Error('Corrupt local history');
    return records;
  }
  private async readCleanup():Promise<CleanupJournal> {
    const journal=await this.readJson<any>(CLEANUP,undefined);
    if(journal===undefined)return emptyCleanup();
    if(!journal||journal.schemaVersion!==1||!Array.isArray(journal.removedIds)||journal.removedIds.some((id:unknown)=>typeof id!=='string')||!Array.isArray(journal.files)||!Number.isSafeInteger(journal.skippedUnsafeFiles)||journal.skippedUnsafeFiles<0||typeof journal.metadataPending!=='boolean'||Object.keys(journal).some(key=>!['schemaVersion','removedIds','files','skippedUnsafeFiles','metadataPending'].includes(key)))throw new Error('Corrupt local history cleanup journal');
    const authorized=new Set<string>(journal.removedIds.map(identity));
    if(journal.files.some((name:unknown)=>{const task=typeof name==='string'?TASK_FILE.exec(name):null;return !task||!authorized.has(identity(task[1]));}))throw new Error('Unsafe local history cleanup journal');
    if(new Set(journal.removedIds).size!==journal.removedIds.length||new Set(journal.files.map((name:string)=>name.toLowerCase())).size!==journal.files.length)throw new Error('Duplicate local history cleanup entries');
    return journal;
  }
  private sharedFiles(records:JobRecord[]):Set<string> {
    const files=new Set<string>();
    for(const record of records){for(const name of taskFiles(record.id))files.add(name);for(const pointer of pointers(record))if(typeof pointer==='string'&&TASK_FILE.test(pointer))files.add(pointer.toLowerCase());}
    return files;
  }
  private async taskEntries():Promise<Map<string,any[]>> {
    const entries=await(await this.root()).getEntries(),files=new Map<string,any[]>();
    for(const entry of entries)if(typeof entry.name==='string'&&TASK_FILE.test(entry.name)){const key=entry.name.toLowerCase();files.set(key,[...(files.get(key)??[]),entry]);}
    return files;
  }
  private async cleanupStatus(journal:CleanupJournal,records:JobRecord[]):Promise<HistoryCleanupStatus> {
    const live=records.filter(record=>!cleared(journal,record)),shared=this.sharedFiles(live),entries=journal.files.length?await this.taskEntries():new Map<string,any[]>();
    let pendingFiles=0,retainedSharedFiles=0,metadataPending=journal.metadataPending||live.length!==records.length;
    for(const name of journal.files){const count=entries.get(name.toLowerCase())?.length??0;if(!count)metadataPending=true;if(shared.has(name.toLowerCase()))retainedSharedFiles+=count;else pendingFiles+=count;}
    return {removedIds:[...journal.removedIds],pendingFiles,retainedSharedFiles,skippedUnsafeFiles:journal.skippedUnsafeFiles,metadataPending};
  }
  private async cleanup(journal:CleanupJournal,records:JobRecord[]):Promise<HistoryCleanupStatus> {
    const live=records.filter(record=>!cleared(journal,record));
    if(!journal.metadataPending&&live.length===records.length&&!journal.files.length)return this.cleanupStatus(journal,records);
    let metadataPending=journal.metadataPending||live.length!==records.length;
    if(metadataPending)try{await this.json('history.json',live);metadataPending=false;}catch{/* Durable tombstones still hide every cleared record. */}
    const shared=this.sharedFiles(live),files:string[]=[];let pendingFiles=0,retainedSharedFiles=0;
    // A failed listing leaves authorized filenames pending, without treating it as absence.
    const entries=await this.taskEntries().catch(()=>undefined);
    for(const name of journal.files){
      const key=name.toLowerCase(),actual=entries?.get(key)??[];
      if(!entries){files.push(name);if(shared.has(key))retainedSharedFiles++;else pendingFiles++;continue;}
      if(shared.has(key)){if(actual.length)files.push(name);retainedSharedFiles+=actual.length;continue;}
      let pending=false;
      for(const entry of actual){
        if(entry.isFile!==true){pending=true;pendingFiles++;continue;}
        try{await entry.delete();}catch{pending=true;pendingFiles++;}
      }
      if(pending)files.push(name);
    }
    // Keep tombstones even after all files are gone, so late saves/writes stay rejected.
    const completed:CleanupJournal={...journal,files,metadataPending};
    try{await this.json(CLEANUP,completed);}catch{metadataPending=true;}
    return {removedIds:[...journal.removedIds],pendingFiles,retainedSharedFiles,skippedUnsafeFiles:journal.skippedUnsafeFiles,metadataPending};
  }
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
