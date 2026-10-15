// Raster companion to assets/icon.svg, using the existing PNG dependency.
import UPNG from 'upng-js';
const m=[[18,46],[18,25],[24,25],[32,36],[40,25],[46,25],[46,46],[40,46],[40,35],[32,46],[24,35],[24,46]];
const star=[[47,8],[49,14],[55,16],[49,18],[47,24],[45,18],[39,16],[45,14]];
function inside(x,y,points){let yes=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const [a,b]=points[i],[c,d]=points[j];if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)yes=!yes;}return yes;}
function line(x,y,a,b,c,d){const t=Math.min(1,Math.max(0,((x-a)*(c-a)+(y-b)*(d-b))/((c-a)**2+(d-b)**2)));return Math.hypot(x-a-t*(c-a),y-b-t*(d-b))<=1.5;}
function pixel(x,y){const cx=Math.max(17,Math.min(47,x)),cy=Math.max(17,Math.min(47,y));if(Math.hypot(x-cx,y-cy)>14)return [0,0,0,0];
  if(inside(x,y,star))return [228,237,255,255];if(inside(x,y,m))return [110,231,213,255];
  if(line(x,y,12,26,12,13)||line(x,y,12,13,25,13)||line(x,y,39,52,52,52)||line(x,y,52,52,52,39))return [154,175,225,255];
  return [21,30,50,255];
}
export function brandIcon(size){const rgba=new Uint8Array(size*size*4),samples=4;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){let alpha=0,colors=[0,0,0];for(let sy=0;sy<samples;sy++)for(let sx=0;sx<samples;sx++){const p=pixel((x+(sx+.5)/samples)*64/size,(y+(sy+.5)/samples)*64/size);alpha+=p[3];for(let c=0;c<3;c++)colors[c]+=p[c]*p[3];}const i=(y*size+x)*4;for(let c=0;c<3;c++)rgba[i+c]=alpha?Math.round(colors[c]/alpha):0;rgba[i+3]=Math.round(alpha/(samples*samples));}
  return new Uint8Array(UPNG.encode([rgba.buffer],size,size,0,undefined,true));
}
