# PS-AI {{TAG}} · {{CHANNEL}}

## 中文

本版本通道：**{{CHANNEL}}**。标签对应源码：[{{SOURCE_SHA}}]({{SOURCE_URL}})。[该版本提交记录]({{COMMITS_URL}})；实际变更与贡献者由下方 GitHub 生成信息和比较链接补充。

### 0.6.1 的主要变化

- **大图溶图自动控制分析内存**：根据候选准备预算选择并保存分析尺寸，减少大照片在读取来源时因固定分析尺寸触发 `image-budget` 的情况。保留原生尺寸的选区／保护蒙版，以及用户选择的模型分辨率和输出位深。
- **普通编辑向外渐变融合**：在选区外增加渐变蒙版，默认 8 个原图像素，可调 0–64，设为 0 关闭。只用于普通编辑；溶图光影组、溶图 AI 重绘、布光、AI 素材和其他模式不启用。保护区继续生效，结果仍为带可编辑蒙版的新图层。
- **大范围普通编辑分段处理**：把候选准备也计入预算；需要时使用有界分析图和原生尺寸分段写入，避免仅来源读取可行、候选处理却超额。
- **历史与输出校验加固**：保存新的融合参数、原始选区与保护蒙版；重载时核对尺寸、来源、位深和蒙版关系。旧历史保持原行为；输出位深不符会在读取原图或解码前拒绝。
- **双语说明同步**：补充融合范围、预算行为和色彩支持边界。保留 0.6.0 的兼容 GGUF／Safetensors 加载路线与统一 AI 素材流程。

开发验证：实现提交通过 1073 项离线测试、类型检查、生产构建和 PR 打包 CI；正式包再由发布流水线完成测试、构建和归档校验。本次没有重新运行真实推理、安装后的面板交互或 Photoshop 原生照片验收；过去的宿主与推理记录仍以兼容清单中各自的日期和范围为准。

发布依据：2026-11-01，用户在实现 PR 合并后明确要求发布新版本。这是发布授权，不是新版照片、蒙版边缘或安装验收通过的反馈。0.6.0 的用户候选测试记录单独保留，不扩展为本次新功能的验收。

### 已知限制

保留 512 MB 图像内存预算、4500 万文档像素、边长与 PNG 解码保护；不能保证任意大图片都能处理。本次没有新增色彩空间支持：现有 RGB／已解析配置文件的灰度 8/16 位路径继续保留，模型输入仍为 sRGB8；溶图光影提取仍要求已标记的 sRGB RGB8/16 和可编辑范围不透明，CMYK、Lab 和 32 位 HDR 等仍不支持。向外渐变可以缓和接缝，但不能保证消除生成内容的色差。

本次发布为正式通道，但不保证所有模型组合和使用场景。新大图路径、蒙版边缘、真实照片光影保真和安装交互仍需实际检查。平台真实 Key、其他宿主／系统、全模式安装与长期稳定性不由离线测试保证。旧 `selection-v1` 素材的五个真实 ComfyUI 样本视觉检查失败，这不是 `subject-v1` 三图流程的测试结论；有限 Qwen 溶图对照中真人变化仍弱。请检查原始输出，不把透明像素或成功回填当作视觉质量通过。

- [CCX 插件包]({{CCX_URL}})：通过 Adobe Creative Cloud 桌面应用安装；双击无反应时，使用同版本环境工具的 `scripts/install-ccx.ps1 -PackagePath`。不要用 Photoshop 的“打开”导入。
- [Portable 插件包]({{PORTABLE_URL}})：解压后将完整 `PS-AI-FOR-ME` 文件夹复制到实际 Photoshop 安装目录的 `Plug-ins`，清单直接位于该文件夹下。
- [环境工具包]({{ENVIRONMENT_URL}})：包含后端检查、已有环境准备、CCX 安装脚本、配置示例、使用指南及独立平台网关；不含 ComfyUI、Node.js、模型或 API Key。
- 每个包均附同名 `.sha256`；`release-manifest.json` 记录本批文件大小、SHA256、源码和工作流身份。这些是完整性校验，不是数字签名。

安装或更新前保存文档并退出 Photoshop。只保留一种插件安装形式；CCX 与 Portable 的设置、候选和历史不自动迁移，切换前导出设置和需要的 PNG。升级只替换本插件；旧会话候选需重新捕获后才能应用。详见[本版本中文指南]({{DOCS_ZH_URL}})。

manifest 的最低宿主为 Photoshop **{{HOST_MINIMUM}}**。现有人工记录主要来自 Windows Photoshop 27.0；这不代表所有支持版本、系统或安装方式均已验收。发行文件保留 `experimental` 命名；选择 stable 仅声明 GitHub 发行通道，不扩大验证范围。

自动流水线运行离线测试、类型检查、生产构建和归档校验。它不会运行 Photoshop、GPU 推理、下载大模型或调用付费平台。平台输出、新版面板、图像质量、颜色/透明度/16 位和安装的实际验收，以[该标签的说明]({{SOURCE_URL}})为准；CI 通过不等于 Photoshop 全模式实测通过。请在已保存副本中使用，检查结构、颜色和边缘。代码采用 GPL-3.0-only，权重另行授权。

## English

Release channel: **{{CHANNEL}}**. Tagged source: [{{SOURCE_SHA}}]({{SOURCE_URL}}). [Commits at this source]({{COMMITS_URL}}); GitHub-generated changes, contributors and the actual comparison link follow below.

### Main changes in 0.6.1

- **Adaptive analysis memory for large Blend sources**: choose and persist analysis dimensions within the candidate-preparation budget, reducing `image-budget` capture failures caused by fixed analysis sizes. Native selection/protection masks, requested model resolution and output depth remain intact.
- **Outward gradient masks for ordinary editing**: add an outward transition of 8 native pixels by default, adjustable from 0 to 64; 0 disables it. Only ordinary edit mode uses this behavior. Blend lighting, Blend AI redraw, Relight, AI assets and other modes are excluded. Protection remains effective and the result retains an editable layer mask.
- **Bounded processing for large ordinary edits**: account for candidate preparation as well as capture, using a bounded analysis raster and native-size strip writing when necessary.
- **Stronger history and output validation**: persist the new transition settings, raw selection and protection planes, then validate dimensions, source, depth and mask relationships when reloading. Legacy history retains its behavior. Output depth mismatches reject before source reads or decoding.
- **Updated bilingual guidance**: document transition scope, budgeting and color limits, retaining the compatible GGUF/Safetensors routes and unified AI assets introduced in 0.6.0.

Development validation: the implementation passed 1073 offline tests, type checking, a production build and PR package CI. The release workflow tests, rebuilds and verifies the final archives. No new live inference, installed-panel interaction or native Photoshop photo acceptance was performed for these changes. Earlier host and inference evidence retains the dates and scope recorded in the compatibility manifest.

Release basis: on 2026-11-01, the user explicitly requested a new release after the implementation PR was merged. This authorizes publication; it is not a new photo, mask-edge or installation acceptance report. The 0.6.0 candidate test remains a separate historical record.

### Known limits

The 512 MB image-memory budget, 45-million-pixel document cap, side-length and PNG decode guards remain. Arbitrarily large images are not guaranteed to fit. This release adds no new color-space support: existing RGB and resolved-profile Grayscale 8/16-bit paths remain, with sRGB8 model inputs. Blend lighting still requires tagged sRGB RGB8/16 with opaque editable coverage. CMYK, Lab, 32-bit HDR and other unsupported modes remain excluded. Outward gradients can soften seams but cannot guarantee removal of generated color differences.

This is a stable-channel release, not a guarantee of every model combination or scenario. New large-source paths, mask edges, photographic lighting fidelity and installation interactions still need actual inspection. Offline tests do not establish live platform keys, every host/system, all-mode installation acceptance or long-term stability. Five historical `selection-v1` ComfyUI asset samples failed visual inspection, which is not a verdict for the `subject-v1` three-image flow. Portrait changes remained weak in limited Qwen Blend comparisons. Transparent pixels and successful application do not prove visual quality.

- [CCX plugin]({{CCX_URL}}): install through Adobe Creative Cloud desktop. If double-clicking does nothing, use `scripts/install-ccx.ps1 -PackagePath` from the matching environment tools. Photoshop File → Open does not install plugins.
- [Portable plugin]({{PORTABLE_URL}}): extract and copy the entire `PS-AI-FOR-ME` folder into the actual Photoshop `Plug-ins` directory, with its manifest directly inside that folder.
- [Environment tools]({{ENVIRONMENT_URL}}): backend checks, preparation for an existing environment, CCX installer, examples, guides and the standalone platform gateway. ComfyUI, Node.js, models and API keys are separate.
- Each package has a matching `.sha256`. `release-manifest.json` records this batch's sizes, SHA256 hashes, source and workflow identity. These are integrity checks, not a digital signature.

Save documents and quit Photoshop before installation or upgrade. Keep one installation method. CCX and Portable use separate settings and history; export settings and required PNGs before switching. Replace only this plugin. Capture again before applying candidates from older sessions. See the [versioned English guide]({{DOCS_EN_URL}}).

The manifest requires Photoshop **{{HOST_MINIMUM}}** or later. Existing manual evidence mainly covers Windows Photoshop 27.0; it does not establish acceptance of every host, system or installation method. Archive names retain `experimental`; choosing stable only selects the GitHub release channel.

Automation runs offline tests, type checking, production builds and archive verification. It does not run Photoshop, GPU inference, model downloads or paid providers. Consult the [tagged source and guides]({{SOURCE_URL}}) for actual platform, panel, image, color/alpha/depth and installation acceptance. Passing CI does not establish full Photoshop acceptance. Use saved copies and inspect structure, colors and edges. Code: GPL-3.0-only; model licenses are separate.
