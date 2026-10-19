import test from 'node:test';import assert from 'node:assert/strict';
import {validateCapabilities,validateGeneration} from '../src/infrastructure/backends/gateway-protocol';

const id='11111111-1111-4111-8111-111111111111';
const model={id:'gpt-image-1.5',label:'GPT',operations:['t2i','edit','asset'],maxInputImages:3,outputDepths:[8],seedMax:0,minPixels:1,maxPixels:4194304,maxAspectRatio:3};
const capabilities=(patch:Record<string,unknown>={})=>({protocol:'ps-ai/1',provider:'openai',configured:true,cancellation:'none',progress:'stages',models:[{...model,...patch}]});
const asset={model:model.id,kind:'asset',mode:'effect',prompt:'  independent blue lightning; literal <image9>  ',seed:0,width:512,height:512,outputDepth:8};
const source=id+'-source.png',guide=id+'-guide.png',reference=id+'-reference.png';

test('Image Blending is an edit gateway operation with source and semantic prompt text intact',()=>{
  const caps=validateCapabilities({protocol:'ps-ai/1',provider:'openai',configured:true,cancellation:'none',progress:'stages',models:[{id:'gpt-image-1.5',label:'GPT',operations:['edit','asset'],maxInputImages:3,outputDepths:[8],seedMax:0,minPixels:1,maxPixels:4194304,maxAspectRatio:3}]});
  const id='11111111-1111-4111-8111-111111111111',prompt='match environmental light; retain literal <image9>';
  const request={model:'gpt-image-1.5',kind:'edit',mode:'blend',prompt,seed:0,width:512,height:512,outputDepth:8,source:id+'-source.png',guide:id+'-guide.png',reference:id+'-reference.png'};
  assert.equal(validateGeneration(request,caps).prompt,prompt);
  assert.throws(()=>validateGeneration({...request,source:undefined},caps),/input/);
  assert.throws(()=>validateGeneration({...request,kind:'asset'},caps),/mode/);
});

test('validated asset-context capabilities retain only supported versions and copy their array',()=>{
  const declared=['selection-v1'],raw=capabilities({assetContexts:declared,privateField:'discard'});
  const validated=validateCapabilities(raw),copy=validated.models[0];
  assert.deepEqual(copy.assetContexts,['selection-v1']);assert.notEqual(copy.assetContexts,declared);assert.equal((copy as any).privateField,undefined);
  declared.length=0;assert.deepEqual(copy.assetContexts,['selection-v1']);
  assert.equal(validateCapabilities(capabilities()).models[0].assetContexts,undefined);
  assert.deepEqual(validateCapabilities(capabilities({assetContexts:[]})).models[0].assetContexts,[]);
  const assetOnly=validateCapabilities(capabilities({operations:['asset'],maxInputImages:2,assetContexts:['selection-v1']}));
  assert.equal(validateGeneration({...asset,assetContext:'selection-v1',source,guide},assetOnly).assetContext,'selection-v1');
});

test('asset-context capability declarations reject unknown or duplicate versions and unusable operations',()=>{
  for(const patch of [
    {assetContexts:['selection-v2']},{assetContexts:['selection-v1','selection-v1']},{assetContexts:'selection-v1'},
    {assetContexts:null},{assetContexts:['selection-v1'],operations:['edit','t2i']},{assetContexts:['selection-v1'],maxInputImages:1}
  ])assert.throws(()=>validateCapabilities(capabilities(patch)),/capabilit/);
});

test('selection-context assets require the declared capability and paired source and guide before upload',()=>{
  const caps=validateCapabilities(capabilities({assetContexts:['selection-v1']}));
  for(const mode of ['effect','atmosphere']){
    const request={...asset,mode,assetContext:'selection-v1',source,guide};
    assert.deepEqual(validateGeneration(request,caps),request);
    for(const patch of [{source:undefined},{guide:undefined},{source:undefined,guide:undefined},{reference},{source:'https://example.com/source.png'}])
      assert.throws(()=>validateGeneration({...request,...patch},caps),/input/);
  }
  const contextual={...asset,assetContext:'selection-v1',source,guide};
  for(const legacy of [capabilities(),capabilities({assetContexts:[]})])
    assert.throws(()=>validateGeneration(contextual,validateCapabilities(legacy)),/support.*asset context/i);
});

test('text-only assets and t2i remain valid for old capabilities and reject undeclared image inputs',()=>{
  const caps=validateCapabilities(capabilities());
  for(const request of [asset,{...asset,kind:'t2i',mode:'generate'}]){
    assert.deepEqual(validateGeneration(request,caps),request);
    for(const images of [{source},{guide},{reference},{source,guide}])assert.throws(()=>validateGeneration({...request,...images},caps),/input/);
  }
});

test('asset-context requests reject unknown versions, forbidden kinds and unknown generation fields',()=>{
  const caps=validateCapabilities(capabilities({assetContexts:['selection-v1']})),request={...asset,assetContext:'selection-v1',source,guide};
  for(const marker of ['selection-v2','',null,false])assert.throws(()=>validateGeneration({...request,assetContext:marker},caps),/asset context/i);
  for(const patch of [{kind:'edit',mode:'edit'},{kind:'t2i',mode:'generate'}])assert.throws(()=>validateGeneration({...request,...patch},caps),/asset context/i);
  assert.throws(()=>validateGeneration({...request,assetContextVersion:1},caps),/parameter/);
});
