import test from 'node:test';
import assert from 'node:assert/strict';
import {panelHarness} from './uxp-harness';
import {defaultSettings} from '../src/infrastructure/config/profile';

test('photo task navigation removes duplicate scene/costume and exposes reference with local edits',async()=>{
  const h=await panelHarness();try{
    await h.wait();
    const modes=()=>Array.from(h.el('mode').querySelectorAll('option')).map((o:any)=>o.value);
    assert.deepEqual(modes(),['edit','remove','background','reference']);
    h.click('tab-cosplay');assert.deepEqual(modes(),['effect','relight','blend']);
    h.click('tab-t2i');assert.deepEqual(modes(),['generate']);
  }finally{await h.close();}
});

test('browsing presets is read-only; explicit use configures a landscape edit without generation',async()=>{
  const h=await panelHarness({uxpSelect:true,settings:defaultSettings()});try{
    await h.wait();assert.ok(h.el('photo-preset'),'preset picker exists');
    h.el('prompt').value='my original draft';h.el('count').value='3';h.el('margin').value='27';
    const reads=h.pixelRequests.length,requests=h.requests.length;
    h.el('preset-category').value='landscape';h.change('preset-category');
    h.el('photo-preset').value='landscape-sunset';h.change('photo-preset');
    assert.equal(h.el('prompt').value,'my original draft');assert.equal(h.el('mode').value,'edit');
    assert.match(h.el('photo-preset-preview').textContent,/天空/);
    h.click('apply-photo-preset');await h.wait();
    assert.equal(h.el('mode').value,'edit');assert.match(h.el('prompt').value,/日落/);
    assert.equal(h.el('count').value,'3');assert.equal(h.el('margin').value,'27');
    assert.equal(h.pixelRequests.length,reads);assert.equal(h.requests.length,requests);
    const prompt=h.el('prompt').value;
    h.el('language').value='en-US';h.change('language');await h.wait();
    assert.equal(h.el('prompt').value,prompt);assert.equal(h.el('photo-preset').value,'landscape-sunset');
    assert.match(h.el('photo-preset').displayedCaption,/Sunset/);
    h.click('apply-photo-preset');await h.wait();assert.match(h.el('prompt').value,/sunset/i);
  }finally{await h.close();}
});

test('portrait background preset uses subject-preserving background pipeline and retains literal prompt in history',async()=>{
  const h=await panelHarness({selection:{bounds:{left:0,top:0,right:1,bottom:2},mask:new Uint8Array([255,0,255,0])}});try{
    await h.wait();assert.ok(h.el('photo-preset'));
    h.el('photo-preset').value='portrait-studio';h.change('photo-preset');
    h.click('apply-photo-preset');await h.wait();
    assert.equal(h.el('mode').value,'background');assert.match(h.el('selection-instruction').textContent,/保留的主体/);
    const prompt=h.el('prompt').value;h.el('resolution').value='32';h.click('generate');await h.wait();
    assert.equal(h.posts.length,1,h.el('diagnostic-summary').textContent);const r=h.records()[0];
    assert.equal((r.params as any).workspace,'local');assert.equal((r.params as any).mode,'background');
    assert.equal(r.userPrompt,prompt);assert.equal((r.params as any).preserveAlpha,false);
    assert.equal(h.posts[0].prompt['4'].inputs['images.image_2'],undefined);
  }finally{await h.close();}
});

test('legacy scene, costume and reference reuse routes to shared editing without rewriting saved records',async()=>{
  for(const [legacy,canonical] of [['scene','background'],['costume','edit'],['reference','reference']]){
    const id='12345678-1111-4111-8111-111111111111';
    const record={id,clientId:'ffffffff-1111-4111-8111-111111111111',state:'ready' as const,createdAt:'2026-11-01T00:00:00Z',graph:{},userPrompt:'literal saved prompt',params:{workspace:'cosplay',mode:legacy,steps:25,resolution:32,seed:42,destination:'selection',guide:false,margin:0.15,edgeBlend:0}};
    const h=await panelHarness({history:[record]});try{
      await h.wait();h.selectHistory(id);h.click('repeat-history');await h.wait();
      assert.equal(h.el('mode').value,canonical);assert.equal(h.el('tab-local').className,'active');
      assert.equal(h.el('prompt').value,'literal saved prompt');assert.equal((h.records()[0].params as any).mode,legacy);
      assert.equal(h.posts.length,0);assert.equal(h.uploads.length,0);
      if(canonical==='edit')assert.equal(h.el('edge-blend').value,'0');
    }finally{await h.close();}
  }
});

test('reference editing in the shared photo workspace still requires an imported reference',async()=>{
  const h=await panelHarness();try{
    await h.wait();h.el('mode').value='reference';h.change('mode');h.click('generate');await h.wait();
    assert.equal(h.posts.length,0);assert.match(h.el('diagnostic-summary').textContent,/参考图/);
    assert.equal(h.el('reference-body').style.display,'block');assert.equal(h.el('guide').checked,false);
  }finally{await h.close();}
});

test('preset application is blocked during generation and removal preserves the ordinary draft',async()=>{
  const h=await panelHarness();try{
    await h.wait();assert.ok(h.el('photo-preset'));
    h.el('prompt').value='keep this draft';h.el('preset-category').value='landscape';h.change('preset-category');
    h.el('photo-preset').value='landscape-remove';h.change('photo-preset');h.click('apply-photo-preset');await h.wait();
    assert.equal(h.el('mode').value,'remove');assert.equal(h.el('prompt').value,'keep this draft');
    h.el('photo-preset').value='landscape-sunset';h.change('photo-preset');h.el('resolution').value='32';h.holdCheck();h.click('generate');
    await new Promise(r=>setTimeout(r,35));assert.equal(h.el('apply-photo-preset').disabled,true);
    h.click('apply-photo-preset');assert.equal(h.el('mode').value,'remove');assert.equal(h.el('prompt').value,'keep this draft');
    h.releaseCheck();await h.wait();assert.equal(h.el('apply-photo-preset').disabled,false);
  }finally{h.releaseCheck();await h.close();}
});

test('a pending native source read locks presets and cannot be redirected by a queued preset click',async()=>{
  const h=await panelHarness();let release=()=>{};try{
    await h.wait();h.el('photo-preset').value='portrait-studio';h.change('photo-preset');
    const read=h.ps.imaging.getPixels,barrier=new Promise<void>(resolve=>{release=resolve;});
    let entered=()=>{};const started=new Promise<void>(resolve=>{entered=resolve;});
    h.ps.imaging.getPixels=async(options:any)=>{entered();await barrier;return read(options);};
    h.click('capture');await started;
    for(const id of ['preset-category','photo-preset','apply-photo-preset'])assert.equal(h.el(id).disabled,true);
    h.click('apply-photo-preset');assert.equal(h.el('mode').value,'edit');
    release();await h.wait();assert.equal(h.el('apply-photo-preset').disabled,false);assert.equal(h.posts.length,0);
    h.click('apply-photo-preset');await h.wait();assert.equal(h.el('mode').value,'background');
    assert.equal(h.el('selection-previews').style.display,'none','changing preset invalidates the captured preview');
  }finally{release();await h.close();}
});
