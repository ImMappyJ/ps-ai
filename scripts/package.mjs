import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
export const INSTALL_GUIDE=`# PS-AI — 安装 / Installation

[简体中文](#中文) · [English](#english)

## 中文

本包为实验版，版本以 manifest.json 为准。现有宿主证据来自 Windows Photoshop 27.0；不代表所有安装形式、控件和模式均已验收。先保存文档并退出 Photoshop。

CCX：用 Adobe Creative Cloud 桌面应用安装包；安装位置由 Adobe 管理，不要手动复制到 Photoshop 的 Plug-ins。关联到 UPIA 后双击没有反应时，用环境工具中的 scripts/install-ccx.ps1 -PackagePath 指定完整包路径；不要用 Photoshop 的“打开”导入。更新时退出 Photoshop 后安装新版 CCX；卸载使用 Creative Cloud 的插件管理。

Portable：解压后把整个 PS-AI-FOR-ME 文件夹放入你实际安装的 Photoshop 的 Plug-ins 目录。manifest.json 应直接位于 PS-AI-FOR-ME 下，不要多套目录。重启后打开“增效工具 → PS-AI (Portable)”。不需要编译或 CCX 安装器。其他版本及开发模式关闭时的加载仍需自行确认。

启动后进入“设置 → 模型与连接”，选择 ComfyUI、Nano Banana（Gemini）、GPT Image（OpenAI Images）或 BaiLian（百炼）；保留“手动适配服务（进阶）”供手动网关使用。ComfyUI 直接连接现有服务：填写 HTTP(S) 地址，扫描并选择三个 Qwen 2.1 模型，保存配置、连接。模型、ComfyUI 不含在插件包内。

云端平台使用独立本机中转，自动启动需要 Windows、Node.js 24+ 与 Photoshop 的启动授权；选择 ComfyUI 不启动中转。按同版本环境工具的 docs/setup/PLATFORMS.md 保存对应平台 Key、扫描模型、保存配置并连接；连接成功不等于云端账户或输出效果已验收。图像和提示词会发送到所选后端；Key 加密保存在插件内，不随设置 JSON 导出。三个云端适配器尚无真实 API Key 的推理验收。光影重塑已有有限原生 API 与已安装面板受控响应验证；这不代表当前所有控件、真实模型效果或保细节光影层通过视觉验收。

只保留一种安装形式以免打开错面板。同一插件 ID 升级沿用其 Photoshop 插件数据目录；先备份设置和需要的 PNG，不主动清理数据。CCX（local.ps-ai）与 Portable（local.ps-ai.portable）使用不同数据，切换安装形式时历史不会自动迁移。Portable 更新或卸载时退出 Photoshop，再仅替换或移除 PS-AI-FOR-ME 目录；不要改动其他插件。设置、历史、候选和缓存位于 Photoshop 的插件数据目录，不随程序目录移动，也不要把卸载当作清理私人数据的保证。旧会话候选保留导出，不能据此获得当前文档的应用权限；新编辑需重新捕获。

退出 Photoshop 或切回 ComfyUI 不会停止已运行的独立中转。需要关闭时，在“设置 → 模型与连接”的云端平台配置下使用“停止本地服务”，停止三个平台监听并等待工作收尾；这不保证取消已经提交的云端请求或停止计费。

支持 RGB／已解析色彩的灰度 8/16 位来源，优先使用当前文档 ICC，读取不再打开原文件选择器；未标记 RGB8/16 无法确认时在独立“假定 sRGB”近似副本中继续，保留原文档，未知灰度仍拒绝。模型输入为 sRGB8，平台输出当前为 sRGB8。ComfyUI 的可选 16-bit SDR 输出需按同版本环境工具 docs/setup/COMFYUI.md 安装 comfyui/ps_ai_sdr16 节点并重启后端；它不等于模型原生 16 位或 HDR。4500 万像素是文档处理上限，不是模型原生生成分辨率承诺。完整模式、色彩、透明度及验收边界见同版本环境工具的 docs/usage/USER_GUIDE.md。

请在已保存的副本中使用并检查生成结果的结构、颜色、边缘和透明度。宿主崩溃需要结合日志及 GPU／网络设置分别排查，换安装形式不保证解决。代码采用 GPL-3.0-only，完整许可见 LICENSE；第三方代码声明见 THIRD_PARTY_NOTICES.txt，模型权重和云端服务有各自许可、费用及使用限制。源码和同版本说明从 https://github.com/ImMappyJ/ps-ai 的对应版本标签进入。

## English

This is an experimental package; manifest.json identifies its version. Existing host evidence comes from Windows Photoshop 27.0; it does not establish acceptance of every installation method, control or mode. Save your work and quit Photoshop first.

CCX: install using Adobe Creative Cloud desktop. Adobe manages its installation location; do not copy it into Photoshop Plug-ins manually. If double-clicking a CCX associated with UPIA does nothing, run scripts/install-ccx.ps1 -PackagePath with the full package path from the environment tools. Photoshop File → Open does not install plugins. For updates, quit Photoshop and install the newer CCX; uninstall through Creative Cloud plugin management.

Portable: extract the ZIP, then copy the entire PS-AI-FOR-ME folder into your installed Photoshop Plug-ins directory. The manifest must be directly inside that folder. Restart and open Plugins → PS-AI (Portable). No compilation or CCX installer is needed. Other versions and developer-mode-off loading still need validation.

After opening the panel, go to Settings → Backend and models and select ComfyUI, Nano Banana (Gemini), GPT Image (OpenAI Images) or BaiLian. Manual gateway (advanced) remains available for manually managed gateways. ComfyUI connects directly to an existing service: enter its HTTP(S) address, scan and select the three Qwen 2.1 model files, save and connect. Models and ComfyUI are separate downloads.

Cloud platforms use a separate local relay. Automatic launching requires Windows, Node.js 24+ and Photoshop launch consent; ComfyUI never starts the relay. Follow docs/setup/PLATFORMS.en.md in the matching environment tools to save the platform key, scan models, save settings and connect. A successful connection does not validate the cloud account or image quality. Images and prompts go to the selected backend; keys are encrypted in plugin storage and excluded from settings JSON exports. Real API-key inference acceptance remains pending for all three cloud adapters. Relighting has limited native API and installed-panel controlled-response evidence; this does not establish acceptance of all current controls, real-model quality or detail-preserving lighting layers.

Use one installation method to avoid confusing the panels. Upgrades with the same plugin ID use its existing Photoshop plugin data directory; back up settings and required PNGs, and do not clear data as part of an update. CCX (local.ps-ai) and Portable (local.ps-ai.portable) use separate data; history does not migrate when switching methods. For Portable updates or removal, quit Photoshop and replace or remove only PS-AI-FOR-ME. Settings, history, candidates and cache stay in Photoshop plugin data, independently of the program folder; uninstalling is not a guarantee of private-data removal. Older-session candidates remain exportable and gain no current-document apply permission; capture again for a new edit.

Quitting Photoshop or switching to ComfyUI leaves an already running relay process alive. To close it, use Stop local relay in a cloud platform's Settings → Backend and models to stop all three platform listeners and drain work. This does not guarantee cancellation of an upstream cloud request or stopped billing.

Sources support RGB and resolved-profile Grayscale 8/16-bit, prioritizing the current document ICC without an original-file picker. Unresolved untagged RGB8/16 uses an independent approximate Assumed sRGB copy while preserving the original; unknown-profile Grayscale still rejects. Model inputs are sRGB8; current platform outputs are sRGB8. Optional ComfyUI 16-bit SDR output requires installing comfyui/ps_ai_sdr16 and restarting the backend as described in docs/setup/COMFYUI.en.md in the matching environment tools; it is not native 16-bit model generation or HDR. The 45-million-pixel limit concerns document processing, not promised native model generation size. See docs/usage/USER_GUIDE.en.md in the matching environment tools for mode, color, alpha and acceptance limits.

Use saved copies and inspect generated structure, colors, edges and transparency. Investigate host crashes using logs and separate GPU/network controls; changing installation methods is not a guaranteed fix. Code: GPL-3.0-only, see LICENSE. Third-party code notices are in THIRD_PARTY_NOTICES.txt; model weights and cloud services have separate licenses, charges and usage restrictions. Open the matching version tag at https://github.com/ImMappyJ/ps-ai for source and versioned guides.
`;
// The verifier imports these lists from the trusted control checkout without npm ci.
// Dependency imports stay inside the packaging functions.
export function environmentSourceNames(){
  const names=['LICENSE','scripts/check-environment.ps1','scripts/prepare-environment.ps1','scripts/install-ccx.ps1','config/settings.example.json','config/compatibility.json','README.md','docs/README.en.md','docs/setup/COMFYUI.md','docs/setup/COMFYUI.en.md','docs/setup/PLATFORMS.md','docs/setup/PLATFORMS.en.md','src/generation/workflow.ts','src/infrastructure/config/profile.ts','comfyui/ps_ai_sdr16/__init__.py'];
  const guide=[
    'workflow-create-zh.png','workflow-settings-zh.png','workflow-results-zh.png','workflow-overview.png',
    '050-create-zh.png','050-results-zh.png','050-history-zh.png','050-settings-zh.png','050-settings-en.png','050-relight-zh.png','050-layers-zh.png','050-selection-error-zh.png',
    ...['edit','remove','background','costume','reference','scene','effect','atmosphere','generate','blend'].map(mode=>'050-mode-'+mode+'-zh.png'),
    ...['edit','remove','background','costume','reference','scene','effect','atmosphere','generate','relight','blend'].map(mode=>'050-result-'+mode+'.png'),
    '050-advanced-zh.png','050-models-zh.png'];
  names.push('docs/usage/USER_GUIDE.md','docs/usage/USER_GUIDE.en.md',...guide.map(name=>'assets/guide/'+name));
  const brand=['mark.svg','wordmark.svg','mark-on-dark.svg','mark-on-light.svg','mark-mono-dark.svg','mark-mono-light.svg','lockup-on-dark.svg','lockup-on-light.svg','lockup-mono-dark.svg','lockup-mono-light.svg','avatar.png','favicon.ico','wordmark-on-dark.png','overview.svg',...[16,23,24,32,46,48,64,96,128,256,512].map(n=>`icons/mark-${n}.png`),...[48,96,512].map(n=>`icons/app-${n}.png`)];
  names.push(...brand.map(name=>'assets/brand/'+name),...[23,46].flatMap(size=>['light','dark'].map(color=>`assets/brand/icons/sidebar-${color}-${size}.png`)));
  return [...names,'docs/providers/BAILIAN.md','docs/providers/BAILIAN.en.md','docs/providers/GEMINI.md','docs/providers/GEMINI.en.md','docs/providers/OPENAI.md','docs/providers/OPENAI.en.md','config/settings.bailian.example.json','config/settings.gemini.example.json','config/settings.openai.example.json'];
}
export const ENVIRONMENT_GENERATED_FILES=Object.freeze(['backend/ps-ai-gateway.mjs','backend/THIRD_PARTY_NOTICES.txt','backend/LICENSE']);
export const PLUGIN_RUNTIME_FILES=Object.freeze(['manifest.json','index.html','main.js','style.css','THIRD_PARTY_NOTICES.txt','LICENSE','INSTALL.md','icons/brand.png','icons/wordmark.png',...['panel-on-dark','panel-on-light','plugin'].flatMap(name=>[`icons/${name}.png`,`icons/${name}@1x.png`,`icons/${name}@2x.png`]),'relay/ps-ai-gateway.mjs','relay/start-ps-ai-relay.cmd','relay/start-ps-ai-relay.ps1']);
export const SOURCE_ONLY_GUIDES=Object.freeze(['AGENTS.md','docs/development/BACKEND.md','docs/development/BACKEND.en.md','docs/development/RELIGHT.md','docs/development/RELIGHT.en.md','docs/development/RELEASING.md','docs/development/RELEASING.en.md']);
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
