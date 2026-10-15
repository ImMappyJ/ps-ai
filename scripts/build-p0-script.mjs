import fs from 'node:fs/promises';import {build} from 'esbuild';
await fs.mkdir('dist',{recursive:true});
const runtime=process.argv.includes('--runtime'),geometry=process.argv.includes('--geometry'),modes=process.argv.includes('--modes'),at=process.argv.indexOf('--candidate'),candidate=at<0?null:process.argv[at+1];
if([runtime,geometry,modes].filter(Boolean).length>1)throw new Error('Select only one native probe');
if(candidate&&!/^[0-9a-f-]{36}$/.test(candidate))throw new Error('Candidate must be a prompt UUID');
const output=modes?'dist/ps-ai-modes.psjs':geometry?'dist/ps-ai-geometry.psjs':runtime?'dist/ps-ai-runtime.psjs':'dist/ps-ai-p0.psjs';
const result=await build({entryPoints:[modes?'src/p0-modes-script.ts':geometry?'src/p0-geometry-script.ts':runtime?'src/p0-runtime-script.ts':'src/p0-script.ts'],bundle:true,write:false,globalName:'PsAiP0Script',platform:'browser',format:'iife',target:'es2020',external:['photoshop','uxp'],define:{'process.env.NODE_ENV':'"production"','__P0_CANDIDATE__':JSON.stringify(candidate),'__P0_NETWORK__':String(process.argv.includes('--network'))}});
await fs.writeFile(output,result.outputFiles[0].text+'\nawait PsAiP0Script.main();\n');
console.log('Standalone UXP probe:',output,'(File > Scripts > Browse)');
