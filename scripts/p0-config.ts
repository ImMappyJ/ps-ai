import fs from 'node:fs/promises';
import {validateSettings,type BackendSettings} from '../src/infrastructure/config/profile';

export interface P0Options {settingsPath:string;outputDir:string;run:boolean}
export function parseP0Options(args:string[]):P0Options {
  let settingsPath:string|undefined,outputDir:string|undefined,run=false;
  const seen=new Set<string>();
  for(let index=0;index<args.length;index++){
    const option=args[index];
    if(!['--settings','--output-dir','--run'].includes(option)||seen.has(option))throw new Error('P0: unknown or duplicate parameter');
    seen.add(option);
    if(option==='--run'){run=true;continue;}
    const value=args[++index];
    if(!value?.trim()||value.startsWith('--'))throw new Error('P0: parameter requires a value');
    if(option==='--settings')settingsPath=value;else outputDir=value;
  }
  if(!settingsPath||!outputDir)throw new Error('P0 requires --settings <file> and --output-dir <new-directory>; add --run to submit');
  return {settingsPath,outputDir,run};
}
export async function loadP0Settings(settingsPath:string):Promise<BackendSettings> {
  const settings=validateSettings(JSON.parse(await fs.readFile(settingsPath,'utf8')));
  if(settings.backend==='gateway')throw new Error('P0 requires ComfyUI settings');
  return settings;
}
