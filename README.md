<p align="center"><img src="assets/brand/avatar.png" width="72" alt="PS-AI"></p>
<h1 align="center">PS-AI</h1>
<p align="center"><strong>简体中文</strong> · <a href="docs/README.en.md">English</a></p>

**圈选要改的地方，把 AI 结果带回 Photoshop 图层。**

局部换材质、移除杂物、换背景、改服装，或为画面重新布光。先比较候选，再应用为带可编辑蒙版的新图层；原图层保留，一次撤销可撤回一次应用。

[下载 0.5.2 实验版](https://github.com/ImMappyJ/ps-ai/releases/tag/v0.5.2) · [图文教程](docs/usage/USER_GUIDE.md) · [从零配置 ComfyUI](docs/setup/COMFYUI.md#beginner) · [连接云平台](docs/setup/PLATFORMS.md)

<p align="center"><a href="assets/guide/workflow-overview.png"><img src="assets/guide/workflow-overview.png" width="960" alt="PS-AI 概览：当前 Photoshop 创作面板实拍，以及已有真实布光和换背景输出"></a></p>

上图是组合概览：左为发行准备时在 Photoshop 中使用独立 Preview 演示标识的创作面板实拍，右为已有真实 Qwen-Image 2.1 输出与本地合成预览，非单张宿主截图。新界面仅预览并填写草稿，没有提交新的生成。布光示例使用 `3F3F3F.webp` 与生成房间，光效还原 1／细节保护 0.65；效果对比非 Photoshop 回填实拍，见[布光教程](docs/usage/USER_GUIDE.md#relight)。

> **版本说明：**本页对应 **0.5.2 实验版**，包含引导界面、自动色彩工作副本与溶图光影方式。请核对下载包与“设置”中的版本／构建标识；旧版界面与行为可能不同。新版本完整宿主回归及全新机器安装仍待验证；云平台适配已有离线测试，真实 Key 出图仍待验证。

首次本地使用顺序：安装插件 → 下载并解压 ComfyUI Portable → 安装指定 GGUF 节点及依赖 → 放好三个模型 → 启动并连接 → 生成一张、检查图层并撤销；步骤见[从零配置 ComfyUI](docs/setup/COMFYUI.md#beginner)。

## 三步完成一次编辑

1. **连接。** 启动已有 ComfyUI，在“设置 → 模型与连接”填写地址、扫描模型并连接；已有模型无需重下。也可配置自己的云平台 Key。
2. **圈选并描述。** 打开图片副本，选模式、圈范围，点“预览选区”。橙色可改、蓝色保护、灰色只供参考；换背景时选要保留的主体，无需反选。
3. **比较后应用。** 生成 1–4 张候选，检查结构、边缘和颜色，再“应用为新图层”；也可另存 PNG。生成时保持来源不变，断线到历史恢复原任务。

创作页按“选择任务 → 来源与范围 → 生成与输出”排列；保护区、参考图和细项按需展开。十一种模式与完整操作见[使用指南](docs/usage/USER_GUIDE.md)。

## 需要准备什么

| 项目 | 要求 |
| --- | --- |
| Photoshop | Windows Photoshop 2026 / 27.0+；实测 27.0，macOS 未测试 |
| 本地生成 | 单独安装兼容 ComfyUI、Qwen-Image 2.1 GGUF 与节点；三个预设模型约 14.63 GB，另留依赖与缓存空间 |
| 本机参考配置 | RTX 5080 16 GiB、约 48 GB 内存；最低硬件配置尚未确定 |
| 云端生成 | Nano Banana（Gemini）、GPT Image（OpenAI Images）或百炼的 Key 与模型权限；自动中转需 Windows、Node.js 24+ 与宿主启动授权 |

本地使用固定 Qwen 2.1 工作流，不能直接替换成 SD、SDXL 或 Flux。版本、模型文件和测试边界见[兼容清单](config/compatibility.json)。

## 安装发行包

从 [Release](https://github.com/ImMappyJ/ps-ai/releases/tag/v0.5.2) 选择一种插件包，核对同名 `.sha256`：

| 安装方式 | 怎么做 |
| --- | --- |
| **CCX** | 安装 Adobe Creative Cloud 桌面应用，双击 `ps-ai-0.5.2-experimental.ccx`，按 Adobe 提示安装；重启后打开“增效工具 → PS-AI” |
| **Portable** | 完全退出 Photoshop，解压 `ps-ai-0.5.2-portable-experimental.zip`，将整个 `PS-AI-FOR-ME` 放入 Photoshop 的 `Plug-ins`；确认 `manifest.json` 直接在该文件夹下，再重启 |

已有 Portable 在 Windows PS 27.0 加载使用的记录，不代表 0.5.2 完整宿主回归已完成；其他版本及关闭开发人员模式时的加载未测试。CCX 不要当图片打开，也不要复制进 Plug-ins。环境工具包只含脚本和说明，不含 ComfyUI 或权重。

<details>
<summary>CCX 双击无反应、更新与卸载</summary>

解压同版本环境工具包，在解压目录运行：

```powershell
$package = Read-Host 'CCX 文件完整路径'
powershell.exe -NoProfile -File .\scripts\install-ccx.ps1 -PackagePath $package
```

更新前退出 PS，备份设置和需要的 PNG。Portable 只替换或移除本插件文件夹；CCX 通过 Creative Cloud 管理。两种形式的数据分别保存，历史不自动迁移，移除程序文件也不清除历史。

</details>

## 使用前了解

- **效果需要检查。** 脸、文字、纹理和轮廓可能变化，角色参考不保证身份一致；不提供常规磨皮、去痘精修。光影层与溶图仍可能留下光斑或削弱细窄阴影，真人溶图变化可能偏弱。图片参考特效／氛围尚未达到视觉验收目标。
- **颜色有边界。** 优先采用 Photoshop 当前 ICC；未标记 RGB8/16 无法确认色彩时，0.5.2 在独立的“假定 sRGB”副本中继续，可能偏色。参考图仍需明确色彩。模型输入为 sRGB8，SDR16 不等于原生 16 位生成或 HDR。
- **保留原稿。** 支持 RGB／已知色彩的灰度 8/16 位，文档上限 4500 万像素、单边 30000；不支持 CMYK、Lab、索引色、多通道或 32 位 HDR。来源改变、关闭或会话失效后，旧候选保留导出但不能强行回填；原尺寸交付请应用后通过 Photoshop 导出。
- **确认数据与许可。** 图片、参考和提示词发送给所选后端；本地服务也可保存输入输出。Qwen 2.1 权重限非商业研究／评估，商业使用需另获授权，见[模型许可](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE)。

## 文档导航

| 想做什么 | 文档 |
| --- | --- |
| 第一次编辑、选模式、用结果与历史 | [使用指南](docs/usage/USER_GUIDE.md) |
| 从零安装后端、放置模型、连接并完成第一张图，或复用已有服务 | [从零配置 ComfyUI](docs/setup/COMFYUI.md#beginner) |
| 用云平台 | [平台配置](docs/setup/PLATFORMS.md) · [百炼](docs/providers/BAILIAN.md) · [Gemini](docs/providers/GEMINI.md) · [OpenAI](docs/providers/OPENAI.md) |
| 修改源码、了解安全契约 | [开发指南](AGENTS.md) · [后端契约](docs/development/BACKEND.md) · [布光实现](docs/development/RELIGHT.md) · [发行指南](docs/development/RELEASING.md) |

## 从源码构建

使用 Node.js 24 和 PowerShell 7（`pwsh` 在 PATH 中）：

```powershell
git clone https://github.com/ImMappyJ/ps-ai.git
cd ps-ai
npm ci
npm test
npm run build
```

在 Photoshop“首选项 → 增效工具”开启开发人员模式并重启，用 [UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/) 加载 `dist/plugin/manifest.json`。`npm run package` 运行测试、类型检查和构建，再生成发行归档与 SHA256；已发布标签固定源码，分支文档可能更新更晚。

## 反馈与许可

[提交问题](https://github.com/ImMappyJ/ps-ai/issues)时附系统、Photoshop／插件版本、后端、模型、复现步骤和脱敏错误。不要公开私人图片、Key、本机日志或完整崩溃转储。代码为 [GPL-3.0-only](LICENSE)；分发需提供对应源码、构建脚本和许可。权重、服务和素材另遵其许可。本项目不是 Adobe 官方产品。

感谢 [Adobe UXP](https://developer.adobe.com/photoshop/uxp/)、[ComfyUI](https://github.com/Comfy-Org/ComfyUI)、[Qwen](https://huggingface.co/Qwen)、[ComfyUI-GGUF](https://github.com/leejet/ComfyUI-GGUF)、[UPNG.js](https://github.com/photopea/UPNG.js)、[@noble/hashes](https://github.com/paulmillr/noble-hashes) 和 [pako](https://github.com/nodeca/pako)。架构与交互参考 [OpenLayer](https://github.com/MehranMarxian/OpenLayer) 和 [Geekatplay ComfyUI-Photoshop](https://github.com/GeekatplayStudio/ComfyUI-Photoshop)，未复制其源码。运行依赖许可随包提供。
