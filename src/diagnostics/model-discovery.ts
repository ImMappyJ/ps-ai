import {DEFAULT_MODELS,validateModels} from '../infrastructure/config/profile';import type {ModelFiles} from '../infrastructure/config/profile';
export interface ModelSuggestions {models:ModelFiles;changed:(keyof ModelFiles)[];unresolved:(keyof ModelFiles)[]}
export function suggestModelMappings(inventory:Record<keyof ModelFiles,string[]>,current:ModelFiles):ModelSuggestions {
  const models={...validateModels(current)},changed:(keyof ModelFiles)[]=[],unresolved:(keyof ModelFiles)[]=[];
  for(const key of ['unet','clip','vae'] as const){
    const files=[...new Set(inventory[key])].filter(filename=>{try{validateModels({...models,[key]:filename});return true;}catch{return false;}});
    if(files.includes(models[key]))continue;
    const preset=DEFAULT_MODELS[key],nested=files.filter(filename=>filename.split(/[\\/]/).pop()===preset);
    const match=files.includes(preset)?preset:nested.length===1?nested[0]:undefined;
    if(match){models[key]=match;changed.push(key);}else unresolved.push(key);
  }
  return {models,changed,unresolved};
}
