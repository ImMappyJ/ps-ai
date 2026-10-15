import test from 'node:test';import assert from 'node:assert/strict';import {intent} from '../src/intent';
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
