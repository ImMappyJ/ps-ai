# PS-AI {{TAG}} · {{CHANNEL}}

## 中文

本版本通道：**{{CHANNEL}}**。标签对应源码：[{{SOURCE_SHA}}]({{SOURCE_URL}})。[该版本提交记录]({{COMMITS_URL}})；实际变更与贡献者由下方 GitHub 生成信息和比较链接补充。

### 0.5.2 的主要变化

- **更清楚的创作流程**：按选择任务、来源与范围、生成与输出整理面板，按当前状态给出下一步；参考图和高级选项按需展开。
- **读取来源不再要求另选原图**：优先采用 Photoshop 当前文档 ICC，导入图层不会被当作另一个原文件。未标记 RGB8/16 无可靠色彩证明时，在保留原图层与选区的独立“假定 sRGB”副本中继续，并明确提示近似色彩；未知灰度与不支持模式仍阻止。
- **从零配置 ComfyUI**：双语指南覆盖官方下载与解压、指定 leejet GGUF 节点、便携版 Python 安装依赖、三个模型的固定来源与准确目录、启动连接、首张生成及应用撤销。不是只下载后端和模型就能保证运行。
- **减少部署猜测**：模型扫描只按精确预设名或唯一同名相对路径补全；环境工具复用已有安装，检查节点、文件大小和 SHA256，不自动安装或覆盖后端。
- **溶图保留更多原图细节**：光影方式提取局部 RGB 明暗与光色，保留 AI 重绘选择；本地光效与细节调节复用已保存结果，不重新提交生成。
- **精简公开文档**：更新中英文首页、使用指南和真实面板预览，保留云端模型配置入口及各功能的验证边界。

验证：发行准备的 987 项离线测试、类型检查、生产构建与归档检查通过；自动发行还会针对该标签再次执行完整门禁。新面板截图来自 Photoshop 27 独立 Preview 的草稿／只读模型扫描，没有提交新生成。0.5.2 的 CCX／Portable 安装、完整面板交互、自动近似色彩副本和新版溶图光影仍缺少独立原生验收；历史宿主记录不转化为本版本的新验收结论。

### 已知限制

这仍是实验性通道。平台真实 Key、其他宿主／系统、全模式安装与长期稳定性不是离线测试的保证。当前图片＋选区素材的五个真实 ComfyUI 样本视觉检查失败；溶图的有限 Qwen 对照中真人变化仍弱；光影层对真实照片和原图细节的视觉保真仍需人工验收。请按指南选择模式并检查原始输出，不把透明像素、成功回填或受控样本当作视觉质量通过。

- [CCX 插件包]({{CCX_URL}})：通过 Adobe Creative Cloud 桌面应用安装；双击无反应时，使用同版本环境工具的 `scripts/install-ccx.ps1 -PackagePath`。不要用 Photoshop 的“打开”导入。
- [Portable 插件包]({{PORTABLE_URL}})：解压后将完整 `PS-AI-FOR-ME` 文件夹复制到实际 Photoshop 安装目录的 `Plug-ins`，清单直接位于该文件夹下。
- [环境工具包]({{ENVIRONMENT_URL}})：包含后端检查、已有环境准备、CCX 安装脚本、配置示例、使用指南及独立平台网关；不含 ComfyUI、Node.js、模型或 API Key。
- 每个包均附同名 `.sha256`；`release-manifest.json` 记录本批文件大小、SHA256、源码和工作流身份。这些是完整性校验，不是数字签名。

安装或更新前保存文档并退出 Photoshop。只保留一种插件安装形式；CCX 与 Portable 的设置、候选和历史不自动迁移，切换前导出设置和需要的 PNG。升级只替换本插件；旧会话候选需重新捕获后才能应用。详见[本版本中文指南]({{DOCS_ZH_URL}})。

manifest 的最低宿主为 Photoshop **{{HOST_MINIMUM}}**。现有人工记录主要来自 Windows Photoshop 27.0；这不代表所有支持版本、系统或安装方式均已验收。发行文件保留 `experimental` 命名；选择 stable 仅声明 GitHub 发行通道，不扩大验证范围。

自动流水线运行离线测试、类型检查、生产构建和归档校验。它不会运行 Photoshop、GPU 推理、下载大模型或调用付费平台。平台输出、新版面板、图像质量、颜色/透明度/16 位和安装的实际验收，以[该标签的说明]({{SOURCE_URL}})为准；CI 通过不等于 Photoshop 全模式实测通过。请在已保存副本中使用，检查结构、颜色和边缘。代码采用 GPL-3.0-only，权重另行授权。

## English

Release channel: **{{CHANNEL}}**. Tagged source: [{{SOURCE_SHA}}]({{SOURCE_URL}}). [Commits at this source]({{COMMITS_URL}}); GitHub-generated changes, contributors and the actual comparison link follow below.

### Main changes in 0.5.2

- **Guided creation flow**: task, source/range and output sections show a state-aware next action, with references and advanced controls collapsed until needed.
- **No original-file picker during source capture**: Photoshop's current document ICC takes priority, including imported-layer composites. Unresolved untagged RGB8/16 continues in a separate, explicitly approximate Assumed sRGB copy preserving original layers and selections. Unknown-profile Grayscale and unsupported modes still reject.
- **ComfyUI from zero**: bilingual instructions cover official download/extraction, the designated leejet GGUF node, dependencies installed with Portable's Python, pinned model sources and exact directories, startup, connection and first generation/apply/undo. Downloading a backend and three models alone does not guarantee readiness.
- **Less deployment guesswork**: model suggestions require exact preset names or unique relative matches. Environment tools reuse an existing installation and check nodes, file sizes and SHA256 without automatically installing or replacing the backend.
- **Detail-preserving Blend lighting**: local RGB fields transfer lighting over the original, with explicit AI redraw still available. Saved lighting/detail adjustments do not submit another generation.
- **Simpler public guides**: refreshed bilingual homepages, usage instructions and actual panel previews, retaining cloud setup and honest validation boundaries.

Validation: release preparation passed 987 offline tests, type checking, production builds and archive checks; release automation repeats the full gates on the tag. New panel screenshots use a separate Photoshop 27 Preview identity for drafts and read-only scanning, without new generation. Separate 0.5.2 CCX/Portable installation, full panel interaction, approximate color copies and new Blend lighting native acceptance remain pending. Historical host evidence does not establish new acceptance for this version.

### Known limits

This remains experimental. Offline tests do not establish live platform keys, every host/system, all-mode installation acceptance or long-term stability. Five real ComfyUI image-plus-selection asset samples failed visual inspection; portrait changes remained weak in the limited Qwen blending comparison. Real-photo lighting layers and original-detail fidelity still need human acceptance. Follow each mode's guide and inspect raw outputs; transparent pixels, successful application and controlled samples do not prove visual quality.

- [CCX plugin]({{CCX_URL}}): install through Adobe Creative Cloud desktop. If double-clicking does nothing, use `scripts/install-ccx.ps1 -PackagePath` from the matching environment tools. Photoshop File → Open does not install plugins.
- [Portable plugin]({{PORTABLE_URL}}): extract and copy the entire `PS-AI-FOR-ME` folder into the actual Photoshop `Plug-ins` directory, with its manifest directly inside that folder.
- [Environment tools]({{ENVIRONMENT_URL}}): backend checks, preparation for an existing environment, CCX installer, examples, guides and the standalone platform gateway. ComfyUI, Node.js, models and API keys are separate.
- Each package has a matching `.sha256`. `release-manifest.json` records this batch's sizes, SHA256 hashes, source and workflow identity. These are integrity checks, not a digital signature.

Save documents and quit Photoshop before installation or upgrade. Keep one installation method. CCX and Portable use separate settings and history; export settings and required PNGs before switching. Replace only this plugin. Capture again before applying candidates from older sessions. See the [versioned English guide]({{DOCS_EN_URL}}).

The manifest requires Photoshop **{{HOST_MINIMUM}}** or later. Existing manual evidence mainly covers Windows Photoshop 27.0; it does not establish acceptance of every host, system or installation method. Archive names retain `experimental`; choosing stable only selects the GitHub release channel.

Automation runs offline tests, type checking, production builds and archive verification. It does not run Photoshop, GPU inference, model downloads or paid providers. Consult the [tagged source and guides]({{SOURCE_URL}}) for actual platform, panel, image, color/alpha/depth and installation acceptance. Passing CI does not establish full Photoshop acceptance. Use saved copies and inspect structure, colors and edges. Code: GPL-3.0-only; model licenses are separate.
