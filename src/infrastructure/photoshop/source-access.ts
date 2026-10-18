import {ColorContractError} from '../../imaging/color';

interface PrivateAccessStorage {readJson<T>(name:string,fallback:T):Promise<T>;json(name:string,value:unknown):Promise<void>}
export interface SourceAccessOptions {storage?:PrivateAccessStorage;onPicker?:()=>void;onStatus?:(message:string)=>void}
const FILE='source-file-access.json',LIMIT=32;
const unavailable='无法保存来源文件授权；本次访问仍可继续，请检查插件存储或重新授权';
const clearFailed='未能清除保存的来源文件授权；本次访问仍可继续，请检查插件存储并重试清除';
const invalid=()=>new ColorContractError('source-profile','请选择当前文档对应的原文件，不能使用另一张图片的颜色信息');

// Native absolute paths only. Never turn a stored string into a file URL/grant.
export function sourcePath(value:unknown):string|undefined {
  if(typeof value!=='string'||!value||value.length>8192||/[\x00-\x1f]/.test(value))return;
  const path=value.replace(/\\/g,'/');
  if(!/^(?:[A-Za-z]:\/|\/)/.test(path)||path.split('/').some(p=>p==='.'||p==='..'))return;
  return /^[A-Za-z]:\//.test(path)||path.startsWith('//')?path.toLowerCase():path;
}
function touch<T>(map:Map<string,T>,key:string,value:T):void {
  map.delete(key);map.set(key,value);while(map.size>LIMIT)map.delete(map.keys().next().value!);
}

/** File grants only; pixels, dimensions and color conclusions are never cached. */
export class SourceFileAccess {
  private session=new Map<string,any>();private tokens=new Map<string,string>();
  private enabled=false;private revision=0;private loaded:Promise<void>;private chain:Promise<void>;
  constructor(private uxp:any,private options:SourceAccessOptions={}){this.loaded=this.load();this.chain=this.loaded;}
  get remember():boolean{return this.enabled;}
  ready():Promise<void>{return this.loaded;}
  private notify(message:string):void {this.options.onStatus?.(message);}
  private queue<T>(operation:()=>Promise<T>):Promise<T>{const next=this.chain.catch(()=>{}).then(operation);this.chain=next.then(()=>{},()=>{});return next;}
  private async load():Promise<void>{
    if(!this.options.storage)return;
    try{
      const saved:any=await this.options.storage.readJson(FILE,null);
      if(saved===null)return;
      if(!saved||saved.schemaVersion!==1||typeof saved.remember!=='boolean'||!Array.isArray(saved.entries)||saved.entries.length>LIMIT||Object.keys(saved).some(k=>!['schemaVersion','remember','entries'].includes(k))||!saved.remember&&saved.entries.length)throw Error();
      const tokens=new Map<string,string>();
      for(const entry of saved.entries){
        if(!entry||Object.keys(entry).some(k=>!['path','token'].includes(k))||!sourcePath(entry.path)||sourcePath(entry.path)!==entry.path||typeof entry.token!=='string'||!entry.token||entry.token.length>8192||tokens.has(entry.path))throw Error();
        tokens.set(entry.path,entry.token);
      }
      if(this.revision===0){this.enabled=saved.remember;this.tokens=tokens;}
    }catch{this.notify('无法读取保存的来源文件授权；请重新选择原图，或检查插件存储后重试');}
  }
  private async save(clearing=false):Promise<void>{
    try{
      if(!this.options.storage)throw Error();
      await this.options.storage.json(FILE,{schemaVersion:1,remember:this.enabled,entries:this.enabled?Array.from(this.tokens,([path,token])=>({path,token})):[]});
    }catch{const message=clearing?clearFailed:unavailable;this.notify(message);throw Error(message);}
  }
  private async persist(path:string,entry:any,revision:number):Promise<void>{
    if(!this.enabled||revision!==this.revision||this.tokens.has(path))return;
    const fs=this.uxp.storage.localFileSystem;
    if(typeof fs.createPersistentToken!=='function'||typeof fs.getEntryForPersistentToken!=='function'){this.notify(unavailable);return;}
    let token:unknown;
    try{token=await fs.createPersistentToken(entry);}catch{this.notify(unavailable);return;}
    if(!this.enabled||revision!==this.revision)return;
    if(typeof token!=='string'||!token||token.length>8192){this.notify(unavailable);return;}
    touch(this.tokens,path,token);
    try{await this.save();}catch{this.tokens.delete(path);}
  }
  setRemember(enabled:boolean):Promise<void>{
    const revision=++this.revision;this.enabled=enabled;
    return this.queue(async()=>{
      // A later preference wins even while token creation or private I/O waits.
      if(revision!==this.revision)return;
      this.tokens.clear();await this.save(!enabled);
      if(enabled)for(const [path,entry] of this.session)await this.persist(path,entry,revision);
    });
  }
  forget():Promise<void>{
    const revision=++this.revision,previous=new Map(this.session);this.session.clear();this.tokens.clear();
    return this.queue(async()=>{
      this.tokens.clear();
      try{await this.save(true);}catch(error){
        if(revision===this.revision){const retained=new Map<string,any>();for(const [path,entry] of [...previous,...this.session])if(this.matches(entry,path))touch(retained,path,entry);this.session=retained;}
        throw error;
      }
    });
  }
  private matches(entry:any,path:string):boolean{return !!entry?.isFile&&sourcePath(entry.nativePath)===path;}
  async read<T>(nativePath:string,file:any,read:(entry:any)=>Promise<T>):Promise<T>{
    const path=sourcePath(nativePath);if(!path)throw invalid();
    await this.loaded;const revision=this.revision;
    const readExact=async(entry:any):Promise<T>=>{const result=await read(entry);if(!this.matches(entry,path))throw invalid();return result;};
    if(file){
      if(!this.matches(file,path))throw invalid();
      const result=await readExact(file);await this.authorize(path,file,revision);return result;
    }
    let entry=this.session.get(path);
    if(!entry&&this.enabled&&this.tokens.has(path)){
      try{entry=await this.uxp.storage.localFileSystem.getEntryForPersistentToken(this.tokens.get(path));}catch{/* Stale access gets one picker fallback. */}
    }
    if(entry&&this.matches(entry,path)){
      try{const result=await readExact(entry);await this.authorize(path,entry,revision);return result;}
      catch(error){if(error instanceof ColorContractError)throw error;}
    }
    this.session.delete(path);
    if(this.tokens.delete(path))await this.queue(()=>this.save().catch(()=>{}));
    this.options.onPicker?.();
    entry=await this.uxp.storage.localFileSystem.getFileForOpening({types:['webp','png','jpg','jpeg','psd','psb','tif','tiff']});
    if(!entry)throw new ColorContractError('source-profile','未选择来源文件；请重试并选择当前文档对应的原图');
    if(!this.matches(entry,path))throw invalid();
    const result=await readExact(entry);await this.authorize(path,entry,revision);return result;
  }
  private async authorize(path:string,entry:any,revision:number):Promise<void>{
    if(revision!==this.revision)return;
    touch(this.session,path,entry);
    await this.queue(()=>this.persist(path,entry,revision));
  }
}
