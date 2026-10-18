import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';

export function readBuildIdentity(root,git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']})){
  const {version}=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  try{
    const revision=git(['rev-parse','--verify','HEAD']).trim();
    if(!/^[a-f0-9]{40,64}$/i.test(revision))throw new Error('Unidentified revision');
    const dirty=git(['status','--porcelain=v1','--untracked-files=normal']).trim().length>0;
    return `PS-AI ${version} · ${revision.slice(0,8)}${dirty?'-dirty':''}`;
  }catch{return `PS-AI ${version} · unknown-dirty`;}
}
