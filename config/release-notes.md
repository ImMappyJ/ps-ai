# PS-AI {{TAG}} · {{CHANNEL}}

## 中文

本版本通道：**{{CHANNEL}}**。标签对应源码：[{{SOURCE_SHA}}]({{SOURCE_URL}})。[该版本提交记录]({{COMMITS_URL}})；实际变更与贡献者由下方 GitHub 生成信息和比较链接补充。

### 0.6.0 的主要变化

- **AI 素材统一入口**：将特效与氛围整合为“AI 素材”，提供物体／粒子和光效／氛围预设。
- **参考主体，独立放置**：主体参照与素材活动范围分开，支持主体周围／整张画布、前景叠加／主体遮挡；蝴蝶等素材不再被正向主体蒙版裁掉。保留原图层、素材透明度和可编辑放置蒙版，并提供仅素材／叠加预览；旧历史不改变语义。
- **Qwen 2.1 双加载路线**：兼容的 `.gguf` 主模型使用 `UnetLoaderGGUF`，兼容的 `.safetensors` 独立扩散权重使用 ComfyUI 内置 `UNETLoader(weight_dtype=default)`；原生路线不需要 GGUF 扩展。
- **按能力而不是固定文件选模型**：主模型、视觉／文本编码器、VAE 是三个组件角色，可以复用已有兼容文件；扫描保留明确选择，不自动换回 GGUF。扩展名、作者或列表可见性都不是兼容证明。
- **连接提示不再夸大**：显示所选加载路线和“节点已检查”，明确未验证当前权重；改变模型会使旧检查失效。检查不上传图片、不触发生成。
- **安全、可复现的验收工具**：P0 必须指定配置与新输出目录，只有 `--run` 才提交；配置、图、8/16 位解码一致，先检查完整节点契约，保存原 UUID 后提交，失联不重复生成。
- **双语从零教程同步**：区分已有／新装环境、GGUF／原生路线、示例组合／必需能力；保留云端 API 入口与未测范围。既有无原图选择器的色彩副本策略、历史、选区和撤销契约不变。

开发验收：固定 `qwen_image_2.1_int8_convrot.safetensors` 配现有 Qwen3-VL INT8 编码器及 Qwen 2.1 RGBA VAE 已完成真实推理；精确哈希、运行时与范围见兼容清单。后端含既有本地修改，不等于全新官方 Portable 复现。Photoshop 27 独立 API 检查通过小型 RGB8/16 的真实输出、可编辑蒙版、原始／范围外像素保护、单次撤销及注入取消回滚。

发布验收：2026-10-31，用户在收到 `44c2fd7b` Portable 候选后反馈“测试成功”，批准合并并发布正式版。该反馈作为本次发布依据；没有逐项测试记录，不将其扩展为所有模式、CCX、升级或全新机器均已验收。正式包由合并后的源码经发布流水线重新构建，构建标识与候选包不同。

### 已知限制

本次发布为正式通道，但不保证所有模型组合和使用场景。平台真实 Key、其他宿主／系统、全模式安装与长期稳定性不是离线测试或本次用户反馈的保证。旧 `selection-v1` 图片＋选区素材的五个真实 ComfyUI 样本视觉检查失败；这不是新 `subject-v1` 三图流程的测试结论，新流程仍需检查是否残留主体或背景。溶图的有限 Qwen 对照中真人变化仍弱；光影层对真实照片和原图细节的视觉保真仍需人工检查。请检查原始输出，不把透明像素、成功回填或受控样本当作视觉质量通过。

- [CCX 插件包]({{CCX_URL}})：通过 Adobe Creative Cloud 桌面应用安装；双击无反应时，使用同版本环境工具的 `scripts/install-ccx.ps1 -PackagePath`。不要用 Photoshop 的“打开”导入。
- [Portable 插件包]({{PORTABLE_URL}})：解压后将完整 `PS-AI-FOR-ME` 文件夹复制到实际 Photoshop 安装目录的 `Plug-ins`，清单直接位于该文件夹下。
- [环境工具包]({{ENVIRONMENT_URL}})：包含后端检查、已有环境准备、CCX 安装脚本、配置示例、使用指南及独立平台网关；不含 ComfyUI、Node.js、模型或 API Key。
- 每个包均附同名 `.sha256`；`release-manifest.json` 记录本批文件大小、SHA256、源码和工作流身份。这些是完整性校验，不是数字签名。

安装或更新前保存文档并退出 Photoshop。只保留一种插件安装形式；CCX 与 Portable 的设置、候选和历史不自动迁移，切换前导出设置和需要的 PNG。升级只替换本插件；旧会话候选需重新捕获后才能应用。详见[本版本中文指南]({{DOCS_ZH_URL}})。

manifest 的最低宿主为 Photoshop **{{HOST_MINIMUM}}**。现有人工记录主要来自 Windows Photoshop 27.0；这不代表所有支持版本、系统或安装方式均已验收。发行文件保留 `experimental` 命名；选择 stable 仅声明 GitHub 发行通道，不扩大验证范围。

自动流水线运行离线测试、类型检查、生产构建和归档校验。它不会运行 Photoshop、GPU 推理、下载大模型或调用付费平台。平台输出、新版面板、图像质量、颜色/透明度/16 位和安装的实际验收，以[该标签的说明]({{SOURCE_URL}})为准；CI 通过不等于 Photoshop 全模式实测通过。请在已保存副本中使用，检查结构、颜色和边缘。代码采用 GPL-3.0-only，权重另行授权。

## English

Release channel: **{{CHANNEL}}**. Tagged source: [{{SOURCE_SHA}}]({{SOURCE_URL}}). [Commits at this source]({{COMMITS_URL}}); GitHub-generated changes, contributors and the actual comparison link follow below.

### Main changes in 0.6.0

- **Unified AI assets**: effects and atmosphere share one entry, with object/particle and lighting/atmosphere prompt presets.
- **Reference the subject, place assets independently**: separate subject guidance from placement; choose the surrounding area or full canvas and front overlay or subject occlusion. Butterflies are no longer clipped by a positive subject mask. Keep original layers, asset alpha and an editable placement mask, with asset-only/composite previews. Historical tasks keep their original semantics.
- **Two Qwen 2.1 loader routes**: compatible `.gguf` diffusion weights use `UnetLoaderGGUF`; compatible standalone `.safetensors` diffusion weights use built-in `UNETLoader(weight_dtype=default)`, without the GGUF extension.
- **Capability-based model choice**: diffusion, vision/text encoder and VAE are three component roles, not three mandatory filenames. Reuse compatible existing files; scanning preserves explicit choices without silently switching back to GGUF. Format, author and inventory visibility do not prove compatibility.
- **Honest connection evidence**: the panel shows the selected route and Nodes checked, explicitly excluding weight validation. Model changes invalidate previous checks. Checking uploads no images and starts no inference.
- **Explicit, safe P0 validation**: settings and a new output directory are required; only `--run` submits. Configuration, graph and 8/16-bit decoding agree, complete node contracts are checked first, and persisted original UUIDs prevent automatic resubmission after a lost response.
- **Updated beginner guides**: bilingual existing/new-environment and GGUF/native choices separate example combinations from required capabilities. Cloud API setup and acceptance limits remain explicit. Existing no-picker color copies, history, selections and Undo contracts are preserved.

Development validation: the pinned `qwen_image_2.1_int8_convrot.safetensors` with the existing Qwen3-VL INT8 encoder and Qwen 2.1 RGBA VAE completed real inference; see the compatibility manifest for exact hashes, runtime and scope. The backend has preexisting local modifications, not a clean official Portable reproduction. Standalone Photoshop 27 API checks passed real output on small RGB8/16 sources, editable masks, original/outside-pixel preservation, one Undo and injected cancellation rollback.

Release acceptance: on 2026-10-31, after receiving the `44c2fd7b` Portable candidate, the user reported successful testing and authorized merging and a stable release. This report supports the release decision; no case-by-case record was supplied, so it does not establish every mode, CCX, upgrade or clean-machine acceptance. The release workflow rebuilds the merged source; final build identity differs from the candidate.

### Known limits

This is a stable-channel release, not a guarantee of every model combination or scenario. Offline tests and this user report do not establish live platform keys, every host/system, all-mode installation acceptance or long-term stability. Five historical `selection-v1` ComfyUI image-plus-selection asset samples failed visual inspection; that is not a test verdict for the new `subject-v1` three-image flow, which still needs inspection for subject/background residue. Portrait changes remained weak in the limited Qwen blending comparison. Real-photo lighting layers and original-detail fidelity still need human inspection. Transparent pixels, successful application and controlled samples do not prove visual quality.

- [CCX plugin]({{CCX_URL}}): install through Adobe Creative Cloud desktop. If double-clicking does nothing, use `scripts/install-ccx.ps1 -PackagePath` from the matching environment tools. Photoshop File → Open does not install plugins.
- [Portable plugin]({{PORTABLE_URL}}): extract and copy the entire `PS-AI-FOR-ME` folder into the actual Photoshop `Plug-ins` directory, with its manifest directly inside that folder.
- [Environment tools]({{ENVIRONMENT_URL}}): backend checks, preparation for an existing environment, CCX installer, examples, guides and the standalone platform gateway. ComfyUI, Node.js, models and API keys are separate.
- Each package has a matching `.sha256`. `release-manifest.json` records this batch's sizes, SHA256 hashes, source and workflow identity. These are integrity checks, not a digital signature.

Save documents and quit Photoshop before installation or upgrade. Keep one installation method. CCX and Portable use separate settings and history; export settings and required PNGs before switching. Replace only this plugin. Capture again before applying candidates from older sessions. See the [versioned English guide]({{DOCS_EN_URL}}).

The manifest requires Photoshop **{{HOST_MINIMUM}}** or later. Existing manual evidence mainly covers Windows Photoshop 27.0; it does not establish acceptance of every host, system or installation method. Archive names retain `experimental`; choosing stable only selects the GitHub release channel.

Automation runs offline tests, type checking, production builds and archive verification. It does not run Photoshop, GPU inference, model downloads or paid providers. Consult the [tagged source and guides]({{SOURCE_URL}}) for actual platform, panel, image, color/alpha/depth and installation acceptance. Passing CI does not establish full Photoshop acceptance. Use saved copies and inspect structure, colors and edges. Code: GPL-3.0-only; model licenses are separate.
