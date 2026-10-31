import test from 'node:test';
import assert from 'node:assert/strict';
import {outwardBlendMask,validateEdgeBlend} from '../src/features/editing/edge-blend';

test('outward edge blend keeps solid content, fades outward and stops at the native radius',()=>{
  const raw=new Uint8Array(13*9);raw[4*13+6]=255;const original=raw.slice();
  const mask=outwardBlendMask(raw,13,9,3);
  assert.deepEqual(raw,original);assert.equal(mask[4*13+6],255);
  assert.ok(mask[4*13+7]>mask[4*13+8]&&mask[4*13+8]>mask[4*13+9]&&mask[4*13+9]>0);
  assert.equal(mask[4*13+10],0);assert.equal(mask[0],0);
  for(let y=0;y<9;y++)for(let x=0;x<13;x++){assert.equal(mask[y*13+x],mask[y*13+12-x]);assert.equal(mask[y*13+x],mask[(8-y)*13+x]);}
});
test('protection is applied after outward blending once and disabled blending preserves feather values',()=>{
  const raw=Uint8Array.from([0,64,128,255,0,0,0]),protection=Uint8Array.from([0,0,0,0,255,128,0]);
  assert.deepEqual(outwardBlendMask(raw,7,1,0),raw);
  const expanded=outwardBlendMask(raw,7,1,3),protectedMask=outwardBlendMask(raw,7,1,3,protection);
  assert.equal(protectedMask[4],0);assert.equal(protectedMask[5],Math.round(expanded[5]*127/255));
  assert.equal(protectedMask[3],255);assert.equal(raw[1],64);
});
test('outward mask handles image edges, empty masks and narrow canvases without wraparound',()=>{
  assert.deepEqual(outwardBlendMask(new Uint8Array(9),3,3,8),new Uint8Array(9));
  const corner=outwardBlendMask(Uint8Array.from([0,0,255,0,0,0]),3,2,1);
  assert.equal(corner[3],0);assert.ok(corner[5]>0);
  const vertical=outwardBlendMask(Uint8Array.from([0,0,255,0,0]),1,5,1);
  assert.deepEqual([...vertical],[0,127,255,127,0]);
});
test('edge blend metadata is explicit, bounded and versioned',()=>{
  assert.deepEqual(validateEdgeBlend({version:'outward-v1',radius:8}),{version:'outward-v1',radius:8});
  for(const value of [null,{version:'future',radius:8},{version:'outward-v1',radius:0},{version:'outward-v1',radius:65},{version:'outward-v1',radius:1.5},{version:'outward-v1',radius:8,extra:true}])assert.throws(()=>validateEdgeBlend(value));
  assert.throws(()=>outwardBlendMask(new Uint8Array(3),2,2,8));assert.throws(()=>outwardBlendMask(new Uint8Array(4),2,2,8,new Uint8Array(3)));
});
