import test from 'node:test';import assert from 'node:assert/strict';import {panelHarness} from './uxp-harness';import {defaultSettings} from '../src/infrastructure/config/profile';

test('Portrait label translates without changing persisted workspace or relight prompts',async()=>{
  const h=await panelHarness();try{
    await h.wait();assert.equal(h.el('tab-cosplay').textContent,'人像');
    const prompt='左暖右冷，保留五官',ordinary='保留普通修图草稿';
    h.el('prompt').value=ordinary;h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');h.el('resolution').value='32';
    h.click('generate');await h.wait();
    assert.equal(h.posts.length,0,'the main Generate button opens the workbench without submitting');
    assert.equal(h.el('relight-dialog').hasAttribute('open'),true);assert.equal(h.el('prompt-group').style.display,'none');
    h.el('relight-supplement').value=prompt;h.change('relight-supplement');h.click('relight-close');await h.wait();
    h.el('language').value='en-US';h.change('language');await h.wait();
    assert.equal(h.el('tab-cosplay').textContent,'Portrait');assert.equal(h.el('mode').value,'relight');assert.equal(h.el('prompt').value,ordinary);
    h.click('generate');await h.wait();assert.equal(h.el('relight-supplement').value,prompt);assert.equal(h.posts.length,0);
    h.click('relight-generate');await h.wait();
    assert.equal(h.posts.length,1);const record=h.records()[0];
    assert.equal((record.params as any).workspace,'cosplay');assert.equal((record.params as any).mode,'relight');
    assert.equal(record.userPrompt,prompt);assert.equal((record.relight as any).scene.supplement,prompt);assert.ok(h.posts[0].prompt['4'].inputs.prompt.includes(prompt));assert.ok(record.snapshot);
  }finally{await h.close();}
});

test('platform relight submits the semantic edit operation and preserves source capture',async()=>{
  const h=await panelHarness({settings:{...defaultSettings(),backend:'gateway',gatewayModel:'gemini-2.5-flash-image',baseUrl:'http://localhost:8190'},gateway:{provider:'gemini'}});try{
    await h.wait();h.click('tab-cosplay');h.el('mode').value='relight';h.change('mode');h.el('resolution').value='512';
    h.click('generate');await h.wait();assert.equal(h.gatewayPosts.length,0);assert.equal(h.el('relight-dialog').hasAttribute('open'),true);
    const prompt='左侧暖光，保留五官';h.el('relight-supplement').value=prompt;h.change('relight-supplement');
    h.click('relight-generate');await h.wait();assert.equal(h.gatewayPosts.length,1);
    const request=h.gatewayPosts[0].request,record=h.records()[0];
    assert.equal(request.mode,'relight');assert.equal(request.kind,'edit');assert.ok(request.source);assert.doesNotMatch(request.prompt,/<image1>/);assert.ok(request.prompt.includes(prompt));
    assert.equal((record.params as any).workspace,'cosplay');assert.equal(record.userPrompt,prompt);assert.equal((record.snapshot as any).documentId,11);
    assert.ok(h.captured.length>=2);assert.ok(h.captured.every(id=>id===11));assert.ok(h.uploads.some(upload=>upload.name===request.source));
  }finally{await h.close();}
});
