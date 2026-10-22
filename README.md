<p align="center"><img src="assets/brand/avatar.png" width="72" alt="PS-AI"></p>
<h1 align="center">PS-AI</h1>
<p align="center"><strong>简体中文</strong> · <a href="docs/README.en.md">English</a></p>

在 Photoshop 里圈选、描述、生成，再把结果放回独立图层。PS-AI 支持局部修改、换背景、服装道具、布光、溶图和文字生图，不用来回导出图片。

**当前版本：0.5.0，实验性预发布。** 可连接本地 ComfyUI / Qwen-Image 2.1，也提供 Nano Banana（Gemini）、GPT Image（OpenAI Images）和百炼适配。云端需要自己的 API Key，尚未完成真实账号出图验证。

[下载 0.5.0](https://github.com/ImMappyJ/ps-ai/releases/tag/v0.5.0) · [使用指南](docs/usage/USER_GUIDE.md) · [ComfyUI 配置](docs/setup/COMFYUI.md) · [云平台配置](docs/setup/PLATFORMS.md)

## 能做什么

| 工作区 | 用途 |
| --- | --- |
| 局部修图 | 修改选中物体或材质、移除杂物、替换背景 |
| 人像 | 修改服装道具、参考角色外观、替换场景、光影重塑、溶图、生成特效或氛围素材 |
| 生图 | 根据文字生成图片，另存 PNG 或在新文档打开 |

每次可生成 1–4 张候选，先比较再应用。结果放在新图层和可编辑蒙版中，原图层保留；一次 Photoshop 撤销可撤回一次应用。历史记录用于查看候选、复用参数和恢复中断的任务。

![PS-AI 创作界面与演示图片](assets/guide/050-create-zh.png)

光影重塑有独立工作台，可添加和拖动光源，调整颜色、方向与强度，再生成 AI 结果。输出可选“光影层”或“整图重绘”。下图是**本地布光示意，不是模型出图效果**。

![光影重塑工作台](assets/guide/050-relight-zh.png)

截图来自 Photoshop 27 中的 0.5.0 Portable，演示图片为 `3F3F3F.webp`。点击图片可查看大图。

## 系统要求

- **Photoshop：**Windows Photoshop 2026 / 27.0+，目前实测 27.0；macOS 未测试。
- **本地生成：**兼容的 ComfyUI、Qwen-Image 2.1 GGUF 模型及节点，需另行安装。测试机器使用 RTX 5080 16 GiB 和约 48 GB 内存，尚未确定最低配置。
- **云端生成：**对应平台的 Key 和模型权限；自动启动本机中转需要 Windows、Node.js 24+ 及 Photoshop 的启动授权。

ComfyUI 使用固定的 Qwen 2.1 工作流，不能直接换成 SD、SDXL 或 Flux。模型文件约 14.63 GB，另外需要后端、依赖和缓存空间。具体版本见[兼容清单](config/compatibility.json)。

## 安装发行包

从 [0.5.0 Release](https://github.com/ImMappyJ/ps-ai/releases/tag/v0.5.0) 下载一种插件包，并核对同名 `.sha256` 文件。环境工具包提供配置说明和安装脚本，不包含 ComfyUI 或模型权重。

### 方式一：CCX

1. 安装 Adobe Creative Cloud 桌面应用。
2. 双击 `ps-ai-0.5.0-experimental.ccx`，按 Adobe 提示安装。
3. 重启 Photoshop，打开“增效工具 → PS-AI”。

双击无反应时，解压 `ps-ai-0.5.0-environment-experimental.zip`，在解压目录运行：

```powershell
$package = Read-Host 'CCX 文件完整路径'
powershell.exe -NoProfile -File .\scripts\install-ccx.ps1 -PackagePath $package
```

不要用 Photoshop 的“打开文件”安装 CCX。CCX 安装由 Adobe 管理，不需要复制进 Plug-ins。

### 方式二：Portable 文件夹版

1. 保存文档并完全退出 Photoshop。
2. 解压 `ps-ai-0.5.0-portable-experimental.zip`，把整个 `PS-AI-FOR-ME` 文件夹放进 Photoshop 安装目录的 `Plug-ins`。
3. 确认 `manifest.json` 直接位于 `Plug-ins/PS-AI-FOR-ME` 下，没有多套一层文件夹。
4. 重启，打开“增效工具 → PS-AI (Portable)”。

Portable 已在 Windows PS 27.0 加载使用；其他宿主版本及关闭开发人员模式时的加载尚未测试。无法识别时可使用 CCX 或[从源码构建](#从源码构建)。

**更新前退出 PS，并备份设置和需要的 PNG。** Portable 只替换本插件文件夹；卸载时移除该文件夹。CCX 用 Creative Cloud 管理。两种安装形式的数据各自独立，历史不会自动迁移；卸载程序文件也不等于清除历史数据。

## 第一次使用

1. **连接后端。** 在“设置 → 模型与连接”选择平台。本地 ComfyUI 填写 `http://localhost:8188` 等服务地址，扫描并选择生成模型、编码器和 VAE，保存配置后连接。云端按[平台配置](docs/setup/PLATFORMS.md)保存 Key。
2. **准备图片。** 打开已保存的副本，选择工作区和模式。普通编辑选要改的区域；换背景选要保留的主体，无需反选。需要保留细节时，先圈选并“设为保护区”。
3. **描述并生成。** 填写修改要求，点“预览选区”核对范围，再“生成候选”。移除不需要提示词；光影重塑在工作台里生成。
4. **检查并应用。** 比较结构、边缘和颜色，选择“应用为新图层”，或另存 PNG、打开新文档。生成期间保持来源不变。

断线后到“历史”选择原任务并“恢复任务”，它会查询原 ID，不会重新提交。十一种模式的具体操作见[图文使用指南](docs/usage/USER_GUIDE.md)。

## 使用限制

- **效果仍需检查。** 模型可能改变脸、文字、线条和纹理。角色参考不保证身份一致；不包含常规磨皮、去痘和肤色精修。
- **布光和溶图仍在改进。** 光影层是从 AI 参考图估计出的光照变化，不能保证完整保留细节；结构差异过大时会停止提取并保留参考图。真人溶图目前仍可能变化较弱。
- **图片参考素材质量尚未达标。** 特效／氛围素材可能残留原人物、背景或范围边界；请检查透明度，必要时改用纯文字素材或手工修整。
- **颜色与尺寸有边界。** 支持能确认色彩空间的 RGB／灰度 8/16 位来源。模型输入是 sRGB8，SDR16 保存不等于原生 16 位生成或 HDR。文档上限 4500 万像素、单边 30000；插件导出可能采用工作图尺寸，原尺寸交付请应用后通过 Photoshop 导出。
- **保留副本。** 不支持 CMYK、Lab、索引色、多通道和 32 位 HDR。无法确认色彩或安全处理半透明多层时会提示处理副本。来源修改、关闭或重开插件后，旧候选仍能导出，但不能强行回填。
- **确认数据与许可。** 图片和提示词发往所选后端；本地服务也会保留输入输出。Qwen 2.1 权重限非商业研究／评估，商业使用需另获授权，见[模型许可](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE)。

## 文档导航

| 要做什么 | 从这里开始 |
| --- | --- |
| 了解选区、各模式、候选和历史 | [使用指南](docs/usage/USER_GUIDE.md) |
| 安装本地后端与模型、排查连接 | [ComfyUI 配置](docs/setup/COMFYUI.md) |
| 配置云平台 | [平台配置](docs/setup/PLATFORMS.md) · [百炼](docs/providers/BAILIAN.md) · [Gemini](docs/providers/GEMINI.md) · [OpenAI](docs/providers/OPENAI.md) |
| 修改源码或扩展服务端 | [开发指南](AGENTS.md) · [后端契约](docs/development/BACKEND.md) · [布光实现](docs/development/RELIGHT.md) |
| 构建与发布 | [发行指南](docs/development/RELEASING.md) |

## 从源码构建

使用 Node.js 24 和 PowerShell 7（`pwsh` 在 PATH 中）：

```powershell
git clone https://github.com/ImMappyJ/ps-ai.git
cd ps-ai
npm ci
npm test
npm run build
```

在 Photoshop“首选项 → 增效工具”开启开发人员模式并重启，再用 [UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/) 加载 `dist/plugin/manifest.json`。

`npm run package` 运行测试、类型检查和构建，生成 CCX、Portable、环境工具包及 SHA256。主分支推送触发构建；版本标签触发 Release。已发布标签对应固定源码，main 的文档可能更新更晚。

## 反馈与许可

问题请提交到 [Issues](https://github.com/ImMappyJ/ps-ai/issues)，附系统、Photoshop／插件版本、后端、模型、复现步骤和脱敏错误。欢迎 PR；提交前阅读 [AGENTS.md](AGENTS.md) 并运行检查。私人图片、Key、本机日志和完整崩溃转储不要公开。

代码采用 [GPL-3.0-only](LICENSE)，分发修改版或二进制需提供对应源码、构建脚本和许可证。权重、云服务和截图素材分别遵循其许可；本项目不是 Adobe 官方产品。

感谢 [Adobe UXP](https://developer.adobe.com/photoshop/uxp/)、[ComfyUI](https://github.com/Comfy-Org/ComfyUI)、[Qwen](https://huggingface.co/Qwen)、[ComfyUI-GGUF](https://github.com/leejet/ComfyUI-GGUF)、[UPNG.js](https://github.com/photopea/UPNG.js)、[@noble/hashes](https://github.com/paulmillr/noble-hashes) 和 [pako](https://github.com/nodeca/pako)。架构与交互参考了 [OpenLayer](https://github.com/MehranMarxian/OpenLayer) 和 [Geekatplay ComfyUI-Photoshop](https://github.com/GeekatplayStudio/ComfyUI-Photoshop)，未复制两者源码。运行依赖的许可声明随构建包提供。
