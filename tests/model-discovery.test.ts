import test from 'node:test';import assert from 'node:assert/strict';
import {DEFAULT_MODELS} from '../src/infrastructure/config/profile';
import {suggestModelMappings} from '../src/diagnostics/model-discovery';

test('model discovery preserves visible current choices and fills exact or unique nested presets',()=>{
  const current={unet:'custom/Q5_K_M.gguf',clip:'missing.safetensors',vae:'old.safetensors'};
  const found=suggestModelMappings({unet:[current.unet,DEFAULT_MODELS.unet],clip:[`qwen/${DEFAULT_MODELS.clip}`],vae:[DEFAULT_MODELS.vae,`other/${DEFAULT_MODELS.vae}`]},current);
  assert.deepEqual(found,{models:{unet:current.unet,clip:`qwen/${DEFAULT_MODELS.clip}`,vae:DEFAULT_MODELS.vae},changed:['clip','vae'],unresolved:[]});
  assert.deepEqual(current,{unet:'custom/Q5_K_M.gguf',clip:'missing.safetensors',vae:'old.safetensors'});
});

test('model discovery leaves ambiguous, unrelated and unsafe paths unresolved',()=>{
  const current={...DEFAULT_MODELS};
  const found=suggestModelMappings({unet:['qwen-image-2.1-Q5_K_M.gguf'],clip:[`a/${current.clip}`,`b/${current.clip}`],vae:[`../${current.vae}`]},current);
  assert.deepEqual(found,{models:current,changed:[],unresolved:['unet','clip','vae']});
});

test('model discovery matches relative Windows separators without changing loader names',()=>{
  const found=suggestModelMappings({unet:[`nested\\${DEFAULT_MODELS.unet}`],clip:[DEFAULT_MODELS.clip],vae:[DEFAULT_MODELS.vae]},DEFAULT_MODELS);
  assert.equal(found.models.unet,`nested\\${DEFAULT_MODELS.unet}`);assert.deepEqual(found.unresolved,[]);
});

test('explicit custom choices for all three roles are retained even when tested presets are available',()=>{
  const current={unet:'custom/qwen-image-2.1-Q5_K_M.gguf',clip:'custom/qwen21-compatible-encoder.safetensors',vae:'custom/qwen21-compatible-vae.safetensors'};
  const inventory={unet:[DEFAULT_MODELS.unet,current.unet],clip:[DEFAULT_MODELS.clip,current.clip],vae:[DEFAULT_MODELS.vae,current.vae]};
  assert.deepEqual(suggestModelMappings(inventory,current),{models:current,changed:[],unresolved:[]});
});
