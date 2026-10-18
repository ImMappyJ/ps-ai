import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareEditCandidate,retainSourceAlpha,alphaBounds,prepareBackgroundCandidate,backgroundEditMask} from '../src/imaging/composite';
import {Raster} from '../src/imaging/image';
const raster=(values:number[]):Raster=>({width:values.length/4,height:1,rgba:Uint8Array.from(values)});

test('编辑默认保留原透明及半透明轮廓，模型白底不能变成背景',()=>{
  const source=raster([40,50,60,0,80,90,100,128,120,130,140,255]);
  const generated=raster([255,255,255,255,10,20,30,255,60,70,80,255]);
  const result=prepareEditCandidate(generated,source,{preserveAlpha:true,align:false});
  assert.deepEqual([...result.rgba],[0,0,0,0,10,20,30,128,60,70,80,255]);
  assert.equal(generated.rgba[3],255);
});
test('生成图缺失像素保留原色，半透明生成色正确混合，关闭保透明支持改背景',()=>{
  const source=raster([80,90,100,255,100,150,200,255]);
  const generated=raster([0,0,0,0,200,50,100,128]);
  assert.deepEqual([...retainSourceAlpha(generated,source).rgba],[80,90,100,255,150,100,150,255]);
  assert.deepEqual(prepareEditCandidate(generated,source,{preserveAlpha:false,align:false}),generated);
});
test('透明主体缩小或偏移时按原主体坐标对齐，填满原轮廓',()=>{
  const source={width:8,height:8,rgba:new Uint8Array(256)},generated={width:8,height:8,rgba:new Uint8Array(256)};
  for(let y=1;y<7;y++)for(let x=1;x<7;x++)source.rgba.set([30,40,50,255],(y*8+x)*4);
  for(let y=2;y<5;y++)for(let x=2;x<5;x++)generated.rgba.set([100,120,140,255],(y*8+x)*4);
  const result=prepareEditCandidate(generated,source,{preserveAlpha:true,align:true});
  assert.deepEqual(alphaBounds(result),{left:1,top:1,right:7,bottom:7});
  for(let y=1;y<7;y++)for(let x=1;x<7;x++)assert.deepEqual([...result.rgba.slice((y*8+x)*4,(y*8+x)*4+4)],[100,120,140,255]);
});
test('边界匹配从未选中上下文计算，保持选中区域的新颜色关系',()=>{
  const source={width:12,height:12,rgba:new Uint8Array(576)},generated={width:12,height:12,rgba:new Uint8Array(576)},mask=new Uint8Array(144);
  for(let i=0;i<144;i++){source.rgba.set([80,100,120,255],i*4);generated.rgba.set([90,115,125,255],i*4);}
  mask[65]=255;generated.rgba.set([200,40,60,255],65*4);
  const result=prepareEditCandidate(generated,source,{preserveAlpha:true,align:false,matchColor:true,mask});
  assert.deepEqual([...result.rgba.slice(0,4)],[80,100,120,255]);
  assert.deepEqual([...result.rgba.slice(260,264)],[190,25,55,255]);
  mask.fill(255);assert.deepEqual(prepareEditCandidate(generated,source,{preserveAlpha:true,align:false,matchColor:true,mask}),generated);
});
test('无上下文、空主体或尺寸异常不进行危险的自动配准',()=>{
  const source=raster([10,20,30,255]),empty=raster([0,0,0,0]);
  assert.equal(alphaBounds(empty),undefined);
  assert.deepEqual(prepareEditCandidate(empty,source,{preserveAlpha:true,align:true}),source);
  assert.throws(()=>prepareEditCandidate({...empty,rgba:new Uint8Array(0)},source,{preserveAlpha:true,align:true}),/RGBA/);
});

// Compute Photoshop NORMAL source-over of the actual candidate and layer mask.
// Premultiplied colors let alpha=0 be compared without inventing invisible RGB.
function sourceOverPixel(image:Raster,mask:Uint8Array,source:Raster,p:number) {
  const max=image.rgba instanceof Uint16Array?65535:255,sourceMax=source.rgba instanceof Uint16Array?65535:255;
  const q=image.rgba[p*4+3]/max*mask[p]/255,a=source.rgba[p*4+3]/sourceMax;
  return {alpha:q+a*(1-q),premult:[0,1,2].map(c=>image.rgba[p*4+c]*q+source.rgba[p*4+c]/sourceMax*max*a*(1-q))};
}

test('background patch and editable mask fill transparent corners and retain loaded half-alpha subject once',()=>{
  const source=raster([200,100,50,0,200,100,50,128,200,100,50,255,200,100,50,255]);
  const image=raster([20,60,120,255,20,60,120,255,20,60,120,255,20,60,120,255]);
  const subject=new Uint8Array([255,128,255,128]),protection=new Uint8Array([0,0,0,0]);
  const result=prepareBackgroundCandidate(image,source,subject,protection),mask=backgroundEditMask(source,subject,protection);
  assert.deepEqual([...mask],[255,255,0,127]);
  assert.deepEqual([...result.rgba.slice(4,8)],[110,80,85,255]);
  assert.deepEqual(sourceOverPixel(result,mask,source,0),{alpha:1,premult:[20,60,120]});
  assert.deepEqual(sourceOverPixel(result,mask,source,1),{alpha:1,premult:[110,80,85]});
  assert.deepEqual(sourceOverPixel(result,mask,source,2),{alpha:1,premult:[200,100,50]});
  assert.deepEqual([...source.rgba.slice(4,8)],[200,100,50,128]);assert.deepEqual([...image.rgba.slice(4,8)],[20,60,120,255]);
});

test('background source-over matches original/full-composite premultiplied interpolation for alpha, feather and protection combinations',()=>{
  for(const depth of [8,16]){
    const max=depth===16?65535:255,colors=depth===16?[12345,23456,34567]:[200,100,50],background=depth===16?[50123,40123,30123]:[20,60,120];
    const values:number[]=[],subjects:number[]=[],protections:number[]=[];
    for(const alpha of [0,1,128,254,255])for(const s of [0,128,255])for(const p of [0,128,255]){values.push(...colors,alpha*max/255);subjects.push(s);protections.push(p);}
    const source:Raster={width:subjects.length,height:1,rgba:depth===16?Uint16Array.from(values):Uint8Array.from(values)};
    const image:Raster={width:source.width,height:1,rgba:depth===16?new Uint16Array(values.length):new Uint8Array(values.length)};
    for(let p=0;p<subjects.length;p++)image.rgba.set([...background,max],p*4);
    const subject=Uint8Array.from(subjects),protection=Uint8Array.from(protections),mask=backgroundEditMask(source,subject,protection),result=prepareBackgroundCandidate(image,source,subject,protection);
    for(let pixel=0;pixel<subjects.length;pixel++){
      const a=source.rgba[pixel*4+3]/max,s=subjects[pixel]/255,p=protections[pixel]/255,r=Math.min(s,a),actual=sourceOverPixel(result,mask,source,pixel);
      const wantAlpha=(1-p)+p*a;
      assert.ok(Math.abs(actual.alpha-wantAlpha)<1e-12,`depth=${depth} A=${a} S=${s} P=${p} alpha ${actual.alpha} != ${wantAlpha}`);
      for(let c=0;c<3;c++){
        // Opaque inputs use the ordinary 8-bit editable mask, including its
        // established integer rounding. Partial-alpha pixels require full cover.
        const ordinaryMask=Math.round((255-subjects[pixel])*(255-protections[pixel])/255)/255;
        const want=a===1?colors[c]*(1-ordinaryMask)+background[c]*ordinaryMask:(1-p)*(r*colors[c]+(1-r)*background[c])+p*a*colors[c];
        assert.ok(Math.abs(actual.premult[c]-want)<=.501,`depth=${depth} A=${a} S=${s} P=${p} channel${c}: ${actual.premult[c]} != ${want}`);
      }
    }
  }
});

test('background composition happens at native source dimensions and preserves non-257 16-bit samples',()=>{
  const source:Raster={width:3,height:1,rgba:new Uint16Array([12345,23456,34567,0,12345,23456,34567,32769,12345,23456,34567,65535])};
  const generated:Raster={width:1,height:1,rgba:new Uint16Array([50123,40123,30123,65535])},subject=new Uint8Array([0,255,255]);
  const result=prepareBackgroundCandidate(generated,source,subject);
  assert.equal(result.width,3);assert.equal(result.height,1);assert.ok(result.rgba instanceof Uint16Array);
  assert.deepEqual([...result.rgba.slice(0,4)],[50123,40123,30123,65535]);assert.deepEqual([...result.rgba.slice(4,8)],[31233,31789,32345,65535]);
  assert.throws(()=>prepareBackgroundCandidate(generated,source,new Uint8Array(2)),/蒙版.*尺寸/);
  assert.throws(()=>backgroundEditMask(source,subject,new Uint8Array(1)),/蒙版.*尺寸/);
});
