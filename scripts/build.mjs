import fs from 'node:fs/promises';import {build} from 'esbuild';import {brandIcon} from './brand-icon.mjs';import {INSTALL_GUIDE} from './package.mjs';
await fs.mkdir('dist/plugin',{recursive:true});
for(const file of ['manifest.json','index.html','style.css'])await fs.copyFile(`plugin/${file}`,`dist/plugin/${file}`);
await fs.mkdir('dist/plugin/icons',{recursive:true});
for(const [name,size] of [['panel',23],['plugin',48]]){
  await fs.writeFile(`dist/plugin/icons/${name}.png`,brandIcon(size));
  await fs.copyFile(`dist/plugin/icons/${name}.png`,`dist/plugin/icons/${name}@1x.png`);
  await fs.writeFile(`dist/plugin/icons/${name}@2x.png`,brandIcon(size*2));
}
await build({entryPoints:['src/panel.ts'],bundle:true,outfile:'dist/plugin/main.js',platform:'browser',format:'iife',target:'es2020',external:['photoshop','uxp'],define:{'process.env.NODE_ENV':'"production"'},metafile:true}).then(async(result)=>{await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/build-metafile.json',JSON.stringify(result.metafile,null,2));});
const libraries=[['UPNG.js','node_modules/upng-js/LICENSE'],['pako','node_modules/pako/LICENSE']];
const manifest=JSON.parse(await fs.readFile('plugin/manifest.json','utf8'));
let notices=`${manifest.name} ${manifest.version}\nThird-party runtime notices\n\n`;
for(const [name,file] of libraries)notices+=name+'\n'+await fs.readFile(file,'utf8')+'\n\n';
await fs.writeFile('dist/plugin/THIRD_PARTY_NOTICES.txt',notices);
await fs.writeFile('dist/plugin/INSTALL.md',INSTALL_GUIDE);
await fs.copyFile('LICENSE','dist/plugin/LICENSE');
console.log('Built dist/plugin (UXP; Photoshop/UXP are the only external modules).');
