import test from 'node:test';import assert from 'node:assert/strict';import {intent} from '../src/generation/intent';

test('remove generates from the selection with no prompt and never includes a hidden draft',()=>{
  for(const binding of ['images','semantic'] as const){
    const empty=intent('local','remove','',false,true,'道具',binding);
    const hidden=intent('local','remove','PRIVATE DRAFT: paint the person red',false,true,'道具',binding);
    assert.equal(empty.kind,'edit');assert.equal(hidden.prompt,empty.prompt);
    assert.match(empty.prompt,/移除选中对象/);assert.match(empty.prompt,/材质.*结构.*光线.*透视/);
    assert.doesNotMatch(empty.prompt,/PRIVATE DRAFT/);
    if(binding==='semantic')assert.doesNotMatch(empty.prompt,/<image\d/);
  }
});

test('Image Blending uses the full source environment and permits optional supplemental instructions',()=>{
  const raw='  保留标签 <image9>，暖色轮廓光  ';
  for(const binding of ['images','semantic'] as const){
    const base=intent('cosplay','blend','',false,false,'材质',binding),source=binding==='semantic'?'来源图':'<image1>';
    // This is the action prompt exercised in the real source-only comparison.
    const expected=`根据 ${source} 主体周围可见的背景环境，重新为前景主体布光和调色，使主体呈现与背景一致的曝光、受光方向、阴影深浅、环境反射色和空间氛围。允许明显改变主体原有的明暗和冷暖，让主体自然置身于这个环境。保持人物身份、五官、姿态、轮廓位置和服装图案，保留主体原有的插画或摄影风格；背景构图保持不变。`;
    assert.equal(base.kind,'edit');assert.equal(base.prompt,expected);assert.doesNotMatch(base.prompt,/范围蒙版|<image2>/);
    const extra=intent('cosplay','blend',raw,false,false,'材质',binding);assert.equal(extra.prompt,expected+' 补充要求：'+raw.trim());
    assert.match(intent('cosplay','blend','',false,true,'材质',binding).prompt,/范围|蒙版/);
    if(binding==='semantic')assert.doesNotMatch(base.prompt,/<image\d/);else assert.match(base.prompt,/<image1>/);
  }
  assert.throws(()=>intent('local','blend','',false,false,'材质'),/工作区|模式/);
});

test('background and scene explicitly replace the environment while preserving the foreground and original request',()=>{
  for(const [workspace,mode] of [['local','background'],['cosplay','scene']] as const)for(const binding of ['images','semantic'] as const){
    const i=intent(workspace,mode,'少女站在舞台上',false,false,'场景',binding);
    assert.equal(i.kind,'edit');assert.match(i.prompt,/背景.*完整.*场景|完整.*场景.*背景/);assert.match(i.prompt,/不透明/);assert.match(i.prompt,/少女站在舞台上/);assert.match(i.prompt,/人物/);
    if(binding==='semantic')assert.doesNotMatch(i.prompt,/<image\d/);
  }
});
test('background reference follows the source when the ComfyUI visual guide is omitted',()=>{
  const request=intent('local','background','明亮舞台',true,false,'场景');
  assert.equal(request.referenceSlot,2);assert.match(request.prompt,/<image2> 是场景参考图/);assert.doesNotMatch(request.prompt,/范围蒙版/);
});
test('portrait relighting preserves requested lighting and uses the edit source/mask workflow',()=>{
  const raw='左侧暖色柔光，右侧保留冷色阴影';for(const binding of ['images','semantic'] as const){const i=intent('cosplay','relight',raw,false,true,'服装',binding);assert.equal(i.kind,'edit');assert.ok(i.prompt.includes(raw));assert.match(i.prompt,/光线|光影/);assert.match(i.prompt,/姿态/);if(binding==='semantic')assert.doesNotMatch(i.prompt,/<image[123]>/);else assert.match(i.prompt,/<image1>/);}
});
test('角色参考和氛围均为第一版路径，角色参考必须有图',()=>{
  assert.throws(()=>intent('cosplay','reference','红色铠甲',false,true,'服装'),/参考/);
  const role=intent('cosplay','reference','红色铠甲',true,true,'服装');assert.equal(role.kind,'edit');assert.equal(role.referenceSlot,3);assert.match(role.prompt,/<image3>/);
  assert.equal(intent('cosplay','atmosphere','烟尘',false,true,'服装').kind,'asset');
});
test('编辑模式绑定图像说明，素材明确透明背景，排除错误模式',()=>{
  assert.match(intent('local','remove','移除支撑杆',false,true,'道具').prompt,/<image1>/);
  assert.match(intent('cosplay','effect','蓝色电弧',false,false,'道具').prompt,/RGBA/);
  assert.equal(intent('t2i','generate','森林',false,false,'场景').kind,'t2i');
  assert.throws(()=>intent('local','portrait','磨皮',false,false,'服装'));assert.throws(()=>intent('t2i','generate',' ',false,false,'场景'));
});
test('素材和文字生图不静默忽略已选择的角色参考',()=>{
  assert.throws(()=>intent('cosplay','effect','雷电',true,true,'道具'),/参考/);
  assert.throws(()=>intent('t2i','generate','森林',true,false,'场景'),/参考/);
});

test('平台语义意图不规定图像编号，原始提示中的字面标记保持不变',()=>{
  const raw='把服装换成白色，保留标签 <image9>';
  const edit=intent('cosplay','reference',raw,true,true,'服装','semantic');assert.equal(edit.kind,'edit');assert.equal(edit.referenceSlot,undefined);assert.doesNotMatch(edit.prompt,/<image[123]>/);assert.ok(edit.prompt.includes(raw));assert.match(edit.prompt,/服装参考图/);
});

test('source-only Blend keeps an imported reference in the second image slot',()=>{
  const request=intent('cosplay','blend','',true,false,'材质');assert.equal(request.referenceSlot,2);assert.match(request.prompt,/<image2> 是材质参考图/);assert.doesNotMatch(request.prompt,/范围蒙版/);
});

test('selection-context assets use the photo and guide for independent transparent effects and atmosphere',()=>{
  const raw='  蓝色电弧，保留字面标签 <image9>  ';
  for(const mode of ['effect','atmosphere'])for(const binding of ['images','semantic'] as const){
    const request=intent('cosplay',mode,raw,false,true,'道具',binding,false,'selection-v1');
    assert.equal(request.kind,'asset');assert.equal(request.assetContext,'selection-v1');assert.equal(request.referenceSlot,undefined);
    assert.ok(request.prompt.includes(raw.trim()));assert.match(request.prompt,/独立.*素材/);assert.match(request.prompt,/transparent background.*RGBA/);
    assert.match(request.prompt,/位置.*尺度.*透视.*色调.*光线/);assert.match(request.prompt,/范围.*放置|放置.*范围/);
    assert.doesNotMatch(request.prompt,/编辑.*局部内容|保持原画布|未指定内容|原人物面部/);
    if(binding==='semantic')assert.doesNotMatch(request.prompt,/<image[123]>/);
    else {assert.match(request.prompt,/<image1>/);assert.match(request.prompt,/<image2>/);}
  }
});

test('selection-context intent cannot omit its guide or accept imported references and unsupported markers',()=>{
  const contextual=(mode:string,guide:boolean,hasReference=false,context:unknown='selection-v1')=>(intent as any)('cosplay',mode,'蓝色电弧',hasReference,guide,'道具','semantic',false,context);
  assert.throws(()=>contextual('effect',false),/范围|guide/);
  assert.throws(()=>contextual('atmosphere',true,true),/参考/);
  assert.throws(()=>contextual('effect',true,false,'selection-v2'),/素材|context/);
  assert.throws(()=>contextual('relight',true),/素材|context/);
  assert.throws(()=>(intent as any)('t2i','generate','森林',false,true,'场景','semantic',false,'selection-v1'),/素材|context/);
});

test('assets without a context marker keep their existing text-only meaning',()=>{
  for(const mode of ['effect','atmosphere']){
    const request=intent('cosplay',mode,'蓝色电弧',false,true,'道具');
    assert.equal(request.kind,'asset');assert.equal(request.assetContext,undefined);
    assert.equal(request.prompt,'蓝色电弧 独立可合成的特效/氛围素材，transparent background, RGBA image，保留自然半透明边缘，不要实心黑底、白底、文字或场景。');
    assert.doesNotMatch(request.prompt,/<image[123]>/);
  }
});
