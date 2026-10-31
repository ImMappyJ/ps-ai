export interface AssetPlacement {version:'subject-v1';scope:'context'|'document';occlusion:'front'|'behind'}

export function validateAssetPlacement(value:unknown):AssetPlacement {
  const placement=value as AssetPlacement;
  if(!placement||typeof placement!=='object'||Array.isArray(placement)||Object.keys(placement).some(key=>!['version','scope','occlusion'].includes(key))||placement.version!=='subject-v1'||!['context','document'].includes(placement.scope)||!['front','behind'].includes(placement.occlusion))throw new Error('素材主体与活动范围配置无效');
  return {version:'subject-v1',scope:placement.scope,occlusion:placement.occlusion};
}

export function assetPlacementValue(subject:number,protection:number,occlusion:'front'|'behind'):number {
  return Math.round((occlusion==='behind'?255-subject:255)*(255-protection)/255);
}

export function assetPlacementMask(subject:Uint8Array,protection:Uint8Array,occlusion:'front'|'behind'):Uint8Array {
  if(!(subject instanceof Uint8Array)||!(protection instanceof Uint8Array)||subject.length!==protection.length||!subject.some(value=>value>0)||!['front','behind'].includes(occlusion))throw new Error('素材主体或活动范围蒙版无效');
  return Uint8Array.from(subject,(value,index)=>assetPlacementValue(value,protection[index],occlusion));
}
