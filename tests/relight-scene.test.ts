import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRelightScene,validateRelightScene,sceneFingerprint,RelightEditor,compileRelightScene,
  normalizedToDocument,documentToNormalized,normalizedToModel,modelToNormalized,
  normalizedToViewport,viewportToNormalized,viewportLightIndicator,
  type RelightSource,type RelightScene,type RelightGeometry,type RelightViewport,type RelightCapabilities,
} from '../src/features/relight/relight-scene';

const source=():RelightSource=>({documentId:17,layerIds:[21,22],sessionId:'session-a',historyId:31,
  sourceHash:'f2a7981',snapshotId:'snapshot-a',docWidth:1000,docHeight:900,
  bounds:{left:100,top:200,right:600,bottom:600},profile:'sRGB IEC61966-2.1',documentMode:'RGBColor',documentDepth:8,maskRef:'mask-a'});
const scene=()=>createRelightScene(source(),'key-a');
const caps:RelightCapabilities={provider:'comfyui',model:'qwen-image-2.1',edit:true,maxInputImages:8,maskMode:'guide',seed:true};
const geometry:RelightGeometry={bounds:{left:100,top:200,right:600,bottom:600},modelWidth:1024,modelHeight:1024,
  modelContentRect:{left:112,top:192,right:912,bottom:832}};
const viewport:RelightViewport={clientRect:{left:30,top:40,width:900,height:600},fitScale:1.2,zoom:1,panX:0,panY:0};
const near=(a:{x:number;y:number},b:{x:number;y:number})=>{
  assert.ok(Math.abs(a.x-b.x)<1e-8,`x: ${a.x} != ${b.x}`);assert.ok(Math.abs(a.y-b.y)<1e-8,`y: ${a.y} != ${b.y}`);
};

test('default scene has a source-bound key and valid inactive type fields',()=>{
  const s=scene();assert.equal(s.schemaVersion,1);assert.equal(s.parameterVersion,1);
  assert.deepEqual(s.lights[0],{id:'key-a',name:'Key light',type:'point',role:'key',enabled:true,positionLocked:false,
    x:.25,y:.25,z:.5,targetX:.5,targetY:.5,direction:45,elevation:45,intensity:1,range:.75,softness:.7,cone:60,
    color:{mode:'temperature',kelvin:5600},scope:'edit-mask'});
  assert.deepEqual(s.ambient,{intensity:.15,color:'#FFFFFF'});assert.deepEqual(s.shadow,{strength:.5,softness:.6});
  assert.equal(s.existingLighting,'reshape');assert.equal(s.preserveContent,'strict');assert.equal(s.supplement,'');
  const input=source(),copy=createRelightScene(input,'one');input.layerIds[0]=99;input.bounds.left=0;
  assert.deepEqual(copy.source.layerIds,[21,22]);assert.equal(copy.source.bounds.left,100);
});

test('validation rejects versions, unknown fields, unsafe source bindings and malformed light data',()=>{
  const rejects=(mutate:(s:any)=>void)=>{const s:any=scene();mutate(s);assert.throws(()=>validateRelightScene(s));};
  rejects(s=>s.schemaVersion=2);rejects(s=>s.parameterVersion=2);rejects(s=>s.viewport={zoom:1});rejects(s=>s.apiKey='secret');
  rejects(s=>s.source.bounds.right=100);rejects(s=>s.source.bounds.left=-1);rejects(s=>s.source.docWidth=0);
  rejects(s=>s.source.documentDepth=32);rejects(s=>s.source.layerIds=[21,21]);rejects(s=>s.source.maskRef='');
  rejects(s=>s.source.documentId=NaN);rejects(s=>s.source.historyId=Infinity);rejects(s=>s.source.profile='');
  rejects(s=>s.lights[0].id='');rejects(s=>s.lights[0].name='x'.repeat(81));rejects(s=>s.lights[0].enabled=1);
  rejects(s=>s.lights[0].x=2.01);rejects(s=>s.lights[0].z=-1.01);rejects(s=>s.lights[0].direction=181);
  rejects(s=>s.lights[0].elevation=-91);rejects(s=>s.lights[0].intensity=NaN);rejects(s=>s.lights[0].range=.049);
  rejects(s=>s.lights[0].softness=Infinity);rejects(s=>s.lights[0].cone=4);rejects(s=>s.lights[0].scope='subject');
  rejects(s=>s.lights[0].color={mode:'temperature',kelvin:1999});
  rejects(s=>s.lights[0].color={mode:'temperature',kelvin:5600,hex:'#FFFFFF'});
  rejects(s=>s.lights[0].color={mode:'custom',hex:'#XYZ123'});rejects(s=>s.lights.push({...s.lights[0]}));
  rejects(s=>s.lights=Array.from({length:9},(_,i)=>({...s.lights[0],id:`light-${i}`})));
  rejects(s=>s.ambient.intensity=4.01);rejects(s=>s.shadow.strength=-.01);rejects(s=>s.supplement='bad\0text');
});

test('validation accepts range boundaries and creates an isolated sanitized copy',()=>{
  const s=scene(),l=s.lights[0];Object.assign(l,{x:-1,y:2,z:-1,targetX:2,targetY:-1,direction:-180,elevation:90,intensity:4,range:3,softness:0,cone:160,color:{mode:'custom',hex:'#abc123'}});
  const copy=validateRelightScene(s);assert.equal(copy.lights[0].color.mode,'custom');
  assert.deepEqual(copy.lights[0].color,{mode:'custom',hex:'#ABC123'});copy.lights[0].x=1;copy.source.bounds.left=1;
  assert.equal(s.lights[0].x,-1);assert.equal(s.source.bounds.left,100);
  s.lights=[];assert.equal(validateRelightScene(s).lights.length,0);
});

test('source validation allows a small crop in a large document and bounds persisted strings',()=>{
  const binding=source();binding.docWidth=20000;binding.docHeight=12000;binding.bounds={left:18000,top:11000,right:18400,bottom:11200};
  assert.deepEqual(createRelightScene(binding,'large-doc').source.bounds,{left:18000,top:11000,right:18400,bottom:11200});
  for(const key of ['sessionId','sourceHash','snapshotId','profile','documentMode','maskRef'] as const){const bad=scene();bad.source[key]='x'.repeat(1000);assert.throws(()=>validateRelightScene(bad));}
  const bad=scene();bad.supplement='x'.repeat(8001);assert.throws(()=>validateRelightScene(bad));
  bad.supplement='';bad.source.bounds={left:0,top:0,right:5000,bottom:4000};bad.source.docWidth=20000;bad.source.docHeight=12000;assert.throws(()=>validateRelightScene(bad));
});

test('scene validation rejects accessors without executing their code',()=>{
  const s=scene();let calls=0;s.lights[0].color=Object.defineProperty({kelvin:5600},'mode',{enumerable:true,get:()=>{calls++;return 'temperature';}}) as any;
  assert.throws(()=>validateRelightScene(s));assert.equal(calls,0);
});

test('fingerprint is canonical and responds only to active lighting intent and source',()=>{
  const s=scene(),fp=sceneFingerprint(s);
  const reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,val])=>[k,reorder(val)])):v;
  assert.equal(sceneFingerprint(reorder(s)),fp);assert.match(fp,/^relight-v1:sha256:[0-9a-f]{64}$/);
  s.lights[0].name='renamed';s.lights[0].positionLocked=true;s.lights[0].targetX=1.5;s.lights[0].direction=-10;
  assert.equal(sceneFingerprint(s),fp);
  const off={...s.lights[0],id:'off',enabled:false,intensity:4};s.lights.push(off);assert.equal(sceneFingerprint(s),fp);
  off.color={mode:'custom',hex:'#FF0000'};assert.equal(sceneFingerprint(s),fp);
  s.lights[0].intensity=2;assert.notEqual(sceneFingerprint(s),fp);
  const sourceChange=scene();sourceChange.source.snapshotId='different';assert.notEqual(sceneFingerprint(sourceChange),fp);
  const text=scene();text.supplement='  保留文字\nDo not add objects.  ';assert.notEqual(sceneFingerprint(text),fp);
});

test('editor keeps source fixed and returned snapshots, add and duplicate results isolated',()=>{
  const s=scene(),editor=new RelightEditor(s);s.source.layerIds.push(99);s.lights[0].x=0;
  assert.equal(editor.snapshot().lights[0].x,.25);assert.equal(editor.selectedId,'key-a');
  const added=editor.add('fill-a');assert.equal(editor.selectedId,'fill-a');added.x=2;
  assert.equal(editor.snapshot().lights[1].x,.25);
  editor.updateLight('fill-a',{role:'fill',intensity:.3});const dupe=editor.duplicate('fill-a','fill-b');
  assert.equal(dupe.intensity,.3);assert.equal(dupe.role,'fill');dupe.color={mode:'custom',hex:'#000000'};
  assert.deepEqual(editor.snapshot().lights[2].color,{mode:'temperature',kelvin:5600});
  const snap=editor.snapshot();snap.source.bounds.left=0;snap.lights[0].color={mode:'custom',hex:'#000000'};
  assert.equal(editor.snapshot().source.bounds.left,100);
  assert.throws(()=>editor.updateScene({source:source()} as any),/source|unsupported|unknown/i);
  assert.throws(()=>editor.updateLight('key-a',{id:'replacement'} as any));
  assert.throws(()=>editor.select('missing'));assert.throws(()=>editor.add('key-a'));
  editor.select(null);assert.equal(editor.selectedId,null);editor.remove('fill-b');assert.equal(editor.snapshot().lights.length,2);
});

test('one gesture produces one undo entry, cancellation restores state and no-ops preserve redo',()=>{
  const editor=new RelightEditor(scene());editor.beginGesture();editor.updateLight('key-a',{x:.4});editor.updateLight('key-a',{x:.7});editor.endGesture();
  assert.equal(editor.canUndo,true);editor.undo();assert.equal(editor.snapshot().lights[0].x,.25);assert.equal(editor.canUndo,false);assert.equal(editor.canRedo,true);
  editor.updateLight('key-a',{x:.25});editor.beginGesture();editor.endGesture();assert.equal(editor.canRedo,true);
  editor.redo();assert.equal(editor.snapshot().lights[0].x,.7);editor.beginGesture();editor.updateLight('key-a',{x:1});editor.cancelGesture();
  assert.equal(editor.snapshot().lights[0].x,.7);editor.undo();editor.updateScene({shadow:{strength:.8}});assert.equal(editor.canRedo,false);
  assert.equal(editor.snapshot().shadow.softness,.6);assert.equal(editor.snapshot().shadow.strength,.8);
});

test('editor position lock blocks movement until explicitly unlocked and history is bounded',()=>{
  const editor=new RelightEditor(scene());editor.updateLight('key-a',{positionLocked:true});
  assert.throws(()=>editor.updateLight('key-a',{x:.4}),/lock/i);assert.throws(()=>editor.updateLight('key-a',{z:0}),/lock/i);
  editor.updateLight('key-a',{positionLocked:false,x:.4});assert.equal(editor.snapshot().lights[0].x,.4);
  for(let i=0;i<120;i++)editor.updateLight('key-a',{intensity:i%2?1:2});
  let count=0;while(editor.canUndo){editor.undo();count++;}assert.equal(count,100);
  const bounded=new RelightEditor(scene());for(let i=1;i<8;i++)bounded.add(`light-${i}`);
  assert.throws(()=>bounded.add('ninth'));assert.equal(bounded.snapshot().lights.length,8);
});

test('document, padded model and viewport transforms have hand-checked offset coordinates',()=>{
  assert.deepEqual(normalizedToDocument({x:.25,y:.5},geometry),{x:225,y:400});
  assert.deepEqual(normalizedToModel({x:.25,y:.5},geometry),{x:312,y:512});
  assert.deepEqual(normalizedToViewport({x:0,y:0},geometry,viewport),{x:180,y:100});
  assert.deepEqual(normalizedToViewport({x:1,y:1},geometry,viewport),{x:780,y:580});
  const changed={...viewport,zoom:2,panX:15,panY:-20,clientRect:{left:10,top:20,width:1200,height:800}};
  assert.deepEqual(normalizedToViewport({x:.5,y:.5},geometry,changed),{x:625,y:400});
  for(const p of [{x:0,y:0},{x:.123,y:.789},{x:-1,y:2},{x:2,y:-1}]){
    near(documentToNormalized(normalizedToDocument(p,geometry),geometry),p);
    near(modelToNormalized(normalizedToModel(p,geometry),geometry),p);
    near(viewportToNormalized(normalizedToViewport(p,geometry,changed),geometry,changed),p);
  }
});

test('offscreen indicator finds lights without mutation and coordinate helpers reject invalid geometry',()=>{
  const p={x:-1,y:2},indicator=viewportLightIndicator(p,geometry,viewport);
  assert.equal(indicator.onScreen,false);assert.ok(indicator.indicator.x>=42&&indicator.indicator.x<=918);
  assert.ok(indicator.indicator.y>=52&&indicator.indicator.y<=628);assert.deepEqual(p,{x:-1,y:2});
  assert.equal(viewportLightIndicator({x:.5,y:.5},geometry,viewport).onScreen,true);
  for(const invalid of [{...geometry,bounds:{left:0,top:0,right:0,bottom:4}},{...geometry,modelWidth:0},
    {...geometry,modelContentRect:{left:-1,top:0,right:8,bottom:8}}])assert.throws(()=>normalizedToModel(p,invalid));
  assert.throws(()=>normalizedToViewport(p,geometry,{...viewport,fitScale:0}));
  assert.throws(()=>viewportToNormalized(p,geometry,{...viewport,zoom:NaN}));
  assert.throws(()=>normalizedToDocument({x:Infinity,y:0},geometry));
});

test('viewport conversion rejects finite values whose combined scale would overflow',()=>{
  assert.throws(()=>normalizedToViewport({x:0,y:0},geometry,{...viewport,fitScale:1e308,zoom:1e308}),/viewport|scale|finite/i);
  assert.throws(()=>viewportToNormalized({x:0,y:0},geometry,{...viewport,fitScale:1e308,zoom:2}),/viewport|scale|finite/i);
});

test('compiler includes every enabled light in order with semantic roles, shape, color and content constraints',()=>{
  const editor=new RelightEditor(scene());editor.add('spot');editor.updateLight('spot',{type:'spot',role:'fill',x:.8,y:.2,z:-.1,targetX:.3,targetY:.7,cone:35,intensity:.4,color:{mode:'custom',hex:'#90aaff'}});
  editor.add('sun');editor.updateLight('sun',{type:'directional',role:'rim',direction:-45,elevation:30,intensity:2});
  editor.add('hidden');editor.updateLight('hidden',{enabled:false,color:{mode:'custom',hex:'#00FF00'}});
  const compiled=compileRelightScene(editor.snapshot(),caps);
  assert.equal(compiled.control,'semantic');assert.deepEqual(compiled.enabledLightIds,['key-a','spot','sun']);
  assert.ok(compiled.prompt.indexOf('point')<compiled.prompt.indexOf('spot'));assert.ok(compiled.prompt.indexOf('spot')<compiled.prompt.indexOf('directional'));
  for(const word of ['key','fill','rim','5600 K','#90AAFF','0.25','0.8','0.3','35','-45','30','ambient','shadow','composition','identity','pose','geometry','text','logos','garment patterns','material texture','edit mask'])assert.ok(compiled.prompt.includes(word),word);
  assert.doesNotMatch(compiled.prompt,/#00FF00|image\s+\d|key-a|hidden|lumen|lux/i);
  const changed=editor.snapshot();changed.lights.forEach(l=>{l.name='new name';l.positionLocked=true;});assert.equal(compileRelightScene(changed,caps).prompt,compiled.prompt);
  assert.equal(compileRelightScene(editor.snapshot(),caps).prompt,compiled.prompt);
});

test('compiler rejects unsupported editing, ignores capability secrets and preserves supplement exactly with limited conflict warnings',()=>{
  assert.throws(()=>compileRelightScene(scene(),{...caps,edit:false}),/edit/i);
  assert.throws(()=>compileRelightScene(scene(),{...caps,maxInputImages:0}),/image|source/i);
  const s=scene();s.lights[0].x=.8;s.supplement='  No shadows. left-only lighting; all lights off.\n保留原图  ';
  const result=compileRelightScene(s,{...caps,token:'PRIVATE'} as any);
  assert.ok(result.prompt.endsWith(s.supplement));assert.doesNotMatch(result.prompt,/PRIVATE/);
  assert.ok(result.warnings.some(w=>/shadow/i.test(w)));assert.ok(result.warnings.some(w=>/left|right/i.test(w)));
  assert.ok(result.warnings.some(w=>/off|active/i.test(w)));assert.ok(result.warnings.some(w=>/semantic/i.test(w)));
  s.lights=[];s.supplement='';const ambient=compileRelightScene(s,caps);
  assert.deepEqual(ambient.enabledLightIds,[]);assert.match(ambient.prompt,/ambient-only/i);
});

test('compiler prioritizes natural side, temperature and intensity hierarchy without editor metadata',()=>{
  const editor=new RelightEditor(scene());
  editor.updateLight('key-a',{x:.1,y:.25,z:.25,intensity:2,range:1.4,softness:.8,color:{mode:'temperature',kelvin:3000}});
  editor.add('fill');editor.updateLight('fill',{role:'fill',x:.9,y:.25,z:.25,intensity:.15,range:1.4,softness:.8,color:{mode:'custom',hex:'#FFFFFF'}});
  editor.updateScene({ambient:{intensity:.08},shadow:{strength:.7,softness:.6}});
  const left=compileRelightScene(editor.snapshot(),caps);
  assert.match(left.prompt,/strong.*soft warm amber key light from the upper left/i);
  assert.match(left.prompt,/very weak.*soft neutral white fill light from the upper right/i);
  assert.match(left.prompt,/dim neutral white ambient light/i);assert.match(left.prompt,/visible directional shading and soft shadows/i);
  for(const number of ['3000 K','2','0.15','1.4','0.8','0.08','0.7','0.6'])assert.ok(left.prompt.includes(number),number);
  assert.doesNotMatch(left.prompt,/\b(?:editor|markers|preview|normalized|origin|calibrated|3D|guarantee|semantic|padding)\b/i);
  assert.ok(left.warnings.some(w=>/semantic/i.test(w)));
  editor.updateLight('key-a',{x:.9});const right=compileRelightScene(editor.snapshot(),caps);
  assert.match(right.prompt,/warm amber key light from the upper right/i);assert.doesNotMatch(right.prompt,/key light from the upper left/i);
});

test('compiler gives custom colors, off-image placement, spot targets and parallel directions natural words',()=>{
  const s=scene();Object.assign(s.lights[0],{x:-.4,y:.2,color:{mode:'custom',hex:'#FFD2A0'}});
  assert.match(compileRelightScene(s,caps).prompt,/warm amber key light from the off-image upper left/i);
  s.lights[0].color={mode:'custom',hex:'#90AAFF'};assert.match(compileRelightScene(s,caps).prompt,/cool blue key light/i);
  Object.assign(s.lights[0],{type:'spot',targetX:.8,targetY:.8,cone:35});
  const spot=compileRelightScene(s,caps).prompt;assert.match(spot,/aim(?:ed|ing)? toward the lower right/i);assert.match(spot,/narrow beam/);assert.match(spot,/35/);assert.match(spot,/#90AAFF/);
  s.lights[0].cone=150;assert.match(compileRelightScene(s,caps).prompt,/wide beam/);
  Object.assign(s.lights[0],{type:'directional',direction:-45,elevation:30});
  const directional=compileRelightScene(s,caps).prompt;assert.match(directional,/cool blue key light from the upper right/i);
  assert.match(directional,/parallel/i);assert.match(directional,/-45/);assert.match(directional,/30/);assert.doesNotMatch(directional,/x=-0\.4|\btarget\b|\brange\b/);
  s.lights[0].color={mode:'temperature',kelvin:9000};assert.match(compileRelightScene(s,caps).prompt,/cool blue key light/i);
});
