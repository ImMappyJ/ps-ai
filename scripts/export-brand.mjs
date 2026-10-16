// SVG is the only geometry source. This renderer is build-time only, never UXP.
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {Resvg} from '@resvg/resvg-js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),folder=path.join(root,'assets/brand');
const mark=await fs.readFile(path.join(folder,'mark.svg'),'utf8'),wordmark=await fs.readFile(path.join(folder,'wordmark.svg'),'utf8');
const symbol=mark.match(/<g id="symbol"[\s\S]*?<\/g>/)?.[0],defs=mark.match(/<defs>[\s\S]*?<\/defs>/)?.[0],letters=wordmark.match(/<g id="wordmark"[\s\S]*?<\/g>/)?.[0];
if(!symbol||!defs||!letters)throw new Error('Canonical brand SVG is missing symbol, gradient or wordmark');
const dark='#121423',light='#F8F9FC';
function svg(body,width=128,height=128){return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="PS-AI"><title>PS-AI</title>${defs}${body}</svg>\n`;}
const mono=color=>symbol.replace('fill="url(#morph-ink)"',`fill="${color}"`);
const plate=color=>`<rect width="128" height="128" rx="26" fill="${color}"/>`;
const lockup=(color,monochrome=false)=>svg(`${monochrome?mono(color):symbol}<g transform="translate(152 39) scale(1.1)">${letters.replace('fill="#121423"',`fill="${color}"`)}</g>`,388,128);
const variants={
  'mark-on-dark.svg':svg(plate(dark)+symbol),
  'mark-on-light.svg':svg(plate(light)+symbol),
  'mark-mono-dark.svg':svg(mono(dark)),
  'mark-mono-light.svg':svg(mono(light)),
  'lockup-on-light.svg':lockup(dark),
  'lockup-on-dark.svg':lockup(light),
  'lockup-mono-dark.svg':lockup(dark,true),
  'lockup-mono-light.svg':lockup(light,true)
};
// Renderer output is sRGB; make that interpretation explicit for every PNG.
// Fixed, CRC-valid sRGB intent1 chunk, matching model/preview PNG tagging.
const srgb=Buffer.from('000000017352474201d9c92c7f','hex');
function png(svgText,size){const bytes=new Resvg(svgText,{font:{loadSystemFonts:false},fitTo:{mode:'width',value:size}}).render().asPng();return Buffer.concat([bytes.subarray(0,33),srgb,bytes.subarray(33)]);}
const exports=new Map(Object.entries(variants).map(([name,data])=>[name,Buffer.from(data)]));
for(const size of [16,23,24,32,46,48,64,96,128,256,512]){
  exports.set(`icons/mark-${size}.png`,png(mark,size));
}
for(const size of [48,96,512])exports.set(`icons/app-${size}.png`,png(variants['mark-on-dark.svg'],size));
for(const size of [23,46])for(const color of ['light','dark'])exports.set(`icons/sidebar-${color}-${size}.png`,png(variants[`mark-mono-${color}.svg`],size));
exports.set('avatar.png',png(variants['mark-on-dark.svg'],512));
exports.set('wordmark-on-dark.png',png(wordmark.replace('fill="#121423"','fill="#F8F9FC"'),226));
const sizes=[16,32,48],images=sizes.map(size=>png(mark,size)),header=Buffer.alloc(6+sizes.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
sizes.forEach((size,i)=>{const at=6+i*16;header[at]=header[at+1]=size;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(images[i].length,at+8);header.writeUInt32LE(offset,at+12);offset+=images[i].length;});
exports.set('favicon.ico',Buffer.concat([header,...images]));
const text=(x,y,value,size=16,color=dark)=>`<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" fill="${color}">${value}</text>`;
let preview=svg(`<rect width="1460" height="1020" fill="${light}"/><g transform="translate(48 35)">${symbol}</g><g transform="translate(208 77) scale(1.1)">${letters}</g>${text(50,185,'MORPH FRAME / BRAND SYSTEM',15)}
<rect x="48" y="216" width="670" height="360" rx="16" fill="${dark}"/><g transform="translate(260 243) scale(1.8)">${symbol}</g>${text(78,545,'THE GENERATING FRAME',14,light)}
<rect x="742" y="216" width="670" height="168" rx="16" fill="#ECEEF5"/><g transform="translate(832 236)">${symbol}<g transform="translate(152 39) scale(1.1)">${letters}</g></g>
<rect x="742" y="408" width="670" height="168" rx="16" fill="${dark}"/><g transform="translate(832 428)">${symbol}<g transform="translate(152 39) scale(1.1)">${letters.replace('fill="#121423"',`fill="${light}"`)}</g></g>
<rect x="48" y="600" width="1364" height="230" rx="16" fill="${dark}"/>${text(78,638,'ACTUAL PIXEL SIZES / 1:1',14,light)}`,1460,1020).replace('</svg>','');
for(const [i,size] of [16,24,32,48,64,128].entries())preview+=`<image x="${100+i*210}" y="${780-size}" width="${size}" height="${size}" href="data:image/png;base64,${exports.get(`icons/mark-${size}.png`).toString('base64')}"/>${text(100+i*210,808,size+' px',14,light)}`;
preview+=`<rect x="48" y="854" width="430" height="132" rx="16" fill="#ECEEF5"/><g transform="translate(66 864) scale(.85)">${mono(dark)}</g>${text(206,925,'ONE COLOR / DARK',14)}
<rect x="500" y="854" width="430" height="132" rx="16" fill="${dark}"/><g transform="translate(518 864) scale(.85)">${mono(light)}</g>${text(658,925,'ONE COLOR / LIGHT',14,light)}
<rect x="952" y="854" width="460" height="132" rx="16" fill="#ECEEF5"/><g transform="translate(970 864) scale(.85)">${mono('#777777')}</g>${text(1110,925,'GRAYSCALE SILHOUETTE',14)}</svg>\n`;
exports.set('overview.svg',Buffer.from(preview));
const check=process.argv.includes('--check');let count=0;
for(const [name,bytes] of exports){
  const file=path.join(folder,name);
  if(check){const existing=await fs.readFile(file).catch(()=>null);if(!existing||!bytes.equals(existing))throw new Error(`Stale brand export: ${name}. Run npm run brand:export.`);}
  else{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}count++;
}
console.log(`${check?'Checked':'Exported'} ${count} brand assets from canonical SVGs.`);
