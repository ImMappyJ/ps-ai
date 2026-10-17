import test from 'node:test';import assert from 'node:assert/strict';import {intent} from '../src/intent';

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
