import test from 'node:test';
import assert from 'node:assert/strict';
import {outwardBlendMask,validateEdgeBlend,edgeBlendMask,automaticEdgeRadius,supportsEdgeBlend} from '../src/features/editing/edge-blend';

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

test('edge blend versions reject coercible JSON values instead of granting new mask behavior',()=>{
  for(const version of [['outward-v1'],['outward-v2'],{value:'outward-v2'},null,1]){
    const value=JSON.parse(JSON.stringify({version,radius:300}));
    assert.throws(()=>validateEdgeBlend(value),/参数/);
  }
});

test('wide v2 falloff reaches hundreds of native pixels with a stable core and exact protection',()=>{
  const width=2301,raw=new Uint8Array(width);raw[1150]=255;const protection=new Uint8Array(width);protection[1300]=255;protection[1400]=128;
  const edge={version:'outward-v2' as const,radius:1024},plain=edgeBlendMask(raw,width,1,edge),masked=edgeBlendMask(raw,width,1,edge,protection);
  assert.equal(plain[1150],255);assert.ok(plain[1150+512]>110&&plain[1150+512]<140);assert.ok(plain[1150+900]>10);
  assert.equal(plain[1150+1025],0);assert.equal(plain[1150-1025],0);assert.equal(masked[1300],0);assert.equal(masked[1400],Math.round(plain[1400]*127/255));
  for(let i=0;i<1150;i++)assert.equal(plain[1150-i],plain[1150+i]);assert.equal(raw.filter(v=>v>0).length,1);
});

test('v2 preserves original feather coverage and has no row wrapping or diagonal support past its radius',()=>{
  const width=21,height=21,raw=new Uint8Array(width*height);raw[10*width+10]=255;raw[0]=64;
  const result=edgeBlendMask(raw,width,height,{version:'outward-v2',radius:6});assert.ok(result[0]>=64);assert.equal(result[20],0);assert.equal(result[15*width+15],0);assert.ok(result[14*width+14]>0);
  for(let p=0;p<raw.length;p++)assert.ok(result[p]>=raw[p]);
  assert.deepEqual(edgeBlendMask(raw,width,height,{version:'outward-v1',radius:6}),outwardBlendMask(raw,width,height,6));
});

test('v2 empty and full selections stay exact, with protection applied once and no input mutation',()=>{
  const protection=Uint8Array.from([0,64,128,255]);
  for(const coverage of [0,255]){
    const raw=new Uint8Array(4).fill(coverage),before=raw.slice();
    const result=edgeBlendMask(raw,2,2,{version:'outward-v2',radius:1024},protection);
    assert.deepEqual([...result],[...protection].map(value=>Math.round(coverage*(255-value)/255)));
    assert.deepEqual(raw,before);assert.notEqual(result,raw);
  }
});

test('wide masks are explicit and auto width follows native selection size in the three edit modes',()=>{
  assert.equal(automaticEdgeRadius({left:100,top:200,right:1411,bottom:1948}),197);assert.equal(automaticEdgeRadius({left:0,top:0,right:16,bottom:16}),8);assert.equal(automaticEdgeRadius({left:0,top:0,right:6000,bottom:7000}),512);
  for(const mode of ['edit','costume','reference'])assert.ok(supportsEdgeBlend(mode));for(const mode of ['remove','background','scene','effect','blend','relight','generate'])assert.equal(supportsEdgeBlend(mode),false);
  assert.deepEqual(validateEdgeBlend({version:'outward-v2',radius:1024}),{version:'outward-v2',radius:1024});assert.throws(()=>validateEdgeBlend({version:'outward-v2',radius:1025}));assert.throws(()=>validateEdgeBlend({version:'outward-v1',radius:65}));
});
