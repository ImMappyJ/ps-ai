import {Raster,checkSize,convertDepth} from './image';
// The whole thumbnail is model context; amber is effective edit, blue protection.
// This display never changes the masks used for application.
export function rangePreview(image:Raster,edit:Uint8Array,protection:Uint8Array):Raster {
  image=convertDepth(image,8);
  checkSize(image.width,image.height);
  if(edit.length!==image.width*image.height||protection.length!==edit.length)throw new Error('蒙版尺寸错误');
  const rgba=new Uint8Array(image.rgba.length);
  for(let i=0;i<edit.length;i++){
    const at=i*4,alpha=image.rgba[at+3]/255;
    const gray=(image.rgba[at]+image.rgba[at+1]+image.rgba[at+2])/3*alpha+64*(1-alpha);
    for(let c=0;c<3;c++){
      const editAlpha=edit[i]/255*.65,protectAlpha=protection[i]/255*.7;
      const edited=gray*(1-editAlpha)+[255,180,50][c]*editAlpha;
      rgba[at+c]=Math.round(edited*(1-protectAlpha)+[60,160,255][c]*protectAlpha);
    }
    rgba[at+3]=255;
  }
  return {width:image.width,height:image.height,rgba};
}
