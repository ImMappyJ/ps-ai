import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
export const INSTALL_GUIDE=`# PS-AI — 安装 / Installation

[简体中文](#中文) · [English](#english)

## 中文

实验版，仅在 Windows Photoshop 27.0 验证。先保存文档并退出 Photoshop。

CCX：用 Adobe Creative Cloud 桌面应用安装包。关联到 UPIA 后双击没有反应时，用环境工具中的 scripts/install-ccx.ps1 -PackagePath 指定完整包路径；不要用 Photoshop 的“打开”导入。

Portable：解压后把整个 PS-AI-FOR-ME 文件夹放入你实际安装的 Photoshop 的 Plug-ins 目录。manifest.json 应直接位于 PS-AI-FOR-ME 下，不要多套目录。重启后打开“增效工具 → PS-AI (Portable)”。不需要编译或 CCX 安装器。其他版本及开发模式关闭时的加载仍需自行确认。

启动兼容的 ComfyUI，打开面板的“模型与连接”，填写 HTTP(S) 地址，扫描并选择三个 Qwen 2.1 模型，保存配置、连接。模型、ComfyUI 不含在插件包内。选择 16-bit SDR 输出前，按同版本环境工具的 docs/setup/COMFYUI.md 复制 comfyui/ps_ai_sdr16 节点并重启后端。完整后端指南也可从 GitHub 仓库首页进入。

开发版的平台选择、加密 Key 和按需中转启动见 GitHub 的 docs/setup/PLATFORMS.md。选择平台需要 Node.js 24+ 与 Photoshop 的启动授权；选择 ComfyUI 不启动中转。平台与光影重塑仍待实机验收。

只保留一种安装形式以免打开错面板。CCX 与 Portable 使用不同的数据目录，切换前导出设置和 PNG；历史不会自动迁移。更新时退出 PS，再仅替换本插件目录。卸载 Portable 也只移除该目录。旧会话候选可以导出，但必须重新捕获才能应用。

这是实验版，请在已保存的副本中使用。生成结果可能改变结构和颜色。宿主崩溃需要结合日志及 GPU／网络设置分别排查，换安装形式不保证解决。代码采用 GPL-3.0-only，完整许可见 LICENSE；权重许可另计。匹配源码和说明：https://github.com/ImMappyJ/ps-ai

## English

Experimental; tested on Windows Photoshop 27.0. Save your work and quit Photoshop first.

CCX: install using Adobe Creative Cloud desktop. If double-clicking a CCX associated with UPIA does nothing, run scripts/install-ccx.ps1 -PackagePath with the full package path from the environment tools. Photoshop File → Open does not install plugins.

Portable: extract the ZIP, then copy the entire PS-AI-FOR-ME folder into your installed Photoshop Plug-ins directory. The manifest must be directly inside that folder. Restart and open Plugins → PS-AI (Portable). No compilation or CCX installer is needed. Other versions and developer-mode-off loading still need validation.

Start a compatible ComfyUI. In Backend and models, enter its HTTP(S) address, scan and select the three Qwen 2.1 model files, save and connect. Models and ComfyUI are separate downloads. For 16-bit SDR output, copy comfyui/ps_ai_sdr16 from the environment tools into backend custom_nodes and restart; see docs/setup/COMFYUI.en.md in the matching environment tools. The repository homepage also links to the guide.

Development platform selection, encrypted keys and on-demand launching are documented in docs/setup/PLATFORMS.en.md on GitHub. Platforms require Node.js 24+ and Photoshop launch consent; ComfyUI never starts the relay. Platform and relight host acceptance are pending.

Use one installation method to avoid confusing the panels. CCX and Portable keep separate data. Export settings and PNGs before switching; history is not migrated. Quit Photoshop before replacing or removing only this plugin folder. Candidates from older sessions can be exported; capture again before applying.

Use saved copies. Generated structure and colors need review. Investigate host crashes using logs and separate GPU/network controls; changing installation methods is not a guaranteed fix. Code: GPL-3.0-only, see LICENSE. Model licenses are separate. Matching source: https://github.com/ImMappyJ/ps-ai
`;
// The verifier imports these lists from the trusted control checkout without npm ci.
// Dependency imports stay inside the packaging functions.
export function environmentSourceNames(){
  const names=['LICENSE','scripts/check-environment.ps1','scripts/prepare-environment.ps1','scripts/install-ccx.ps1','config/settings.example.json','config/compatibility.json','README.md','docs/README.en.md','docs/setup/COMFYUI.md','docs/setup/COMFYUI.en.md','docs/setup/PLATFORMS.md','docs/setup/PLATFORMS.en.md','assets/1.png','assets/2.png','assets/setup-zh.png','assets/setup-en.png','assets/comfyui-model-library.jpg','src/generation/workflow.ts','src/infrastructure/config/profile.ts','comfyui/ps_ai_sdr16/__init__.py'];
  const guide=['before.png','after.png','recipes.json','reference-white-socks-icc.png','07-effect-asset-workspace.png',
    ...['01-edit','02-remove','03-background','04-costume','05-reference','06-scene','08-atmosphere','09-generate'].map(name=>name+'-panel.png'),
    ...['01-edit','03-background','06-scene','09-generate'].map(name=>name+'-workspace.png'),
    ...['01-edit','02-remove','03-background','04-costume','05-reference','06-scene'].map(name=>name+'-compare.png'),
    ...['07-effect','08-atmosphere'].map(name=>name+'-result.png'),
    ...['01-edit','02-remove','03-background','04-costume'].map(name=>name+'-selection.png'),
    ...['effect','atmosphere','generate'].map(name=>name+'-preview.png')];
  names.push('docs/usage/USER_GUIDE.md','docs/usage/USER_GUIDE.en.md',...guide.map(name=>'assets/guide/'+name));
  const brand=['mark.svg','wordmark.svg','mark-on-dark.svg','mark-on-light.svg','mark-mono-dark.svg','mark-mono-light.svg','lockup-on-dark.svg','lockup-on-light.svg','lockup-mono-dark.svg','lockup-mono-light.svg','avatar.png','favicon.ico','wordmark-on-dark.png','overview.svg',...[16,23,24,32,46,48,64,96,128,256,512].map(n=>`icons/mark-${n}.png`),...[48,96,512].map(n=>`icons/app-${n}.png`)];
  names.push(...brand.map(name=>'assets/brand/'+name),...[23,46].flatMap(size=>['light','dark'].map(color=>`assets/brand/icons/sidebar-${color}-${size}.png`)));
  return [...names,'docs/providers/BAILIAN.md','docs/providers/BAILIAN.en.md','docs/providers/GEMINI.md','docs/providers/GEMINI.en.md','docs/providers/OPENAI.md','docs/providers/OPENAI.en.md','config/settings.bailian.example.json','config/settings.gemini.example.json','config/settings.openai.example.json'];
}
export const ENVIRONMENT_GENERATED_FILES=Object.freeze(['backend/ps-ai-gateway.mjs','backend/THIRD_PARTY_NOTICES.txt','backend/LICENSE']);
export const PLUGIN_RUNTIME_FILES=Object.freeze(['manifest.json','index.html','main.js','style.css','THIRD_PARTY_NOTICES.txt','LICENSE','INSTALL.md','icons/brand.png','icons/wordmark.png',...['panel-on-dark','panel-on-light','plugin'].flatMap(name=>[`icons/${name}.png`,`icons/${name}@1x.png`,`icons/${name}@2x.png`]),'relay/ps-ai-gateway.mjs','relay/start-ps-ai-relay.cmd','relay/start-ps-ai-relay.ps1']);
export const SOURCE_ONLY_GUIDES=Object.freeze(['AGENTS.md','docs/development/BACKEND.md','docs/development/BACKEND.en.md','docs/development/RELEASING.md','docs/development/RELEASING.en.md']);
export function sourceGuideReference(sourceRef='main'){
  if(sourceRef!=='main'&&(typeof sourceRef!=='string'||!/^[a-f0-9]{40}$/.test(sourceRef)))throw new Error('sourceRef must be main or a full lowercase source commit SHA');
  return sourceRef;
}
export function rewriteSourceGuideLinks(name,text,sourceRef='main'){
  const ref=sourceGuideReference(sourceRef),sourceOnly=new Set(SOURCE_ONLY_GUIDES);
  return text.replace(/\]\(([^\s)]+)\)/g,(match,target)=>{
    const [file,anchor]=target.split('#'),resolved=path.posix.normalize(path.posix.join(path.posix.dirname(name),file));
    return sourceOnly.has(resolved)?`](https://github.com/ImMappyJ/ps-ai/blob/${ref}/${resolved}${anchor?'#'+anchor:''})`:match;
  });
}
export async function createEnvironmentPackage(root,target,{sourceRef='main'}={}){
  sourceGuideReference(sourceRef);
  const {zipSync,strToU8,strFromU8}=await import('fflate');
  const {gatewayBundle,gatewayNotices}=await import('./build-gateway.mjs');
  const entries={};for(const name of environmentSourceNames())entries[name]=new Uint8Array(await fs.readFile(path.join(root,name)));
  // These development entry points belong to the source repository. Keep
  // shipped guides navigable without copying private notes or server sources.
  for(const [name,bytes] of Object.entries(entries))if(name.endsWith('.md')){
    entries[name]=strToU8(rewriteSourceGuideLinks(name,strFromU8(bytes),sourceRef));
  }
  entries['backend/ps-ai-gateway.mjs']=await gatewayBundle(root);
  entries['backend/THIRD_PARTY_NOTICES.txt']=strToU8(await gatewayNotices(root));entries['backend/LICENSE']=entries.LICENSE;
  await fs.writeFile(target,zipSync(entries,{level:9}));return Object.keys(entries);
}
async function packageEntries(directory){
  const {strToU8,strFromU8}=await import('fflate');
  const entries={};
  async function collect(folder,prefix=''){
    for(const item of (await fs.readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(item.name==='.uxprc'&&item.isFile())continue; // Adobe development-session metadata, never a runtime resource.
      const name=prefix+item.name,absolute=path.join(folder,item.name);
      if(item.isDirectory()){if(!['icons','relay'].includes(name))throw new Error(`不允许打包目录：${name}`);await collect(absolute,name+'/');}
      else {if(!/^(manifest\.json|index\.html|main\.js|style\.css|THIRD_PARTY_NOTICES\.txt|LICENSE|INSTALL\.md|icons\/[\w-]+(?:@[12]x)?\.png|relay\/(ps-ai-gateway\.mjs|start-ps-ai-relay\.(cmd|ps1)))$/.test(name))throw new Error(`不允许打包文件：${name}`);entries[name]=new Uint8Array(await fs.readFile(absolute));}
    }
  }
  await collect(directory);
  for(const name of ['manifest.json','index.html','main.js'])if(!entries[name])throw new Error(`缺少文件：${name}`);
  const manifest=JSON.parse(strFromU8(entries['manifest.json']));
  const hosts=Array.isArray(manifest.host)?manifest.host:[manifest.host];
  if(hosts.length!==1||hosts[0].app!=='PS')throw new Error('CCX 必须为单个 Photoshop 宿主');
  manifest.host=hosts[0];entries['manifest.json']=strToU8(JSON.stringify(manifest,null,2));
  return entries;
}
export async function createPackage(directory,target){
  const {zipSync,unzipSync}=await import('fflate');
  const entries=await packageEntries(directory);
  const bytes=zipSync(entries,{level:9});
  const inspected=unzipSync(bytes);if(!inspected['manifest.json']||!inspected['main.js'])throw new Error('包校验失败');
  await fs.writeFile(target,bytes);return Object.keys(inspected);
}
export async function createPortablePackage(directory,target){
  const {zipSync,strToU8,strFromU8}=await import('fflate');
  const entries=await packageEntries(directory),manifest=JSON.parse(strFromU8(entries['manifest.json']));
  if(manifest.id!=='local.ps-ai')throw new Error('文件夹版必须从 PS-AI 正式构建生成');
  manifest.id='local.ps-ai.portable';manifest.name='PS-AI (Portable)';
  for(const entry of manifest.entrypoints??[])if(entry.type==='panel')entry.label={...entry.label,default:'PS-AI (Portable)'};
  entries['manifest.json']=strToU8(JSON.stringify(manifest,null,2));
  const guide=strToU8(INSTALL_GUIDE);
  entries['INSTALL.md']=guide;
  const archive=Object.fromEntries(Object.entries(entries).map(([name,bytes])=>['PS-AI-FOR-ME/'+name,bytes]));
  archive['INSTALL_PORTABLE.md']=guide;
  await fs.writeFile(target,zipSync(archive,{level:9}));return Object.keys(archive);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const explicit=process.env.PSAI_RELEASE_DIR;
  if(explicit!==undefined&&!explicit.trim())throw new Error('Explicit package output directory must not be empty');
  const output=path.resolve(explicit??'release');
  await fs.mkdir(output,{recursive:true});
  if(explicit!==undefined&&(await fs.readdir(output)).length)throw new Error('Explicit package output directory is nonempty; choose a new empty directory');
  const sourceRef=sourceGuideReference(process.env.PSAI_SOURCE_REF??'main');
  const manifest=JSON.parse(await fs.readFile('dist/plugin/manifest.json','utf8'));
  const target=path.join(output,`ps-ai-${manifest.version}-experimental.ccx`);
  await createPackage(path.resolve('dist/plugin'),target);console.log('Experimental package:',target);
  const environment=path.join(output,`ps-ai-${manifest.version}-environment-experimental.zip`);await createEnvironmentPackage(process.cwd(),environment,{sourceRef});console.log('Environment tools:',environment);
  const portable=path.join(output,`ps-ai-${manifest.version}-portable-experimental.zip`);await createPortablePackage(path.resolve('dist/plugin'),portable);console.log('Portable folder:',portable);
  for(const file of [target,environment,portable]){const hash=createHash('sha256').update(await fs.readFile(file)).digest('hex');await fs.writeFile(file+'.sha256',`${hash}  ${path.basename(file)}\n`);}
}
