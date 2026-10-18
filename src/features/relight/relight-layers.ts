import {resize,rasterMax,type Bounds,type Raster} from '../../imaging/image';
import {IMAGE_BUDGETS,planRelightMemory} from '../../imaging/budget';
import {validateRelightScene,sceneFingerprint,type RelightScene,type RelightLight,type RelightSource} from './relight-scene';

export type RelightChannelKind='shadow'|'cast-shadow'|'color-atmosphere'|'light'|'rim-light';
export interface RelightFieldChannel {
  kind:RelightChannelKind;blendMode:'multiply'|'color'|'screen';
  /** Multiply: 1-amount. Screen: amount. Color: amount is alpha, never a neutral RGB. */
  amount:Float32Array;color?:Float32Array;energy:number;
}
export interface RelightLayerFields {
  version:'relight-fields-v1';width:number;height:number;source:RelightSource;sceneFingerprint:string;
  guide:Float32Array;channels:RelightFieldChannel[];
  summary:{structureConfidence:number;rejectedFraction:number;clippedFraction:number;warnings:string[];channels:Record<RelightChannelKind,'present'|'not-observed'|'no-rim-light'|'no-reliable-receiver'>};
}
export interface RelightLayersOptions {signal?:AbortSignal;yieldControl?:()=>Promise<void>;editMask?:Uint8Array}
const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,v));
function check(signal?:AbortSignal):void {if(signal?.aborted){const error=new Error('光影层处理已取消');error.name='AbortError';throw error;}}
function raster(image:Raster):void {
  if(!image||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||image.width*image.height>16_000_000||!(image.rgba instanceof Uint8Array||image.rgba instanceof Uint16Array)||image.rgba.length!==image.width*image.height*4)throw new Error('光影参考图尺寸或 RGBA 数据无效');
}
const luminance=(r:number,g:number,b:number)=>r*.2126+g*.7152+b*.0722;
async function blur(values:Float32Array,width:number,height:number,radius:number,pause:()=>Promise<void>):Promise<Float32Array> {
  const tmp=new Float32Array(values.length),out=new Float32Array(values.length),r=Math.max(1,Math.round(radius));
  for(let y=0;y<height;y++){
    if(y%32===0)await pause();let sum=0;for(let x=-r;x<=r;x++)sum+=values[y*width+clamp(x,0,width-1)];
    for(let x=0;x<width;x++){tmp[y*width+x]=sum/(2*r+1);sum+=values[y*width+Math.min(width-1,x+r+1)]-values[y*width+Math.max(0,x-r)];}
  }
  for(let x=0;x<width;x++){
    if(x%64===0)await pause();let sum=0;for(let y=-r;y<=r;y++)sum+=tmp[clamp(y,0,height-1)*width+x];
    for(let y=0;y<height;y++){out[y*width+x]=sum/(2*r+1);sum+=tmp[Math.min(height-1,y+r+1)*width+x]-tmp[Math.max(0,y-r)*width+x];}
  }
  return out;
}
function lightWeight(light:RelightLight,x:number,y:number):number {
  if(!light.enabled||light.intensity===0)return 0;
  if(light.type==='directional'){const a=light.direction*Math.PI/180;return clamp(.55+((x-.5)*Math.cos(a)+(y-.5)*Math.sin(a))*.7,.1,1)*Math.min(1,light.intensity);}
  const dx=x-light.x,dy=y-light.y,distance=Math.hypot(dx,dy,light.z*.2),radius=light.range;
  let value=clamp(1-distance/radius);value=value*value*(3-2*value)*Math.min(1,light.intensity);
  if(light.type==='spot'){
    const tx=light.targetX-light.x,ty=light.targetY-light.y,length=Math.hypot(tx,ty)*Math.hypot(dx,dy);
    const angle=length?Math.acos(clamp((dx*tx+dy*ty)/length,-1,1)):0,outer=light.cone*Math.PI/360;
    value*=clamp((outer-angle)/(outer*Math.max(.1,light.softness)));
  }
  return value;
}
function upstream(light:RelightLight,x:number,y:number):[number,number] {
  if(light.type==='directional'){const a=light.direction*Math.PI/180;return [Math.cos(a),Math.sin(a)];}
  const dx=light.x-x,dy=light.y-y,length=Math.hypot(dx,dy);return length?[dx/length,dy/length]:[0,0];
}
function isSrgb(profile:string):boolean{return /^sRGB(?: IEC61966-2\.1)?$/i.test(profile.trim());}
const structureFailure=()=>new Error('AI 参考的结构、文字或纹理与原图不一致，保细节照明提取已停止；请检查原始输出或明确选择整图重绘');

/**
 * Confidence at an edge is insufficient: the flat interior of a newly drawn
 * letter/object has no high-pass energy and would become reliable again.
 * Trace connected boundaries of the per-channel illumination ratio instead.
 * A localized unsupported boundary rejects the entire reference before any
 * blur/chroma estimate can carry its interior or halo into an influence field.
 * Broad smooth illumination has no such boundary. A hard boundary is accepted
 * only as a straight frame-spanning transition, or an observed cast/highlight edge
 * anchored coherently to existing source geometry and the submitted light.
 */
async function assertSupportedBoundaries(base:Raster,target:Raster,scene:RelightScene,confidence:Float32Array,sourceGuide:Float32Array,targetGuide:Float32Array,pause:()=>Promise<void>):Promise<void> {
  const {width,height}=base,n=width*height,max=rasterMax(base),targetMax=rasterMax(target),ratio=new Float32Array(n*3),boundary=new Uint8Array(n),chroma=new Uint8Array(n);
  const opaque=(p:number)=>base.rgba[p*4+3]===max&&target.rgba[p*4+3]>=targetMax*.98;
  for(let y=0;y<height;y++){if(y%32===0)await pause();for(let x=0;x<width;x++){
    const p=y*width+x;for(let c=0;c<3;c++)ratio[p*3+c]=Math.log(Math.max(.03,target.rgba[p*4+c]/targetMax))-Math.log(Math.max(.03,base.rgba[p*4+c]/max));
  }}
  for(let y=0;y<height;y++){if(y%32===0)await pause();for(let x=0;x<width;x++){
    const p=y*width+x;if(!opaque(p))continue;
    for(const q of [x+1<width?p+1:-1,y+1<height?p+width:-1]){
      if(q<0||!opaque(q))continue;
      const r=ratio[p*3]-ratio[q*3],g=ratio[p*3+1]-ratio[q*3+1],b=ratio[p*3+2]-ratio[q*3+2],jump=Math.max(Math.abs(r),Math.abs(g),Math.abs(b)),spread=Math.max(r,g,b)-Math.min(r,g,b);
      if(jump<.08&&spread<.04&&!(jump>=.025&&(confidence[p]<.35||confidence[q]<.35)))continue;
      boundary[p]=boundary[q]=1;const color=Math.min(255,Math.round(spread*255));chroma[p]=Math.max(chroma[p],color);chroma[q]=Math.max(chroma[q],color);
    }
  }}
  const visited=new Uint8Array(n),queue=new Int32Array(n),lights=scene.lights.filter(l=>l.enabled&&l.intensity>0),meanRatio=(p:number)=>(ratio[p*3]+ratio[p*3+1]+ratio[p*3+2])/3;
  for(let start=0;start<n;start++){
    if(!boundary[start]||visited[start])continue;await pause();let head=0,tail=1,minX=width,minY=height,maxX=0,maxY=0,sx=0,sy=0,sxx=0,syy=0,sxy=0,colorJump=0;queue[0]=start;visited[start]=1;
    const anchors=lights.map(()=>({count:0,normal:0,falling:0,rising:0}));
    while(head<tail){
      if(head%4096===0)await pause();const p=queue[head++],x=p%width,y=Math.floor(p/width);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;colorJump=Math.max(colorJump,chroma[p]/255);
      const left=y*width+Math.max(0,x-1),right=y*width+Math.min(width-1,x+1),up=Math.max(0,y-1)*width+x,down=Math.min(height-1,y+1)*width+x,gx=sourceGuide[right]-sourceGuide[left],gy=sourceGuide[down]-sourceGuide[up],tx=targetGuide[right]-targetGuide[left],ty=targetGuide[down]-targetGuide[up],magnitude=Math.hypot(gx,gy),targetMagnitude=Math.hypot(tx,ty);
      if(magnitude>.08&&targetMagnitude>.02&&(gx*tx+gy*ty)/(magnitude*targetMagnitude)>.65)for(let i=0;i<lights.length;i++){
        const [dx,dy]=upstream(lights[i],(x+.5)/width,(y+.5)/height),normal=(gx*dx+gy*dy)/magnitude;if(Math.abs(normal)<.65)continue;
        const toward=clamp(Math.round(y+dy*2),0,height-1)*width+clamp(Math.round(x+dx*2),0,width-1),away=clamp(Math.round(y-dy*2),0,height-1)*width+clamp(Math.round(x-dx*2),0,width-1),change=meanRatio(away)-meanRatio(toward);if(Math.abs(change)<.04)continue;
        anchors[i].count++;anchors[i].normal+=normal;if(change<0)anchors[i].falling++;else anchors[i].rising++;
      }
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const qx=x+dx,qy=y+dy;if(qx<0||qx>=width||qy<0||qy>=height)continue;const q=qy*width+qx;if(boundary[q]&&!visited[q]){visited[q]=1;queue[tail++]=q;}
      }
    }
    if(tail<4)continue;
    const cx=sx/tail,cy=sy/tail,vx=sxx/tail-cx*cx,vy=syy/tail-cy*cy,cov=sxy/tail-cx*cy,minor=Math.max(0,(vx+vy-Math.hypot(vx-vy,2*cov))/2),spansFrame=minX===0&&maxX===width-1||minY===0&&maxY===height-1;
    if(spansFrame&&minor<=Math.max(2,Math.min(width,height)*.015)**2)continue;
    const narrow=Math.min(maxX-minX+1,maxY-minY+1)<=Math.max(4,Math.min(width,height)*.09);
    const supported=colorJump<=.12&&anchors.some((a,i)=>a.count>=4&&a.count/tail>=.12&&Math.abs(a.normal)/a.count>=.7&&lightWeight(lights[i],(cx+.5)/width,(cy+.5)/height)>0&&(a.falling/a.count>=.8||narrow&&a.rising/a.count>=.8));
    if(!supported)throw structureFailure();
  }
}

/**
 * One full edit is only a low-resolution illumination reference. Local
 * high-pass correlation rejects structure changes before estimating capped
 * log-luminance and chroma fields. Source-guided smoothing and scene support
 * exclude reference texture; no AI raster is placed in the Photoshop group.
 * Cast shadows are conservative observed receiver lobes, not recovered 3D.
 */
export async function deriveRelightLayers(source:Raster,target:Raster,scene:RelightScene,options:RelightLayersOptions={}):Promise<RelightLayerFields> {
  raster(source);raster(target);const s=validateRelightScene(scene);if(!isSrgb(s.source.profile)||!['rgb','rgbcolor','rgbcolormode'].includes(s.source.documentMode.toLowerCase()))throw new Error('实验光影层目前需要已标记的 sRGB RGB 8/16 位原文档；其他颜色空间可明确选择整图重绘');
  let lastYield=Date.now();
  const pause=async()=>{check(options.signal);if(options.yieldControl)await options.yieldControl();else if(Date.now()-lastYield>=12){await new Promise<void>(resolve=>setTimeout(resolve,0));lastYield=Date.now();}check(options.signal);};check(options.signal);
  const size=planRelightMemory(source.width,source.height,source.rgba instanceof Uint16Array?16:8),base=source.width===size.width&&source.height===size.height?source:resize(source,size.width,size.height),width=base.width,height=base.height,n=width*height;
  if(Math.abs(Math.log((target.width/target.height)/(base.width/base.height)))>.12)throw new Error('光影参考图与来源比例不符，无法安全对齐；原始 AI 输出已保留');
  const result=target.width===width&&target.height===height?target:resize(target,width,height);
  if(options.editMask&&(!(options.editMask instanceof Uint8Array)||options.editMask.length!==n))throw new Error('光影分析蒙版尺寸错误');
  const max=rasterMax(base),targetMax=rasterMax(result),logBase=new Float32Array(n),logTarget=new Float32Array(n),guide=new Float32Array(n);
  let transparent=0;
  for(let y=0;y<height;y++){if(y%32===0)await pause();for(let x=0;x<width;x++){const p=y*width+x,i=p*4,b=luminance(base.rgba[i],base.rgba[i+1],base.rgba[i+2])/max,t=luminance(result.rgba[i],result.rgba[i+1],result.rgba[i+2])/targetMax;guide[p]=b;logBase[p]=Math.log(Math.max(.025,b));logTarget[p]=Math.log(Math.max(.025,t));if(base.rgba[i+3]===max&&result.rgba[i+3]<targetMax*.98)transparent++;}}
  if(transparent/n>.05)throw new Error('AI 光影参考含明显透明或缺失区域；无法提取可靠照明，原始输出已保留');
  const radius=Math.max(2,Math.round(Math.min(width,height)/32)),smallBase=await blur(logBase,width,height,1,pause),smallTarget=await blur(logTarget,width,height,1,pause);
  const es=new Float32Array(n),et=new Float32Array(n),cross=new Float32Array(n);
  for(let p=0;p<n;p++){const a=logBase[p]-smallBase[p],b=logTarget[p]-smallTarget[p];es[p]=a*a;et[p]=b*b;cross[p]=a*b;}
  const sourceEnergy=await blur(es,width,height,2,pause),targetEnergy=await blur(et,width,height,2,pause),correlation=await blur(cross,width,height,2,pause),confidence=new Float32Array(n),edge=new Float32Array(n);
  let rejected=0,confidenceSum=0,visible=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x,a=sourceEnergy[p],b=targetEnergy[p],corr=correlation[p]/Math.sqrt(a*b+1e-10),change=Math.sqrt(Math.max(0,a+b-2*correlation[p]))/(Math.sqrt(a)+Math.sqrt(b)+.025);
    let c=Math.exp(-change*change*9);if(a+b>.003&&corr<.3)c*=clamp((corr+.1)/.4);if(base.rgba[p*4+3]!==max||result.rgba[p*4+3]<targetMax*.98)c=0;
    confidence[p]=c;
    if(base.rgba[p*4+3]>0&&(!options.editMask||options.editMask[p]>0)){visible++;confidenceSum+=c;if(c<.35)rejected++;}
    edge[p]=Math.hypot(smallBase[y*width+Math.min(width-1,x+1)]-smallBase[y*width+Math.max(0,x-1)],smallBase[Math.min(height-1,y+1)*width+x]-smallBase[Math.max(0,y-1)*width+x]);
  }
  const structureConfidence=visible?confidenceSum/visible:0,rejectedFraction=visible?rejected/visible:1;
  if(!visible||rejectedFraction>.55||structureConfidence<.4)throw structureFailure();
  await assertSupportedBoundaries(base,result,s,confidence,smallBase,smallTarget,pause);
  const coarseBase=await blur(logBase,width,height,radius,pause),coarseTarget=await blur(logTarget,width,height,radius,pause),raw=new Float32Array(n);
  let clipped=0;for(let p=0;p<n;p++){const d=coarseTarget[p]-coarseBase[p];if(Math.abs(d)>.7)clipped++;raw[p]=clamp(d,-.7,.55);}
  // A small cross-bilateral stencil in source luminance prevents a broad field
  // crossing stable subject edges. Invalid patches contribute no observations.
  const illumination=new Float32Array(n),step=Math.max(1,Math.floor(radius/2));
  for(let y=0;y<height;y++){if(y%16===0)await pause();for(let x=0;x<width;x++){
    const p=y*width+x;let total=0,sum=0;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const q=clamp(y+dy*step,0,height-1)*width+clamp(x+dx*step,0,width-1),weight=confidence[q]*Math.exp(-Math.abs(coarseBase[q]-coarseBase[p])*8)/(1+dx*dx+dy*dy);
      sum+=raw[q]*weight;total+=weight;
    }
    illumination[p]=(total?sum/total:0)*confidence[p];
  }}
  const amounts={shadow:new Float32Array(n),'cast-shadow':new Float32Array(n),'color-atmosphere':new Float32Array(n),light:new Float32Array(n),'rim-light':new Float32Array(n)},color=new Float32Array(n*3);
  const keys=s.lights.filter(l=>l.enabled&&l.intensity>0&&l.role!=='rim'),rims=s.lights.filter(l=>l.enabled&&l.intensity>0&&l.role==='rim'),enabled=[...keys,...rims];
  let receiverObserved=false;
  for(let y=0;y<height;y++){if(y%16===0)await pause();for(let x=0;x<width;x++){
    const p=y*width+x,nx=(x+.5)/width,ny=(y+.5)/height;if(confidence[p]<.08||options.editMask&&options.editMask[p]===0)continue;
    const b=Math.exp(coarseBase[p]),desired=clamp(b*Math.exp(illumination[p])),positive=illumination[p]>0&&b<1?clamp((desired-b)/(1-b),0,.45):0,negative=illumination[p]<0?clamp(1-Math.exp(illumination[p]),0,.65)*s.shadow.strength:0;
    const key=keys.reduce((v,l)=>Math.max(v,lightWeight(l,nx,ny)),0),rim=rims.reduce((v,l)=>Math.max(v,lightWeight(l,nx,ny)),0),rimSupport=clamp(edge[p]*5),rimShare=clamp(rim*rimSupport/(key+rim*rimSupport+.00001));
    amounts.light[p]=positive*(keys.length?(.2+.8*key):0)*(1-rimShare);amounts['rim-light'][p]=positive*rimShare;
    // A receiver must be locally smooth, downstream of an existing stable
    // source edge, inside the explicit editable scope, and actually darker in
    // the generated reference. No boundary/3D information is invented.
    let projected=0;
    if(negative>.003&&sourceEnergy[p]<.0025)for(const l of enabled){
      const [dx,dy]=upstream(l,nx,ny);
      for(const distance of [2,4,8,12,20]){const r=distance*Math.max(1,Math.min(width,height)/96),qx=Math.round(x+dx*r),qy=Math.round(y+dy*r);if(qx<0||qx>=width||qy<0||qy>=height)continue;const q=qy*width+qx;projected=Math.max(projected,clamp(edge[q]*4)*confidence[q]);}
    }
    const castShare=clamp(projected)*clamp(1-Math.sqrt(sourceEnergy[p])*8);if(castShare>.05)receiverObserved=true;
    const cast=negative*castShare;amounts['cast-shadow'][p]=cast;amounts.shadow[p]=clamp(1-(1-negative)/(1-cast));
  }}
  // Chroma is estimated at the same bounded spatial scale. The Color layer's
  // alpha is zero at neutral; RGB is never treated as a neutral Color value.
  const chromaPlanes:Float32Array[]=[];
  for(let c=0;c<3;c++){
    const delta=new Float32Array(n);for(let p=0;p<n;p++)delta[p]=Math.log(Math.max(.03,result.rgba[p*4+c]/targetMax))-logTarget[p]-(Math.log(Math.max(.03,base.rgba[p*4+c]/max))-logBase[p]);
    chromaPlanes.push(await blur(delta,width,height,radius,pause));
  }
  for(let y=0;y<height;y++){if(y%32===0)await pause();for(let x=0;x<width;x++){
    const p=y*width+x;if(confidence[p]<.08||options.editMask&&options.editMask[p]===0)continue;
    const r=clamp(chromaPlanes[0][p],-.22,.22),g=clamp(chromaPlanes[1][p],-.22,.22),b=clamp(chromaPlanes[2][p],-.22,.22),span=Math.max(r,g,b)-Math.min(r,g,b),alpha=clamp(span*2,0,.45)*confidence[p];
    if(alpha<.002)continue;amounts['color-atmosphere'][p]=alpha;
    color[p*3]=clamp(.5*Math.exp(r*3));color[p*3+1]=clamp(.5*Math.exp(g*3));color[p*3+2]=clamp(.5*Math.exp(b*3));
  }}
  const channels:RelightFieldChannel[]=[],states:RelightLayerFields['summary']['channels']={shadow:'not-observed','cast-shadow':receiverObserved?'not-observed':'no-reliable-receiver','color-atmosphere':'not-observed',light:'not-observed','rim-light':rims.length?'not-observed':'no-rim-light'};
  for(const kind of ['shadow','cast-shadow','color-atmosphere','light','rim-light'] as const){
    let energy=0,peak=0;for(const v of amounts[kind]){energy+=v;peak=Math.max(peak,v);}energy/=n;
    if(peak>=.004&&energy>=.00001){states[kind]='present';channels.push({kind,blendMode:kind==='color-atmosphere'?'color':kind==='shadow'||kind==='cast-shadow'?'multiply':'screen',amount:amounts[kind],...(kind==='color-atmosphere'?{color}:{}),energy});}
  }
  const warnings=['实验影响场使用单张目标图和二维场景约束；投影归属、强原光照、过曝与死黑区域需要目视检查。'];
  if(rejectedFraction>.01)warnings.push(`结构保护排除了 ${(rejectedFraction*100).toFixed(1)}% 的不可靠区域。`);
  if(clipped/n>.01)warnings.push('部分照明超过安全增益范围，已限制强度以保留高光和暗部细节。');
  if(!receiverObserved)warnings.push('没有可靠且获准修改的承影区域，本场景未创建 Cast Shadow。');
  return {version:'relight-fields-v1',width,height,source:s.source,sceneFingerprint:sceneFingerprint(s),guide,channels,summary:{structureConfidence,rejectedFraction,clippedFraction:clipped/n,warnings,channels:states}};
}

export function validateRelightLayerFields(fields:RelightLayerFields):void {
  if(!fields||fields.version!=='relight-fields-v1'||!Number.isSafeInteger(fields.width)||!Number.isSafeInteger(fields.height)||fields.width<1||fields.height<1||fields.width*fields.height>IMAGE_BUDGETS.analysisPixels||!(fields.guide instanceof Float32Array)||fields.guide.length!==fields.width*fields.height||!Array.isArray(fields.channels)||fields.channels.length>5)throw new Error('光影影响场版本、尺寸或预算无效');
  const kinds=new Set<RelightChannelKind>(),order:RelightChannelKind[]=['shadow','cast-shadow','color-atmosphere','light','rim-light'];let previous=-1;
  if(fields.guide.some(v=>!Number.isFinite(v)||v<0||v>1)||!fields.source||typeof fields.sceneFingerprint!=='string'||!fields.sceneFingerprint)throw new Error('光影来源或引导数据无效');
  for(const c of fields.channels){
    const position=order.indexOf(c.kind);
    if(position<0||position<=previous||kinds.has(c.kind)||c.blendMode!==(c.kind==='color-atmosphere'?'color':c.kind==='shadow'||c.kind==='cast-shadow'?'multiply':'screen')||!(c.amount instanceof Float32Array)||c.amount.length!==fields.width*fields.height||c.amount.some(v=>!Number.isFinite(v)||v<0||v>1)||!c.amount.some(v=>v>0)||!Number.isFinite(c.energy)||c.energy<=0||c.kind==='color-atmosphere'&&(!(c.color instanceof Float32Array)||c.color.length!==c.amount.length*3||c.color.some(v=>!Number.isFinite(v)||v<0||v>1)))throw new Error('光影通道数据无效');
    kinds.add(c.kind);previous=position;
  }
}
function sample(values:Float32Array,width:number,height:number,x:number,y:number,components=1,component=0):number {
  const sx=clamp(x,0,width-1),sy=clamp(y,0,height-1),x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0;
  return (values[(y0*width+x0)*components+component]*(1-fx)+values[(y0*width+Math.min(width-1,x0+1))*components+component]*fx)*(1-fy)+(values[(Math.min(height-1,y0+1)*width+x0)*components+component]*(1-fx)+values[(Math.min(height-1,y0+1)*width+Math.min(width-1,x0+1))*components+component]*fx)*fy;
}
/** Generates only one native strip of one channel; neutral pixels are defined explicitly. */
export function renderRelightLayerStrip(fields:RelightLayerFields,channel:RelightFieldChannel,region:Bounds,strip:Bounds,depth:8|16):Raster {
  const width=strip.right-strip.left,height=strip.bottom-strip.top;
  if(width<1||height<1||width*height>IMAGE_BUDGETS.stripPixels||strip.left<region.left||strip.top<region.top||strip.right>region.right||strip.bottom>region.bottom)throw new Error('光影回填条带超出预算或坐标范围');
  const max=depth===16?65535:255,rgba=depth===16?new Uint16Array(width*height*4):new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=(strip.left+x+.5-region.left)*fields.width/(region.right-region.left)-.5,sy=(strip.top+y+.5-region.top)*fields.height/(region.bottom-region.top)-.5,a=clamp(sample(channel.amount,fields.width,fields.height,sx,sy)),p=(y*width+x)*4;
    for(let c=0;c<3;c++)rgba[p+c]=Math.round(max*(channel.blendMode==='multiply'?1-a:channel.blendMode==='screen'?a:sample(channel.color!,fields.width,fields.height,sx,sy,3,c)));
    rgba[p+3]=channel.blendMode==='color'?Math.round(a*max):max;
  }
  return {width,height,rgba};
}
// Nonseparable Color blend: preserve backdrop encoded luminosity and use the
// bounded field hue/chroma, then interpolate by support alpha. Native behavior
// still requires Photoshop acceptance; global blend preferences are untouched.
function colorBlend(base:number[],color:number[]):number[] {
  const lum=(v:number[])=>.3*v[0]+.59*v[1]+.11*v[2],d=lum(base)-lum(color),out=color.map(v=>v+d),l=lum(out),low=Math.min(...out),high=Math.max(...out);
  if(low<0)for(let c=0;c<3;c++)out[c]=l+(out[c]-l)*l/(l-low);
  if(high>1)for(let c=0;c<3;c++)out[c]=l+(out[c]-l)*(1-l)/(high-l);
  return out.map(v=>clamp(v));
}
/** Bounded unmasked local composite. The caller applies the edit mask exactly once. */
export function previewRelightLayers(source:Raster,fields:RelightLayerFields):Raster {
  raster(source);validateRelightLayerFields(fields);const base=source.width===fields.width&&source.height===fields.height?{...source,rgba:source.rgba.slice()}:resize(source,fields.width,fields.height),max=rasterMax(base);
  for(const channel of fields.channels)for(let p=0;p<fields.width*fields.height;p++){
    const a=channel.amount[p];if(!a)continue;
    if(channel.blendMode==='color'){
      const before=[base.rgba[p*4]/max,base.rgba[p*4+1]/max,base.rgba[p*4+2]/max],mixed=colorBlend(before,[channel.color![p*3],channel.color![p*3+1],channel.color![p*3+2]]);
      for(let c=0;c<3;c++)base.rgba[p*4+c]=Math.round(max*(before[c]*(1-a)+mixed[c]*a));
    }else for(let c=0;c<3;c++){const b=base.rgba[p*4+c]/max;base.rgba[p*4+c]=Math.round(max*(channel.blendMode==='multiply'?b*(1-a):1-(1-b)*(1-a)));}
  }
  return base;
}
