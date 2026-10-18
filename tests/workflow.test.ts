import test from 'node:test';import assert from 'node:assert/strict';
import {buildGraph} from '../src/generation/workflow';
const options={requestId:'abc',prompt:'修复道具',seed:42,steps:25,resolution:992};
test('原图、范围辅助和角色参考按固定顺序绑定，latent 使用第一图',()=>{
  const g=buildGraph({...options,source:'original.png',guide:'mask.png',reference:'character.png'});
  assert.deepEqual(g['4'].inputs['images.image_1'],['12',0]);
  assert.deepEqual(g['4'].inputs['images.image_2'],['10',0]);
  assert.deepEqual(g['4'].inputs['images.image_3'],['14',0]);
  assert.deepEqual(g['6'].inputs.latent_image,['4',2]);
  assert.equal(g['9'].inputs.image,'original.png');
  assert.equal(g['1'].inputs.unet_name,'qwen-image-2.1-Q4_K_M.gguf');
  assert.equal(g['6'].inputs.denoise,1);assert.equal(g['6'].inputs.cfg,1);
});
test('没有范围辅助时角色参考进入 image_2；拒绝无原图的参考',()=>{
  const g=buildGraph({...options,source:'original.png',reference:'character.png'});
  assert.deepEqual(g['4'].inputs['images.image_2'],['13',0]);
  assert.throws(()=>buildGraph({...options,reference:'character.png'}));
});
test('t2i 不连接参考和 VAE 输入；非法种子步数分辨率不得提交',()=>{
  const g=buildGraph(options);assert.equal(g['4'].inputs.vae,undefined);
  assert.equal(g['9'],undefined);
  for(const bad of [{steps:0},{seed:-1},{resolution:1023},{prompt:' '}]) assert.throws(()=>buildGraph({...options,...bad}));
});
test('编辑图使用预缩放第一参考的尺寸，禁用节点再次等面积缩放',()=>{
  const g=buildGraph({...options,source:'32x320.png'});assert.equal(g['4'].inputs.resolution,0);
});

test('LoadImage 的反向 MASK 重组成 RGBA 后送入 Qwen，原图及角色参考都保留 alpha',()=>{
  const g=buildGraph({...options,source:'transparent.png',reference:'character.png'});
  for(const [load,slot] of [['9','1'],['10','2']]){
    const joined=(g['4'].inputs[`images.image_${slot}`] as [string,number])[0];
    assert.equal(g[joined].class_type,'JoinImageWithAlpha');
    assert.deepEqual(g[joined].inputs,{image:[load,0],alpha:[load,1]});
  }
});
