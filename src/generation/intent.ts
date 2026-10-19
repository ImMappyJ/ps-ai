import type {AssetContext} from '../infrastructure/backends/gateway-protocol';
export type Workspace='local'|'cosplay'|'t2i';
export type OutputKind='edit'|'asset'|'t2i';
export interface Intent {kind:OutputKind;prompt:string;referenceSlot?:number;assetContext?:AssetContext}
export function isBackgroundMode(mode:string):boolean {return mode==='background'||mode==='scene';}
export function intent(workspace:Workspace,mode:string,prompt:string,hasReference:boolean,guide:boolean,usage:string,bindings:'images'|'semantic'='images',structuredRelight=false,assetContext?:AssetContext):Intent {
  const modes={local:['edit','remove','background'],cosplay:['blend','relight','effect','costume','reference','scene','atmosphere'],t2i:['generate']};
  if(!modes[workspace]?.includes(mode))throw new Error('不支持的工作区或模式');
  if(mode!=='remove'&&mode!=='blend'&&!prompt.trim())throw new Error('请描述希望生成或修改的内容');
  if(mode==='reference'&&!hasReference)throw new Error('角色参考辅助需要选择一张参考图');
  const kind:OutputKind=workspace==='t2i'?'t2i':mode==='effect'||mode==='atmosphere'?'asset':'edit';
  if(assetContext!==undefined&&(assetContext!=='selection-v1'||kind!=='asset'))throw new Error('不支持的素材上下文');
  if(assetContext==='selection-v1'&&!guide)throw new Error('参考当前图片生成素材需要范围辅助图');
  if(hasReference&&kind!=='edit')throw new Error('参考图用于编辑路径；生成独立素材或文字生图前请清除参考图');
  let text=mode==='remove'?'':structuredRelight&&mode==='relight'?prompt:prompt.trim();
  if(kind==='edit') {
    const source=bindings==='semantic'?'来源图':'<image1>';
    text=isBackgroundMode(mode)?`把 ${source} 的背景替换为新场景：${text}。背景清晰呈现相应的环境、布景、光线和地面，形成完整、不透明的场景。保持原主体人物的外观、姿态、位置和原画布构图。`:mode==='blend'?`以 ${source} 整张画布中主体之外的可见环境为参考，只修改选中的主体并保留保护区域。统一主体与环境的光线方向、色温、对比度、边缘、纹理、颗粒、锐度和景深，使主体自然融入画面。保留人物身份、姿态、位置、比例和结构，保持原画布构图及主体以外的内容。`+(text?` 补充要求：${text}`:''):`编辑 ${source} 中指定的局部内容，保持原画布、主体大小、位置、姿态、场景透视和未指定内容。不要缩小主体、重新构图或添加留白。`+text;
    if(mode==='relight'&&!structuredRelight)text+=' 按描述重塑选区内的光线方向、软硬、明暗与色温；保持五官、人物身份、姿态和材质结构，未指定区域的光影不变。';
    if(mode==='remove')text+=' 移除选中对象，根据周边补齐背景材质、结构、光线和透视。';
    if(guide)text+=bindings==='semantic'?' 根据提供的编辑范围修改，不要在结果中画出辅助图或蒙版。':' <image2> 是与原图对齐的范围蒙版，白色允许修改，黑色保留。不要在结果中画出蒙版。';
    if(hasReference){
      if(bindings==='semantic')text+=` 另附${usage}参考图，仅参考指定内容，保留原人物面部、姿态与未选区域。`;
      else {const slot=guide?3:2;text+=` <image${slot}> 是${usage}参考图，仅参考指定内容，保留原人物面部、姿态与未选区域。`;return {kind,prompt:text,referenceSlot:slot};}
    }
  }else if(kind==='asset'){
    if(assetContext==='selection-v1'){
      const source=bindings==='semantic'?'来源图':'<image1>',scope=bindings==='semantic'?'范围图':'<image2>';
      text=`以 ${source} 作为当前图片参考，匹配指定位置、尺度、透视、色调和光线，生成独立可合成的透明特效/氛围素材：${text}。只输出素材，参考图片中的人物和背景不进入结果。 ${scope} 是与来源图对齐的范围图，用于指定素材放置的位置和范围，白色允许放置，黑色不放置，灰色表示羽化；不要在结果中画出辅助图或蒙版。`;
    }
    text+=' 独立可合成的特效/氛围素材，transparent background, RGBA image，保留自然半透明边缘，不要实心黑底、白底、文字或场景。';
  }
  return {kind,prompt:text,...(assetContext?{assetContext}:{})};
}
