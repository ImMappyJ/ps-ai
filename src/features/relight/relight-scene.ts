import {sha256} from '@noble/hashes/sha2.js';
import type {Bounds} from '../../imaging/image';
import {IMAGE_BUDGETS} from '../../imaging/budget';

export interface RelightPoint {x:number;y:number}
export type RelightColor={mode:'temperature';kelvin:number}|{mode:'custom';hex:string};
/** layerIds records visible-composite provenance, never a claim of layer-only capture. */
export interface RelightSource {
  documentId:number;layerIds:number[];sessionId:string;historyId:number;sourceHash:string;snapshotId:string;
  docWidth:number;docHeight:number;bounds:Bounds;profile:string;documentMode:string;documentDepth:8|16;maskRef:string;
}
export interface RelightLight {
  id:string;name:string;type:'point'|'spot'|'directional';role:'key'|'fill'|'rim'|'custom';enabled:boolean;positionLocked:boolean;
  x:number;y:number;z:number;targetX:number;targetY:number;direction:number;elevation:number;
  intensity:number;range:number;softness:number;cone:number;color:RelightColor;scope:'edit-mask';
}
export interface RelightAmbient {intensity:number;color:string}
export interface RelightShadow {strength:number;softness:number}
export interface RelightScene {
  schemaVersion:1;parameterVersion:1;source:RelightSource;lights:RelightLight[];ambient:RelightAmbient;
  existingLighting:'preserve'|'reshape';shadow:RelightShadow;preserveContent:'strict'|'balanced';supplement:string;
}
/** Content bounds are in document coordinates; modelContentRect is inside the padded model canvas. */
export interface RelightGeometry {bounds:Bounds;modelWidth:number;modelHeight:number;modelContentRect:Bounds}
/** Explicit CSS/client pixels. fitScale is CSS pixels per processing-region pixel at zoom=1. */
export interface RelightViewport {clientRect:{left:number;top:number;width:number;height:number};fitScale:number;zoom:number;panX:number;panY:number}
export interface RelightCapabilities {provider:string;model:string;edit:boolean;maxInputImages:number;maskMode:'none'|'guide'|'native';seed:boolean}
export interface RelightCompilation {prompt:string;warnings:string[];control:'semantic';enabledLightIds:string[]}
export type RelightLightPatch=Partial<Omit<RelightLight,'id'>>;
export interface RelightScenePatch {
  ambient?:Partial<RelightAmbient>;existingLighting?:RelightScene['existingLighting'];shadow?:Partial<RelightShadow>;
  preserveContent?:RelightScene['preserveContent'];supplement?:string;
}

export const RELIGHT_LIMITS=Object.freeze({maxLights:8,maxHistory:100,maxName:80,maxSupplement:8000,maxSourceLayers:4096,
  position:Object.freeze({min:-1,max:2}),depth:Object.freeze({min:-1,max:1}),intensity:Object.freeze({min:0,max:4}),
  range:Object.freeze({min:.05,max:3}),softness:Object.freeze({min:0,max:1}),cone:Object.freeze({min:5,max:160}),
  direction:Object.freeze({min:-180,max:180}),elevation:Object.freeze({min:-90,max:90}),temperature:Object.freeze({min:2000,max:12000})});
const lightKeys=['id','name','type','role','enabled','positionLocked','x','y','z','targetX','targetY','direction','elevation','intensity','range','softness','cone','color','scope'];
const sceneKeys=['schemaVersion','parameterVersion','source','lights','ambient','existingLighting','shadow','preserveContent','supplement'];
function object(value:unknown,keys:readonly string[],label:string,partial=false):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error(`Invalid ${label} object`);
  const names=Object.getOwnPropertyNames(value);
  if(Object.getOwnPropertySymbols(value).length||names.some(key=>!keys.includes(key))||(!partial&&keys.some(key=>!names.includes(key))))throw new Error(`Unknown, missing or unsupported ${label} field`);
  if(names.some(key=>!('value' in Object.getOwnPropertyDescriptor(value,key)!)))throw new Error(`Invalid ${label} accessor`);
  return value as Record<string,unknown>;
}
function number(value:unknown,min:number,max:number,label:string,integer=false):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isSafeInteger(value)))throw new Error(`Invalid ${label}: expected ${min} to ${max}`);
  return value===0?0:value;
}
function text(value:unknown,max:number,label:string,empty=false):string {
  if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||value.includes('\0'))throw new Error(`Invalid ${label} text (maximum ${max})`);
  return value;
}
function id(value:unknown):string {
  if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(value))throw new Error('Invalid light ID');return value;
}
function choice<T extends string>(value:unknown,allowed:readonly T[],label:string):T {
  if(!allowed.includes(value as T))throw new Error(`Unsupported ${label}`);return value as T;
}
function boolean(value:unknown,label:string):boolean {if(typeof value!=='boolean')throw new Error(`Invalid ${label}`);return value;}
function hex(value:unknown):string {if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new Error('Invalid #RRGGBB color');return value.toUpperCase();}
function bounds(value:unknown,label:string):Bounds {
  const b=object(value,['left','top','right','bottom'],label),left=number(b.left,0,300000,`${label} left`),top=number(b.top,0,300000,`${label} top`);
  const right=number(b.right,0,300000,`${label} right`),bottom=number(b.bottom,0,300000,`${label} bottom`);
  if(right<=left||bottom<=top)throw new Error(`Invalid ${label} dimensions`);return {left,top,right,bottom};
}
function source(value:unknown):RelightSource {
  const v=object(value,['documentId','layerIds','sessionId','historyId','sourceHash','snapshotId','docWidth','docHeight','bounds','profile','documentMode','documentDepth','maskRef'],'source');
  const docWidth=number(v.docWidth,1,300000,'document width',true),docHeight=number(v.docHeight,1,300000,'document height',true),b=bounds(v.bounds,'source bounds');
  if(b.right>docWidth||b.bottom>docHeight||Object.values(b).some(v=>!Number.isInteger(v))||(b.right-b.left)*(b.bottom-b.top)>IMAGE_BUDGETS.documentPixels)throw new Error('Invalid source bounds: recapture a valid region inside the document');
  if(!Array.isArray(v.layerIds)||!v.layerIds.length||v.layerIds.length>RELIGHT_LIMITS.maxSourceLayers)throw new Error('Invalid visible-composite source layer IDs');
  const layerIds=Array.from(v.layerIds,v=>number(v,1,Number.MAX_SAFE_INTEGER,'source layer ID',true));
  if(new Set(layerIds).size!==layerIds.length)throw new Error('Duplicate source layer IDs');
  const documentDepth=v.documentDepth;if(documentDepth!==8&&documentDepth!==16)throw new Error('Source document depth must be 8 or 16');
  return {documentId:number(v.documentId,1,Number.MAX_SAFE_INTEGER,'source document ID',true),layerIds,
    sessionId:text(v.sessionId,128,'source session'),historyId:number(v.historyId,0,Number.MAX_SAFE_INTEGER,'source history ID',true),
    sourceHash:text(v.sourceHash,256,'source hash'),snapshotId:text(v.snapshotId,128,'source snapshot'),docWidth,docHeight,bounds:b,
    profile:text(v.profile,256,'source profile'),documentMode:text(v.documentMode,64,'source mode'),documentDepth,maskRef:text(v.maskRef,256,'source mask reference')};
}
function color(value:unknown):RelightColor {
  const mode=object(value,['mode','kelvin','hex'],'light color',true).mode;
  if(mode==='temperature'){const c=object(value,['mode','kelvin'],'temperature color');return {mode,kelvin:number(c.kelvin,2000,12000,'color temperature')};}
  if(mode==='custom'){const c=object(value,['mode','hex'],'custom color');return {mode,hex:hex(c.hex)};}
  throw new Error('Unsupported light color mode');
}
function light(value:unknown):RelightLight {
  const v=object(value,lightKeys,'light');
  return {id:id(v.id),name:text(v.name,80,'light name'),type:choice(v.type,['point','spot','directional'],'light type'),role:choice(v.role,['key','fill','rim','custom'],'light role'),
    enabled:boolean(v.enabled,'light enabled'),positionLocked:boolean(v.positionLocked,'position lock'),x:number(v.x,-1,2,'light x'),y:number(v.y,-1,2,'light y'),z:number(v.z,-1,1,'relative depth'),
    targetX:number(v.targetX,-1,2,'spot target x'),targetY:number(v.targetY,-1,2,'spot target y'),direction:number(v.direction,-180,180,'direction'),elevation:number(v.elevation,-90,90,'elevation'),
    intensity:number(v.intensity,0,4,'relative intensity'),range:number(v.range,.05,3,'range'),softness:number(v.softness,0,1,'softness'),cone:number(v.cone,5,160,'cone'),color:color(v.color),scope:choice(v.scope,['edit-mask'],'light scope')};
}
function defaultLight(lightId:string):RelightLight {
  return {id:id(lightId),name:'Key light',type:'point',role:'key',enabled:true,positionLocked:false,x:.25,y:.25,z:.5,targetX:.5,targetY:.5,
    direction:45,elevation:45,intensity:1,range:.75,softness:.7,cone:60,color:{mode:'temperature',kelvin:5600},scope:'edit-mask'};
}
export function createRelightScene(binding:RelightSource,lightId:string):RelightScene {
  return validateRelightScene({schemaVersion:1,parameterVersion:1,source:binding,lights:[defaultLight(lightId)],ambient:{intensity:.15,color:'#FFFFFF'},
    existingLighting:'reshape',shadow:{strength:.5,softness:.6},preserveContent:'strict',supplement:''});
}
export function validateRelightScene(value:unknown):RelightScene {
  const v=object(value,sceneKeys,'scene');
  if(v.schemaVersion!==1||v.parameterVersion!==1)throw new Error('Unsupported relight schema or parameter version; use a compatible build');
  if(!Array.isArray(v.lights)||v.lights.length>8)throw new Error('Relight scene supports zero to eight lights');
  const lights=Array.from(v.lights,light);if(new Set(lights.map(l=>l.id)).size!==lights.length)throw new Error('Duplicate light IDs');
  const a=object(v.ambient,['intensity','color'],'ambient'),s=object(v.shadow,['strength','softness'],'shadow');
  return {schemaVersion:1,parameterVersion:1,source:source(v.source),lights,ambient:{intensity:number(a.intensity,0,4,'ambient intensity'),color:hex(a.color)},
    existingLighting:choice(v.existingLighting,['preserve','reshape'],'existing lighting intent'),shadow:{strength:number(s.strength,0,1,'shadow strength'),softness:number(s.softness,0,1,'shadow softness')},
    preserveContent:choice(v.preserveContent,['strict','balanced'],'content preservation'),supplement:text(v.supplement,8000,'supplement',true)};
}
/** Exactly the settings the semantic compiler consumes; editor-only fields are deliberately absent. */
function lightIntent(l:RelightLight):Record<string,unknown> {
  return {type:l.type,role:l.role,intensity:l.intensity,color:l.color,softness:l.softness,scope:l.scope,
    ...(l.type==='directional'?{direction:l.direction,elevation:l.elevation}:{x:l.x,y:l.y,z:l.z,range:l.range}),
    ...(l.type==='spot'?{targetX:l.targetX,targetY:l.targetY,cone:l.cone}:{})};
}
export function sceneFingerprint(scene:RelightScene):string {
  const s=validateRelightScene(scene),canonical=JSON.stringify({schemaVersion:s.schemaVersion,parameterVersion:s.parameterVersion,source:s.source,
    lights:s.lights.filter(l=>l.enabled).map(lightIntent),ambient:s.ambient,existingLighting:s.existingLighting,shadow:s.shadow,preserveContent:s.preserveContent,supplement:s.supplement});
  // Explicit UTF-16LE avoids relying on a host TextEncoder. This hashes scene intent,
  // not pixels; the existing sourceHash may still be the capture's legacy FNV value.
  const bytes=new Uint8Array(canonical.length*2);for(let i=0;i<canonical.length;i++){const c=canonical.charCodeAt(i);bytes[i*2]=c&255;bytes[i*2+1]=c>>>8;}
  return `relight-v1:sha256:${Array.from(sha256(bytes),v=>v.toString(16).padStart(2,'0')).join('')}`;
}

export class RelightEditor {
  private scene:RelightScene;private selected:string|null;private past:RelightScene[]=[];private future:RelightScene[]=[];
  private gesture?:{scene:RelightScene;selected:string|null};
  constructor(scene:RelightScene){this.scene=validateRelightScene(scene);this.selected=this.scene.lights[0]?.id??null;}
  get selectedId():string|null{return this.selected;}
  get canUndo():boolean{return this.past.length>0;}
  get canRedo():boolean{return this.future.length>0;}
  snapshot():RelightScene{return validateRelightScene(this.scene);}
  select(lightId:string|null):void {if(lightId!==null)this.find(lightId);this.selected=lightId;}
  private find(lightId:string):RelightLight {const l=this.scene.lights.find(l=>l.id===lightId);if(!l)throw new Error('Unknown relight light ID');return l;}
  private remember(before:RelightScene):void {this.past.push(before);if(this.past.length>100)this.past.shift();this.future=[];}
  private commit(next:RelightScene):void {
    const checked=validateRelightScene(next);if(JSON.stringify(checked)===JSON.stringify(this.scene))return;
    if(!this.gesture)this.remember(this.scene);this.scene=checked;
  }
  add(lightId:string):RelightLight {
    const l=defaultLight(lightId);this.commit({...this.scene,lights:[...this.scene.lights,l]});this.selected=l.id;return light(l);
  }
  duplicate(lightId:string,newId:string):RelightLight {
    const copy={...this.find(lightId),id:id(newId)};this.commit({...this.scene,lights:[...this.scene.lights,copy]});this.selected=copy.id;return light(copy);
  }
  remove(lightId:string):void {
    const index=this.scene.lights.indexOf(this.find(lightId));this.commit({...this.scene,lights:this.scene.lights.filter(l=>l.id!==lightId)});
    if(this.selected===lightId)this.selected=this.scene.lights[Math.min(index,this.scene.lights.length-1)]?.id??null;
  }
  updateLight(lightId:string,patch:RelightLightPatch):void {
    const p=object(patch,lightKeys.filter(k=>k!=='id'),'light patch',true),l=this.find(lightId);
    if(l.positionLocked&&p.positionLocked!==false&&['x','y','z'].some(k=>k in p&&p[k]!==l[k as 'x'|'y'|'z']))throw new Error('Light position is locked; unlock it before moving');
    this.commit({...this.scene,lights:this.scene.lights.map(item=>item.id===lightId?{...item,...p}:item)});
  }
  updateScene(patch:RelightScenePatch):void {
    const p=object(patch,['ambient','existingLighting','shadow','preserveContent','supplement'],'scene patch (source is immutable)',true);
    if(p.ambient!==undefined)object(p.ambient,['intensity','color'],'ambient patch',true);
    if(p.shadow!==undefined)object(p.shadow,['strength','softness'],'shadow patch',true);
    this.commit({...this.scene,...p,ambient:{...this.scene.ambient,...patch.ambient},shadow:{...this.scene.shadow,...patch.shadow}} as RelightScene);
  }
  beginGesture():void {if(this.gesture)throw new Error('A relight gesture is already active');this.gesture={scene:this.snapshot(),selected:this.selected};}
  endGesture():void {
    if(!this.gesture)return;const before=this.gesture.scene;this.gesture=undefined;
    if(JSON.stringify(before)!==JSON.stringify(this.scene))this.remember(before);
  }
  cancelGesture():void {if(this.gesture){this.scene=this.gesture.scene;this.selected=this.gesture.selected;this.gesture=undefined;}}
  private checkHistory():void {if(this.gesture)throw new Error('End or cancel the active relight gesture before undo/redo');}
  private reconcileSelection():void {if(this.selected!==null&&!this.scene.lights.some(l=>l.id===this.selected))this.selected=this.scene.lights[0]?.id??null;}
  undo():void {this.checkHistory();const previous=this.past.pop();if(previous){this.future.push(this.scene);this.scene=previous;this.reconcileSelection();}}
  redo():void {this.checkHistory();const next=this.future.pop();if(next){this.past.push(this.scene);this.scene=next;this.reconcileSelection();}}
}

function validGeometry(g:RelightGeometry):{width:number;height:number} {
  const b=bounds(g?.bounds,'document bounds'),content=bounds(g?.modelContentRect,'model content rect');
  number(g.modelWidth,1,300000,'model width',true);number(g.modelHeight,1,300000,'model height',true);
  if(g.modelWidth*g.modelHeight>16_000_000||content.right>g.modelWidth||content.bottom>g.modelHeight)throw new Error('Invalid model geometry: content must fit inside canvas');
  return {width:b.right-b.left,height:b.bottom-b.top};
}
function point(p:RelightPoint):void {if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))throw new Error('Invalid finite coordinate');}
function view(v:RelightViewport):void {
  if(!v?.clientRect)throw new Error('Invalid viewport client rect');const r=v.clientRect;
  for(const n of [r.left,r.top,v.panX,v.panY])if(!Number.isFinite(n))throw new Error('Invalid finite viewport coordinate');
  for(const n of [r.width,r.height,v.fitScale,v.zoom])if(!Number.isFinite(n)||n<=0)throw new Error('Invalid positive viewport size or scale');
}
function viewportScale(v:RelightViewport,width:number,height:number):number {
  view(v);const scale=v.fitScale*v.zoom;
  if(!Number.isFinite(width*scale)||!Number.isFinite(height*scale)||width*scale<=0||height*scale<=0)throw new Error('Invalid combined viewport scale');
  return scale;
}
export function normalizedToDocument(p:RelightPoint,g:RelightGeometry):RelightPoint {
  const {width,height}=validGeometry(g);point(p);return {x:g.bounds.left+p.x*width,y:g.bounds.top+p.y*height};
}
export function documentToNormalized(p:RelightPoint,g:RelightGeometry):RelightPoint {
  const {width,height}=validGeometry(g);point(p);return {x:(p.x-g.bounds.left)/width,y:(p.y-g.bounds.top)/height};
}
export function normalizedToModel(p:RelightPoint,g:RelightGeometry):RelightPoint {
  validGeometry(g);point(p);const b=g.modelContentRect;return {x:b.left+p.x*(b.right-b.left),y:b.top+p.y*(b.bottom-b.top)};
}
export function modelToNormalized(p:RelightPoint,g:RelightGeometry):RelightPoint {
  validGeometry(g);point(p);const b=g.modelContentRect;return {x:(p.x-b.left)/(b.right-b.left),y:(p.y-b.top)/(b.bottom-b.top)};
}
export function normalizedToViewport(p:RelightPoint,g:RelightGeometry,v:RelightViewport):RelightPoint {
  const {width,height}=validGeometry(g);point(p);const scale=viewportScale(v,width,height),r=v.clientRect;
  const result={x:r.left+r.width/2+v.panX+(p.x-.5)*width*scale,y:r.top+r.height/2+v.panY+(p.y-.5)*height*scale};point(result);return result;
}
export function viewportToNormalized(p:RelightPoint,g:RelightGeometry,v:RelightViewport):RelightPoint {
  const {width,height}=validGeometry(g);point(p);const scale=viewportScale(v,width,height),r=v.clientRect;
  const result={x:.5+(p.x-r.left-r.width/2-v.panX)/(width*scale),y:.5+(p.y-r.top-r.height/2-v.panY)/(height*scale)};point(result);return result;
}
export function viewportLightIndicator(p:RelightPoint,g:RelightGeometry,v:RelightViewport,inset=12):{point:RelightPoint;onScreen:boolean;indicator:RelightPoint} {
  const position=normalizedToViewport(p,g,v),r=v.clientRect;number(inset,0,Math.min(r.width,r.height)/2,'indicator inset');
  const left=r.left+inset,right=r.left+r.width-inset,top=r.top+inset,bottom=r.top+r.height-inset;
  return {point:position,onScreen:position.x>=left&&position.x<=right&&position.y>=top&&position.y<=bottom,
    indicator:{x:Math.max(left,Math.min(right,position.x)),y:Math.max(top,Math.min(bottom,position.y))}};
}

function capabilities(value:RelightCapabilities):RelightCapabilities {
  if(!value||typeof value!=='object')throw new Error('Missing relight model capabilities');
  // Pick public capability fields. Never copy arbitrary server fields or credentials.
  return {provider:text(value.provider,100,'provider'),model:text(value.model,128,'model'),edit:boolean(value.edit,'edit support'),
    maxInputImages:number(value.maxInputImages,0,10,'maximum input images',true),maskMode:choice(value.maskMode,['none','guide','native'],'mask mode'),seed:boolean(value.seed,'seed support')};
}
const n=(value:number)=>String(value);
const lightColor=(c:RelightColor)=>c.mode==='temperature'?`${n(c.kelvin)} K`:`color ${c.hex}`;
function colorWords(c:RelightColor):string {
  if(c.mode==='temperature')return c.kelvin<=3500?'warm amber':c.kelvin<5000?'warm white':c.kelvin<=6500?'neutral white':'cool blue';
  const [r,g,b]=[1,3,5].map(start=>parseInt(c.hex.slice(start,start+2),16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
  if(max===0)return 'unlit';
  if(delta/max<.12)return max>=.85?'neutral white':max>=.35?'neutral gray':'dim neutral gray';
  const hue=(((max===r?(g-b)/delta:max===g?(b-r)/delta+2:(r-g)/delta+4)*60)%360+360)%360;
  return hue<15||hue>=345?'warm red':hue<50?'warm amber':hue<75?'warm yellow':hue<165?'green':hue<195?'cyan':hue<255?'cool blue':hue<285?'violet':'magenta';
}
function positionWords(x:number,y:number):string {
  const horizontal=x<1/3?'left':x>2/3?'right':'center',vertical=y<1/3?'upper':y>2/3?'lower':'';
  const location=horizontal==='center'?(vertical?`${vertical} center`:'center'):(vertical?`${vertical} ${horizontal}`:horizontal);
  return `${x<0||x>1||y<0||y>1?'off-image ':''}${location}`;
}
const softnessWords=(value:number)=>value>=.6?'soft':value<=.25?'hard':'moderately soft';
const strengthWords=(value:number)=>value===0?'zero-strength':value<=.15?'very weak':value<=.5?'weak':value<=1.25?'moderate':value<=2.5?'strong':'very strong';
function compileLight(l:RelightLight):string {
  const side=l.type==='directional'?positionWords(.5+.5*Math.cos(l.direction*Math.PI/180),.5+.5*Math.sin(l.direction*Math.PI/180)):positionWords(l.x,l.y);
  const opening=`Use a ${strengthWords(l.intensity)}, ${softnessWords(l.softness)} ${colorWords(l.color)} ${l.role} light from the ${side}`;
  const details=[l.type,`relative intensity ${n(l.intensity)}`,lightColor(l.color),`softness ${n(l.softness)}`];
  if(l.type==='directional'){
    details.push(`direction ${n(l.direction)} degrees`,`elevation ${n(l.elevation)} degrees`);
    return `${opening} with parallel rays (${details.join('; ')}).`;
  }
  const depth=l.z===0?'near the image plane':`${Math.abs(l.z)<=.5?'slightly':'farther'} ${l.z>0?'in front':'behind'}`;
  details.push(`x=${n(l.x)} y=${n(l.y)} z=${n(l.z)}`,`${l.range<.4?'localized':l.range<=1?'medium':'broad'} spread, range ${n(l.range)} of the short edge`);
  const target=l.type==='spot'?`, with a ${l.cone<=45?'narrow':l.cone<=90?'focused':'wide'} beam aimed toward the ${positionWords(l.targetX,l.targetY)}`:'';
  if(l.type==='spot')details.push(`target x=${n(l.targetX)} y=${n(l.targetY)}`,`full cone ${n(l.cone)} degrees`);
  return `${opening}, ${depth}${target} (${details.join('; ')}).`;
}
export function compileRelightScene(scene:RelightScene,model:RelightCapabilities):RelightCompilation {
  const s=validateRelightScene(scene),caps=capabilities(model);if(!caps.edit)throw new Error('Selected model does not support image editing; choose an edit-capable model');
  if(caps.maxInputImages<1)throw new Error('Relighting requires a clean source image; choose a model with image input support');
  const enabled=s.lights.filter(l=>l.enabled),warnings=[`Lighting uses semantic control for ${caps.provider} / ${caps.model}; exact per-light control and pixel preservation are not guaranteed.`];
  const lines=[s.existingLighting==='preserve'?'Relight the original image by adding illumination while preserving its existing lighting.':'Relight the original image with a new lighting arrangement.'];
  if(enabled.length)lines.push(...enabled.map(compileLight));else lines.push('Use ambient-only lighting, without individual lights.');
  const ambientStrength=s.ambient.intensity===0?'no':s.ambient.intensity<=.15?'dim':s.ambient.intensity<=.5?'subdued':s.ambient.intensity<=1?'moderate':'bright';
  const shadowStrength=s.shadow.strength<=.3?'subtle':s.shadow.strength<=.7?'visible':'strong';
  lines.push(`Use ${ambientStrength} ${colorWords({mode:'custom',hex:s.ambient.color})} ambient light (relative intensity ${n(s.ambient.intensity)}; color ${s.ambient.color}).`,
    `${s.shadow.strength===0?'Avoid shadows':`Keep ${shadowStrength} directional shading and ${softnessWords(s.shadow.softness)} shadows`} (strength ${n(s.shadow.strength)}; softness ${n(s.shadow.softness)}).`,
    'Limit lighting changes to the existing edit mask; leave unselected content unchanged.',
    `${s.preserveContent==='strict'?'Strictly preserve':'Prioritize preserving'} composition, subject identity, pose, geometry, text and logos, garment patterns and material texture. Change only lighting, highlights and shadows; do not add or remove objects.`);
  if(s.supplement){
    const supplement=s.supplement.toLowerCase();
    if(s.shadow.strength>0&&(/\bno\s+shadows?\b|\bwithout\s+shadows?\b|无阴影|不要阴影/.test(supplement)))warnings.push('The supplement requests no shadows, but structured shadow strength is above zero. Resolve this conflict before generating.');
    const leftOnly=/\bleft[ -]only\b|\bonly\s+(?:from\s+)?(?:the\s+)?left\b|仅左侧|只从左/.test(supplement);
    const rightOnly=/\bright[ -]only\b|\bonly\s+(?:from\s+)?(?:the\s+)?right\b|仅右侧|只从右/.test(supplement);
    const oppositeKey=enabled.some(l=>{
      if(l.role!=='key')return false;
      const side=l.type==='directional'?Math.cos(l.direction*Math.PI/180):l.x-.5;
      return (leftOnly&&side>1e-8)||(rightOnly&&side<-1e-8);
    });
    if(oppositeKey)warnings.push('The supplement requests lighting from one side only, but an enabled key light is on the opposite left/right side. Resolve this conflict before generating.');
    if(enabled.some(l=>l.intensity>0)&&/\ball\s+lights?\s+(?:off|disabled)\b|\bturn\s+off\s+all\s+lights?\b|关闭所有灯|关闭全部光源/.test(supplement))warnings.push('The supplement requests all lights off, but active structured lights have positive intensity. Resolve this conflict before generating.');
    warnings.push('Supplement conflict checks cover only a few obvious phrases; review other contradictory instructions manually. The supplement is preserved unchanged.');
    lines.push('Additional instructions:',s.supplement);
  }
  if(caps.maskMode==='guide'&&caps.maxInputImages<2)warnings.push('Only the clean source image fits this model input limit; a separate visual mask guide must not replace the source. Final scope remains the saved edit mask.');
  return {prompt:lines.join('\n'),warnings,control:'semantic',enabledLightIds:enabled.map(l=>l.id)};
}
