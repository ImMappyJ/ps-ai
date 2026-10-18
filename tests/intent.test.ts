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
    const base=intent('cosplay','blend','',false,true,'材质',binding);
    assert.equal(base.kind,'edit');assert.match(base.prompt,/整张.*环境/);assert.match(base.prompt,/光线.*色温.*对比度.*纹理.*景深/);
    assert.match(base.prompt,/只修改.*主体/);assert.match(base.prompt,/身份.*姿态.*位置.*比例.*结构/);
    const extra=intent('cosplay','blend',raw,false,true,'材质',binding);assert.ok(extra.prompt.includes(raw.trim()));
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
