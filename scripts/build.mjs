import fs from 'node:fs/promises';import {build} from 'esbuild';import {INSTALL_GUIDE} from './package.mjs';
import {gatewayBundle} from './build-gateway.mjs';
await fs.mkdir('dist/plugin',{recursive:true});
for(const file of ['manifest.json','index.html','style.css'])await fs.copyFile(`plugin/${file}`,`dist/plugin/${file}`);
await fs.mkdir('dist/plugin/icons',{recursive:true});
// Remove only the superseded generated files from older local builds.
for(const name of ['panel.png','panel@1x.png','panel@2x.png'])await fs.rm(`dist/plugin/icons/${name}`,{force:true});
for(const [name,source,size] of [['panel-on-dark','sidebar-light',23],['panel-on-light','sidebar-dark',23],['plugin','app',48]]){
  await fs.copyFile(`assets/brand/icons/${source}-${size}.png`,`dist/plugin/icons/${name}.png`);
  await fs.copyFile(`dist/plugin/icons/${name}.png`,`dist/plugin/icons/${name}@1x.png`);
  await fs.copyFile(`assets/brand/icons/${source}-${size*2}.png`,`dist/plugin/icons/${name}@2x.png`);
}
await fs.copyFile('assets/brand/icons/mark-64.png','dist/plugin/icons/brand.png');
await fs.copyFile('assets/brand/wordmark-on-dark.png','dist/plugin/icons/wordmark.png');
await build({entryPoints:['src/panel.ts'],bundle:true,outfile:'dist/plugin/main.js',platform:'browser',format:'iife',target:'es2020',external:['photoshop','uxp'],define:{'process.env.NODE_ENV':'"production"'},metafile:true}).then(async(result)=>{await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/build-metafile.json',JSON.stringify(result.metafile,null,2));});
const libraries=[['UPNG.js','node_modules/upng-js/LICENSE'],['pako','node_modules/pako/LICENSE']];
const manifest=JSON.parse(await fs.readFile('plugin/manifest.json','utf8'));
let notices=`${manifest.name} ${manifest.version}\nThird-party runtime notices\n\n`;
for(const [name,file] of libraries)notices+=name+'\n'+await fs.readFile(file,'utf8')+'\n\n';
await fs.writeFile('dist/plugin/THIRD_PARTY_NOTICES.txt',notices);
await fs.writeFile('dist/plugin/INSTALL.md',INSTALL_GUIDE);
await fs.copyFile('LICENSE','dist/plugin/LICENSE');
console.log('Built dist/plugin (UXP; Photoshop/UXP are the only external modules).');
await fs.mkdir('dist/gateway',{recursive:true});await fs.writeFile('dist/gateway/ps-ai-gateway.mjs',await gatewayBundle(process.cwd()));
await fs.writeFile('dist/gateway/THIRD_PARTY_NOTICES.txt',notices);await fs.copyFile('LICENSE','dist/gateway/LICENSE');
console.log('Built dist/gateway/ps-ai-gateway.mjs (Node.js 24; no local ComfyUI required).');
