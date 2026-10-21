<p align="center">
  <img src="assets/brand/avatar.png" width="72" alt="PS-AI">
</p>
<h1 align="center">PS-AI</h1>
<p align="center"><strong>简体中文</strong> · <a href="docs/README.en.md">English</a></p>

PS-AI 是 Photoshop 图像生成与编辑插件，可选择 ComfyUI / Qwen-Image 2.1、Nano Banana（Gemini）、GPT Image（OpenAI Images）和 BaiLian（百炼）四条适配路径。它提供局部修图、人像服装与道具处理、光影重塑、溶图和文字生图，候选可预览、导出或应用到 Photoshop。

本页对应 **0.5.0（实验性测试版，预发布通道）**，具体修订由独立 Git 构建标识区分。ComfyUI 路径已有真实推理和有限 Photoshop 27 验收记录；三种云端适配有代码与离线测试，尚无真实 API Key 出图或平台宿主验收。下方主界面截图是 **0.5.0 UI 操作样本**，所有模式配置图也来自当前版本；这些图片不能证明当前全部控件或模型效果。生成结果可能需要手工修整，请在已保存的副本上使用。不包含常规磨皮、去痘和肤色精修。

从 0.3.0 升级后，面板名称由 `PS-AI FOR ME` 改为 `PS-AI`，图标使用 Morph Frame 标识。插件 ID 与 `PS-AI-FOR-ME` 安装目录保持不变。

“设置”中可分别保存平台模型和加密 Key，并按需启动本机中转。人像工作区提供[光影重塑工作台](docs/usage/USER_GUIDE.md#relight)：编辑多光源意图后明确生成，输出可选实验光影层组或整图重绘的蒙版新图层。本地布光示意不是 AI 结果；光影层是估计的影响场，真实照片保细节效果仍需验收。配置见[平台选择](docs/setup/PLATFORMS.md)；接口与限制见[百炼](docs/providers/BAILIAN.md)、[Gemini / Nano Banana](docs/providers/GEMINI.md)和[OpenAI Images](docs/providers/OPENAI.md)。

[原图色彩读取](docs/usage/USER_GUIDE.md#source-color)支持在精确授权原文件后，为可确认 sRGB 的无 ICC 静态 WebP 或显式 sRGB PNG 创建保留图层的工作副本；当前文档已有 ICC 时优先使用。WebP8 等值回填、PNG8 捕获与有限已安装恢复流程各有记录，参考导入、持久授权和更广泛交互仍需验收。

[背景模式](docs/usage/USER_GUIDE.md#background-fix)和场景替换从要保留的主体选区生成整张背景，另有免提示词移除与[人像溶图](docs/usage/USER_GUIDE.md#blend)。背景有单个舞台样本推理／回填记录；溶图有小 RGB8 受控安装流程和有限真实 Qwen 对照，真实人像效果仍弱。这些记录不能扩大为所有新控件、大图、16 位或平台质量验收。v0.4.0 历史包不包含这些后续功能。

## 文档导航

| 用途 | 文档 |
| --- | --- |
| 十一种模式与当前界面图例 | [图文使用指南](docs/usage/USER_GUIDE.md) |
| 本地后端、模型与排错 | [ComfyUI 配置](docs/setup/COMFYUI.md) |
| 平台选择与 Key 配置 | [平台配置](docs/setup/PLATFORMS.md) |
| 平台接口和验收限制 | [百炼](docs/providers/BAILIAN.md) · [Gemini / Nano Banana](docs/providers/GEMINI.md) · [OpenAI Images](docs/providers/OPENAI.md) |
| 参与开发与服务端扩展 | [代码地图与开发约定](AGENTS.md#source-map) · [后端与持久化契约](docs/development/BACKEND.md) |

## 当前界面

以下是 Photoshop 27 中实际安装的 Portable **0.5.0 c3adef56**，使用 `3F3F3F.webp` 的独立 sRGB8 副本，保留前景像素和 alpha，下方另加中性灰背景。所有演示图片已换成当前实拍图。

| 创作与来源副本 | 光影重塑工作台 |
| --- | --- |
| ![0.5.0 创作界面](assets/guide/050-create-zh.png) | ![0.5.0 布光工作台，本地示意](assets/guide/050-relight-zh.png) |

这组工作台、候选与图层图使用本地受控照明响应（`127.0.0.1:8194`），不代表真实模型效果。新增模式配置图没有提交生成；模型配置图单独连接实际本地 ComfyUI 扫描。十一种模式的入口、选区要求、操作步骤及全部新图见[图文使用指南](docs/usage/USER_GUIDE.md)。真实模型质量与平台 Key 验收边界分别保留。

## 能做什么

- **局部修图**：物体和材质修改、移除杂物、替换背景。普通编辑保留选区外和手动保护区；背景模式选择要保留的主体。
- **人像**：服装／道具修复、场景修改、一张角色参考图辅助；另有光影重塑和参考整图环境的溶图。参考功能是实验性的，不保证角色和服装细节准确复现。
- **生图与素材**：文字生图，生成特效或氛围素材，在新文档打开或导出 PNG。素材默认参考当前图片与选区，也可明确选择纯文字。当前图片素材的真实 ComfyUI 样本视觉验收未通过，可能残留原人物、环境或范围边界；见[素材限制](docs/usage/USER_GUIDE.md#context-assets)。
- **候选与回填**：1–4 张串行候选，历史与断线恢复；ComfyUI 提供实际采样步数和按任务取消，平台适配仅显示阶段并停止后续候选。应用为独立图层和可编辑蒙版，支持一次撤销。
- **透明与颜色**：默认保留原透明轮廓，可选主体对齐和小幅上下文颜色匹配。RGB／灰度 8/16 位已在 Photoshop 中测试图像往返；模型输入仍是 sRGB 8-bit。
- **连接与语言**：保存后端地址、端口，ComfyUI 模型文件映射或平台模型 ID，导入／导出 JSON；面板可切换简体中文和 English。

ComfyUI 路径使用固定的 **Qwen-Image 2.1 GGUF 工作流**，不支持直接替换成 SD、SDXL 或 Flux。模型要求见[ComfyUI 配置指南](docs/setup/COMFYUI.md)。原文档上限为 45,000,000 像素、单边 30,000；大区域按预算使用工作图并在原坐标条带回填，这不代表模型原生生成 4500 万像素。模型输入为 sRGB8，ComfyUI 可选 SDR16 保存；原生 16 位文档处理不等于模型原生 16 位生成。插件 PNG／新文档可能采用工作图或分析图尺寸，原尺寸交付请在来源应用后由 Photoshop 保存或导出。

## 系统要求

| 项目 | 要求与已测试范围 |
| --- | --- |
| 系统／宿主 | Windows，Photoshop 2026 / 27.0+；目前只实测 27.0，macOS 未验收 |
| 推理后端 | 本地路径需要兼容 ComfyUI 与 GGUF 节点；云端路径需要对应 API Key 和模型权限，真实 Key 验收待完成。版本与边界见[兼容清单](config/compatibility.json) |
| 本地推理显卡／内存 | 测试配置为 NVIDIA RTX 5080 16 GiB、约 48 GB RAM；最低硬件要求尚未确定 |
| 本地模型磁盘 | 预设三个权重约 14.63 GB，另留后端、依赖、缓存和图片空间 |
| 源码构建 | Node.js 24.21.0、npm 11.19.0 已测试；ComfyUI 插件包无需 Node.js；可选平台适配服务需要 Node.js 24+ |

后端可以在本机，也可以在可访问的另一台机器上。插件会把图像和提示词发给你填写的地址，请使用自己信任的服务。平台接入使用独立本机适配服务，Key 由插件加密保存，仅在本机服务内存使用；不能把平台 API 地址直接填成 ComfyUI 地址。其他带登录或子路径的服务未验证。

## 安装发行包

从 [Releases](https://github.com/ImMappyJ/ps-ai/releases) 选择与本页 **0.5.0** 对应的插件包和环境工具，核对版本与 SHA256 后安装。若尚无 0.5.0 附件，请按[源码构建](#从源码构建)使用本页对应源码；不要用 v0.4.0 历史包尝试新版功能。发布标签对应该版本源码，主分支可能包含后续改动。

### 方式一：CCX

1. 安装 Adobe Creative Cloud 桌面应用，双击 `ps-ai-0.5.0-experimental.ccx`，按 Adobe 安装提示操作。
2. 重启 Photoshop，从“增效工具 → PS-AI”打开面板。
3. 如果双击没有反应，解压同版本 `ps-ai-0.5.0-environment-experimental.zip`，在其目录运行：

   ```powershell
   $package = Read-Host 'CCX 文件完整路径'
   powershell.exe -NoProfile -File .\scripts\install-ccx.ps1 -PackagePath $package
   ```

CCX 关联到 UPIA 后若仍无法双击安装，可使用上面的脚本传入安装参数并检查结果。Photoshop 的“打开文件”不能安装插件。

### 方式二：Portable 文件夹版

1. 保存文档并完全退出 Photoshop。
2. 解压 `ps-ai-0.5.0-portable-experimental.zip`，把整个 `PS-AI-FOR-ME` 文件夹复制到你实际安装的 Photoshop 的 `Plug-ins` 目录。
3. 确认目录结构是 `Plug-ins/PS-AI-FOR-ME/manifest.json`，不要多套一层文件夹。
4. 重启，从“增效工具 → PS-AI (Portable)”打开。

Portable 不需要 CCX 安装器，已在 Windows PS 27.0 测试文件夹加载和图像往返。其他版本及关闭开发人员模式时的加载情况尚未测试。若 Photoshop 无法识别该目录，可改用 CCX，或按文末的源码构建方式加载。

CCX 与 Portable 的设置和历史各自独立。切换前导出设置、保存需要的 PNG；历史不会自动迁移。更新时退出 PS，只替换本插件文件夹或安装新版 CCX；不要覆盖其他插件。卸载 Portable 时移除该文件夹，CCX 用 Creative Cloud 的插件管理卸载。设置、候选和历史保存在 Photoshop 的数据目录，不随程序文件夹移动。

## 选择平台

ComfyUI 直接连接已有后端。其他平台在面板保存 Key 后由随包启动器启动本地服务，需要 Windows、Node.js 24+ 和 Photoshop 启动授权。地址、模型分别保存，Key 不随配置导出。逐步说明及限制见 [平台配置](docs/setup/PLATFORMS.md)。

## 连接 ComfyUI

完整的安装、模型下载、版本和排错步骤在 [ComfyUI 配置指南](docs/setup/COMFYUI.md)。已有后端不需要重装：

1. 启动 ComfyUI，先在浏览器确认服务能打开。
2. 打开“设置 → 模型与连接”，选择 ComfyUI，填写地址，例如 `http://localhost:8188`、`http://localhost:8199` 或 `http://192.168.1.20:8188`。
3. 点“扫描模型”，选择兼容的生成模型、视觉／文本编码器和 VAE。
4. 点“保存配置”，再“连接”。配置会在重开面板后保留；语言也会保存。
5. 先用一张已保存的测试图运行“宿主诊断 → 图像往返验证”，再尝试一次生成。

迁移配置时，导出 JSON 并在另一台机器导入，再检查地址和模型是否可用。配置保存服务地址和模型相对文件名，不包含模型的本机绝对路径。切换后端后，旧任务需要回到原地址恢复或取消。

## 第一次使用

1. 先在“设置 → 模型与连接”配置平台，再回到“创作”选择工作区和模式，在已保存副本上准备来源。需要保护细节时先圈选保护范围并点“设为保护区”，再准备实际范围。
2. 普通编辑、移除、服装和角色参考选择要修改的区域；背景／场景选择要保留的主体；溶图选择要融入整图环境的前景主体。角色参考还需导入一张参考图。移除使用内置指令，无提示词字段；溶图补充描述可留空。
3. 光影重塑先选“当前选区”或“整张图像”，打开布光工作台，编辑灯光并明确“生成 AI 结果”。特效／氛围默认参考当前图片与选区；纯文字素材和文字生图不需要图像选区。
4. 其他模式按需填描述，预览范围，再点“生成候选”。ComfyUI 采样时显示实际步数；云端只显示阶段。断线后用“恢复任务”查询原 ID，不要重复提交。
5. 检查结果的结构、边缘和颜色，再应用为蒙版新图层或光影层组，也可“新文档”或“另存 PNG”。失效来源或不安全结果保留导出，不能强行回填。

背景／场景会自动关闭原透明轮廓保留、主体对齐和颜色匹配；ComfyUI 还会关闭范围辅助图。普通移除或扩大轮廓时，可关闭“编辑保留原透明轮廓”。主体对齐依据透明边界，可能改变比例；颜色匹配只修正小幅整体偏色。

## 使用前要知道

- 请用已保存的副本测试，不要拿唯一未保存的原稿试。生成期间不要修改来源文档；修改、关闭或重载插件后需重新捕获。
- 选区内的文字、面部、手和衣服结构可能被模型改变。范围辅助图只是视觉参考；最终像素保护由回填蒙版完成。
- CMYK、Lab、索引色、位图、多通道和 32 位 HDR 暂不支持。在 RGB 副本中处理；不会自动转换原稿。默认 8 位输出；16 位 SDR 输出需要安装专用保存节点，并使用 16 位目标文档。16 位文件不代表模型具有完整 16 位有效精度。
- 半透明多层合成可能无法找到安全的剪贴底层。遇到提示时，在副本合并可见层后重新生成，或先导出 PNG 手工合成。
- 当前文档 ICC 优先保留。无 ICC 来源仅在精确授权原文件并确认支持的 sRGB 声明后创建工作副本；无法确认时，请先核对真实色彩并在副本指定正确配置。模型也会改变光线与颜色，接缝仍需检查。
- Photoshop 整体退出曾在未加载本插件时复现，相关稳定性问题仍在排查。CCX 和 Portable 都可能受到影响。
- 插件、ComfyUI 或本机平台中转会保存历史、输入和输出；云端生成还会把图片、参考和提示词发到对应平台。反馈前检查私人图片、提示词或路径，只处理有权使用的素材。
- 预设 Qwen 2.1 的许可限定非商业研究／评估，商业使用需另行授权。插件开源与免费不改变模型的许可。[模型许可原文](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE)

## 从源码构建

```powershell
git clone https://github.com/ImMappyJ/ps-ai.git
cd ps-ai
npm ci
npm test
npm run build
```

在 PS“首选项 → 增效工具”启用开发人员模式并重启。通过 [Adobe UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/) 添加 `dist/plugin/manifest.json`，点击 Load。后端配置与发行包相同。

`npm run package` 会先运行测试、类型检查和构建，再在 `release/` 生成 CCX、Portable ZIP、环境工具 ZIP 和各自的 SHA256 校验文件。ComfyUI 和模型需单独准备。

**Actions → Build packages** 保留普通 CI 和手动构建。部署发行工作流后，推送严格的 `vX.Y.Z` 标签会自动校验、打包并发布；**Actions → Release** 可从默认分支对已有远端标签执行 `dry_run`（默认开启）。发布通道默认预发布；本地未推送代码不会进入远端构建。版本准备、首发、权限和原始批次恢复见[构建与发布](docs/development/RELEASING.md)。CI 通过不代表 Photoshop 实机验收。

## 反馈与参与开发

在 [Issues](https://github.com/ImMappyJ/ps-ai/issues) 提供系统、PS／插件／ComfyUI 版本、模型、显卡、复现步骤和脱敏错误。效果问题可以附有权公开的局部对比；不要上传完整崩溃转储或私人照片。

欢迎提交 PR，尽量让每次改动集中解决一个问题。克隆仓库后，先读[代码地图与开发约定](AGENTS.md#source-map)了解代码结构和开发约定。服务端重写与新增平台的契约见 [后端开发文档](docs/development/BACKEND.md)。提交前运行 `npm ci`、`npm test`、`npm run build`；改动工作流时，同步更新兼容清单和中英文说明。开发使用独立分支，讨论和评审放在 Issue／PR。交接笔记、调试记录和本机报告留在本地。

## 许可与鸣谢

代码采用 [GNU GPL v3.0](LICENSE)（GPL-3.0-only）。分发修改版或二进制时，应提供对应源码、构建脚本和许可证。权重另行授权，不包含在仓库或插件包中；截图也不授予其中第三方角色或素材的权利。

感谢以下项目提供的工具和参考：

| 项目名 | 项目地址 |
| --- | --- |
| Adobe UXP | <https://developer.adobe.com/photoshop/uxp/> |
| ComfyUI | <https://github.com/Comfy-Org/ComfyUI> |
| Qwen | <https://huggingface.co/Qwen> |
| ComfyUI-GGUF | <https://github.com/leejet/ComfyUI-GGUF> |
| UPNG.js | <https://github.com/photopea/UPNG.js> |
| @noble/hashes | <https://github.com/paulmillr/noble-hashes> |
| pako | <https://github.com/nodeca/pako> |
| OpenLayer | <https://github.com/MehranMarxian/OpenLayer> |
| Geekatplay ComfyUI-Photoshop | <https://github.com/GeekatplayStudio/ComfyUI-Photoshop> |

构建包包含运行依赖的许可声明。架构与交互参考了 OpenLayer 和 Geekatplay ComfyUI-Photoshop，未复制这两个项目的源码。本项目不是 Adobe 官方产品。
