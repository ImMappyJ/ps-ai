<img src="assets/icon.png" width="72" alt="PS-AI FOR ME">

# PS-AI FOR ME

**简体中文** · [English](README.en.md)

把 ComfyUI 接到 Photoshop：圈选一块区域，写下想改的内容，生成几个候选，再作为带蒙版的新图层放回原图。主要用于局部修图、COSPLAY 服装和道具处理，也可以生成图片或特效、氛围素材。

当前版本 **0.3.0，实验版**。适合愿意检查生成结果、自己做最后合成的用户。常规人像磨皮、去痘和肤色精修不在项目范围内。

## 看看效果

下面是用户提供的真实 Photoshop 截图，示例把局部服装／腿部材质改为白色。截图来自旧版面板，展示的是实际效果，不是新版界面示意图。模型每次生成的结果会有差异。

| 使用前 | 使用后 |
| --- | --- |
| ![修改前](assets/1.png) | ![修改后](assets/2.png) |

## 能做什么

- **局部修图**：物体和材质修改、移除杂物、替换背景。选区外和手动保护区保留原始像素。
- **COSPLAY**：服装／道具修复、场景修改、一张角色参考图辅助。参考功能是实验性的，不保证角色和服装细节准确复现。
- **生图与素材**：文字生图，生成特效或氛围素材，在新文档打开或导出 PNG。透明素材仍可能有底色和杂边。
- **候选与回填**：1–4 张串行候选，实际采样步数进度，历史、断线恢复、按任务取消。应用为独立图层和可编辑蒙版，支持一次撤销。
- **透明与颜色**：默认保留原透明轮廓，可选主体对齐和小幅上下文颜色匹配。RGB／灰度 8/16 位已做过真机往返验证；模型输入仍是 sRGB 8-bit。
- **连接与语言**：保存 ComfyUI 地址、端口及模型文件映射，导入／导出 JSON；面板可切换简体中文和 English。

当前使用固定的 **Qwen-Image 2.1 GGUF 工作流**。换文件名不等于支持 SD、SDXL 或 Flux。支持范围和适配约定见 [ComfyUI 配置指南](COMFYUI.md)。

## 系统要求

| 项目 | 要求与已测试范围 |
| --- | --- |
| 系统／宿主 | Windows，Photoshop 2026 / 27.0+；目前只实测 27.0，macOS 未验收 |
| 推理后端 | 兼容的 ComfyUI 与 GGUF 节点；已测试版本和提交见 [兼容清单](config/compatibility.json) |
| 显卡／内存 | 实测 NVIDIA RTX 5080 16 GiB、约 48 GB RAM；这是测试配置，不是最低配置承诺 |
| 磁盘 | 预设三个权重约 14.63 GB，另留后端、依赖、缓存和图片空间 |
| 源码构建 | Node.js 24.21.0、npm 11.19.0 已测试；安装发行包不需要 Node.js 或开发工具 |

后端可以在本机，也可以在可访问的另一台机器上。插件会把图像和提示词发给你填写的地址，请使用自己信任的服务。带登录、API Key 或子路径的云服务目前没有专门适配。

## 安装发行包

从仓库的 [Releases](https://github.com/ImMappyJ/ps-ai/releases) 下载同版本插件包和环境工具。若没有已发布版本，请从源码构建；主分支不是稳定版承诺。两种安装方式选一种即可。

### 方式一：CCX

1. 安装 Adobe Creative Cloud 桌面应用，双击 `ps-ai-0.3.0-experimental.ccx`，按 Adobe 安装提示操作。
2. 重启 Photoshop，从“增效工具 → PS-AI FOR ME”打开面板。
3. 如果双击没有反应，解压同版本 `environment-experimental.zip`，在其目录运行：

   ```powershell
   $package = Read-Host 'CCX 文件完整路径'
   powershell.exe -NoProfile -File .\scripts\install-ccx.ps1 -PackagePath $package
   ```

直接把 CCX 关联到 UPIA 不代表双击就一定能完成安装；上面的脚本会传递 `/install` 和包路径，并检查安装结果。不要用 Photoshop“打开文件”来安装。

### 方式二：Portable 文件夹版

1. 保存文档并完全退出 Photoshop。
2. 解压 `ps-ai-0.3.0-portable-experimental.zip`，把整个 `PS-AI-FOR-ME` 文件夹复制到你实际安装的 Photoshop 的 `Plug-ins` 目录。
3. 确认目录结构是 `Plug-ins/PS-AI-FOR-ME/manifest.json`，不要多套一层文件夹。
4. 重启，从“增效工具 → PS-AI FOR ME (Portable)”打开。

这条路径不调用 CCX 安装器。Windows PS 27.0 已验证文件夹加载和图像往返；其他宿主版本、关闭开发人员模式的加载表现仍待验证。若当前安装不识别该目录，可使用 CCX，或按下方开发者方式加载构建结果。

CCX 与 Portable 的设置和历史各自独立。切换前导出设置、保存需要的 PNG；历史不会自动迁移。更新时退出 PS，只替换本插件文件夹或安装新版 CCX；不要覆盖其他插件。卸载 Portable 时移除该文件夹，CCX 用 Creative Cloud 的插件管理卸载。用户数据不随程序文件夹移动。

## 连接 ComfyUI

完整的安装、模型下载、版本和排错步骤在 [ComfyUI 配置指南](COMFYUI.md)。已有后端不需要重装：

1. 启动 ComfyUI，先在浏览器确认服务能打开。
2. 展开面板“模型与连接”，填写地址，例如 `http://localhost:8188`、`http://localhost:8199` 或 `http://192.168.1.20:8188`。
3. 点“扫描模型”，选择兼容的生成模型、视觉／文本编码器和 VAE。
4. 点“保存配置”，再“连接”。配置会在重开面板后保留；语言也会保存。
5. 先用一张已保存的测试图运行“宿主诊断 → 图像往返验证”，再尝试一次生成。

需要迁移配置时，导出 JSON 后在另一台机器导入，再检查地址和模型是否可用。配置只记录服务地址与后端相对文件名，不记录开发者的磁盘路径。切换后端后，旧任务必须回到原地址恢复或取消。

## 第一次使用

1. 在已保存的副本上建立编辑选区。需要保护脸、手等细节时，先圈选保护范围，点“设为保护区”，再重选编辑区。
2. 选任务模式，说明要改什么、保留什么。角色参考模式需要额外选择一张 PNG／JPEG。
3. 点“生成候选”。加载模型和文本编码阶段不一定有采样百分比，开始采样后显示实际步数。断线后用“恢复任务”，不要重复提交。
4. 检查候选的结构、边缘和颜色，再“应用为新图层”。用 Photoshop 的蒙版、不透明度和调整层完成最后合成。
5. 生图或独立素材可选“新文档”，也可“另存 PNG”。

**换背景、移除对象或扩大轮廓时，关闭“编辑保留原透明轮廓”。** 主体对齐依据透明边界，可能改变比例，不合适就关闭。颜色匹配只修正小幅整体偏色，不能代替手工调色。

## 使用前要知道

- 请用已保存的副本测试，不要拿唯一未保存的原稿试。生成期间不要修改来源文档；修改、关闭或重载插件后需重新捕获。
- 选区内的文字、面部、手和衣服结构可能被模型改变。范围辅助图只是视觉参考；最终像素保护由回填蒙版完成。
- CMYK、Lab、索引色、位图、多通道和 32 位 HDR 暂不支持。在 RGB 副本中处理；不会自动转换原稿。16 位来源保留格式，但生成结果不具有原生 16 位细节。
- 半透明多层合成可能无法找到安全的剪贴底层。遇到提示时，在副本合并可见层后重新生成，或先导出 PNG 手工合成。
- 未标记 ICC 的图片应先在副本指定正确配置文件。模型也会改变光线与颜色，接缝仍需检查。
- Photoshop 整体退出曾在未加载本插件时复现，长期宿主稳定性没有通过全面验收。换成文件夹安装不代表修复崩溃。
- 本机插件和 ComfyUI 会保存历史、输入和输出。反馈前检查是否包含私人图片、提示词或路径，只处理有权使用的素材。
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

`npm run package` 会先测试、构建，再在 `release/` 生成 CCX、Portable ZIP、环境工具 ZIP 和各自的 SHA256。构建不依赖本地交接文档，不下载模型、不启动后端，也不自动发布 Release。

仓库的 **Actions → Build packages → Run workflow** 可以手动生成同样的包。下载构建产物后解开外层 ZIP，再将其中的发行文件和校验文件上传到你手动创建的 GitHub Release。版本号须在 `package.json`、锁文件和 `plugin/manifest.json` 中保持一致。Actions 仅做构建检查，不能代替 Photoshop 真机验收。

## 反馈与参与开发

在 [Issues](https://github.com/ImMappyJ/ps-ai/issues) 提供系统、PS／插件／ComfyUI 版本、模型、显卡、复现步骤和脱敏错误。效果问题可以附有权公开的局部对比；不要上传完整崩溃转储或私人照片。

欢迎小范围 PR。运行 `npm ci`、`npm test`、`npm run build`；改变工作流时同步更新兼容清单和双语说明。每项工作用自己的分支，设计讨论放 Issue／PR。交接、调试记录和本机报告不提交到公共仓库，避免多人共同修改一份任务进度文档。若两个人修改同一份公开指南，仍需正常处理 Git 冲突。

## 许可与鸣谢

代码采用 [GNU GPL v3.0](LICENSE)（GPL-3.0-only）。分发修改版或二进制时，应提供对应源码、构建脚本和许可证。权重另行授权，不包含在仓库或插件包中；截图也不授予其中第三方角色或素材的权利。

感谢 [Adobe UXP](https://developer.adobe.com/photoshop/uxp/)、[ComfyUI](https://github.com/Comfy-Org/ComfyUI)、[Qwen](https://huggingface.co/Qwen)、[ComfyUI-GGUF](https://github.com/leejet/ComfyUI-GGUF)、[UPNG.js](https://github.com/photopea/UPNG.js) 和 [pako](https://github.com/nodeca/pako)。构建包包含运行依赖的许可声明。架构与交互参考了 [OpenLayer](https://github.com/MehranMarxian/OpenLayer) 和 [Geekatplay ComfyUI-Photoshop](https://github.com/GeekatplayStudio/ComfyUI-Photoshop)，未复制这两个项目的源码。本项目不是 Adobe 官方产品。
