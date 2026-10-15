export type Workspace='local'|'cosplay'|'t2i';
export type OutputKind='edit'|'asset'|'t2i';
export interface Intent {kind:OutputKind;prompt:string;referenceSlot?:number}
export function intent(workspace:Workspace,mode:string,prompt:string,hasReference:boolean,guide:boolean,usage:string):Intent {
  if(!prompt.trim())throw new Error('请描述希望生成或修改的内容');
  const modes={local:['edit','remove','background'],cosplay:['effect','costume','reference','scene','atmosphere'],t2i:['generate']};
  if(!modes[workspace]?.includes(mode))throw new Error('不支持的工作区或模式');
  if(mode==='reference'&&!hasReference)throw new Error('角色参考辅助需要选择一张参考图');
  const kind:OutputKind=workspace==='t2i'?'t2i':mode==='effect'||mode==='atmosphere'?'asset':'edit';
  if(hasReference&&kind!=='edit')throw new Error('参考图用于编辑路径；生成独立素材或文字生图前请清除参考图');
  let text=prompt.trim();
  if(kind==='edit') {
    text='编辑 <image1> 中指定的局部内容，保持原画布、主体大小、位置、姿态、场景透视和未指定内容。不要缩小主体、重新构图或添加留白。'+text;
    if(mode==='remove')text+=' 移除选中对象后补齐其背后的材质与结构。';
    if(guide)text+=' <image2> 是与原图对齐的范围蒙版，白色允许修改，黑色保留。不要在结果中画出蒙版。';
    if(hasReference){const slot=guide?3:2;text+=` <image${slot}> 是${usage}参考图，仅参考指定内容，保留原人物面部、姿态与未选区域。`;return {kind,prompt:text,referenceSlot:slot};}
  }else if(kind==='asset')text+=' 独立可合成的特效/氛围素材，transparent background, RGBA image，保留自然半透明边缘，不要实心黑底、白底、文字或场景。';
  return {kind,prompt:text};
}
