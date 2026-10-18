import test from 'node:test';import assert from 'node:assert/strict';
import {validateCapabilities,validateGeneration} from '../src/infrastructure/backends/gateway-protocol';

test('Image Blending is an edit gateway operation with source and semantic prompt text intact',()=>{
  const caps=validateCapabilities({protocol:'ps-ai/1',provider:'openai',configured:true,cancellation:'none',progress:'stages',models:[{id:'gpt-image-1.5',label:'GPT',operations:['edit','asset'],maxInputImages:3,outputDepths:[8],seedMax:0,minPixels:1,maxPixels:4194304,maxAspectRatio:3}]});
  const id='11111111-1111-4111-8111-111111111111',prompt='match environmental light; retain literal <image9>';
  const request={model:'gpt-image-1.5',kind:'edit',mode:'blend',prompt,seed:0,width:512,height:512,outputDepth:8,source:id+'-source.png',guide:id+'-guide.png',reference:id+'-reference.png'};
  assert.equal(validateGeneration(request,caps).prompt,prompt);
  assert.throws(()=>validateGeneration({...request,source:undefined},caps),/input/);
  assert.throws(()=>validateGeneration({...request,kind:'asset'},caps),/mode/);
});
