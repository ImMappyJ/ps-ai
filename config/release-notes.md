# PS-AI {{TAG}} · {{CHANNEL}}

## 中文

本版本通道：**{{CHANNEL}}**。标签对应源码：[{{SOURCE_SHA}}]({{SOURCE_URL}})。[该版本提交记录]({{COMMITS_URL}})；实际变更与贡献者由下方 GitHub 生成信息和比较链接补充。

### 0.5.0 的主要变化

- **四个平台入口**：直接连接 ComfyUI / Qwen-Image 2.1，或选择 Nano Banana（Gemini）、GPT Image（OpenAI）、百炼及手动网关。平台适配、密钥隔离和离线协议回归已实现；没有 API Key 的真实推理与宿主流程仍待验收。
- **创作、结果、历史、设置**四导航；人像分类承接原 COSPLAY，加入光影重塑与溶图，共十一种模式。移除杂物无需提示词；背景／场景替换选择要保留的主体，素材可明确使用图片＋选区或纯文字输入。
- **独立布光工作台**：最多八个光源、本地布光示意与单次拖动撤销，空闲打开／重新读取当前文档保留灯光。输出分整图重绘与实验光影层；本地示意不预测模型结果，提取拒绝时保留 AI 参考检查／导出，不自动重提或改成重绘。
- **来源、历史与大图处理**：按原 UUID 和原端点恢复任务，独立历史浏览及明确本地清理；精确来源、ICC、选区与保护校验。原文档可达 4500 万像素，超出原尺寸读取预算时使用有界工作图和原坐标条带回填，不等于模型原生生成 4500 万像素。原生 16 位数据和可选 ComfyUI PNG16 输出不代表模型有原生 16 位精度。
- **文档与实机图片同步**：中英文操作、安装更新、数据去向及验证边界按当前源码整理，演示图片全部替换为 0.5.0 实机截图。当前操作截图使用指定 WebP 的演示副本；模式配置截图不证明模型效果，受控本地响应仅证明界面与图层操作。

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

### Main changes in 0.5.0

- **Four platform choices:** direct ComfyUI / Qwen-Image 2.1, Nano Banana (Gemini), GPT Image (OpenAI), Bailian and a manual gateway. Adapters, isolated key handling and offline protocol regressions are implemented; live inference and host flows requiring API keys remain unverified.
- **Create, Results, History and Settings** navigation. Portrait replaces the COSPLAY label, and relighting and blending bring the total to eleven modes. Removal uses no prompt; background/scene modes select the subject to retain. Assets explicitly choose image-plus-selection or text-only input.
- **A separate lighting workbench:** up to eight lights, local illustrations and one local undo per gesture. Idle opening and Re-read current document retain edited lights. Choose Full-image redraw or experimental Lighting layers. Illustrations do not predict model output; rejected extraction retains the AI reference for inspection/export without automatic resubmission or redraw fallback.
- **Source, history and large-document handling:** recover the original UUID at its saved endpoint, browse History independently and explicitly clear local records. Exact source, ICC, selection and protection checks remain. Documents up to 45 million pixels can use a bounded working raster and native-coordinate strip application; this is not native 45MP model generation. Native 16-bit data and optional ComfyUI PNG16 files do not establish native 16-bit model precision.
- **Updated bilingual guides and genuine host images:** current source behavior, installation, upgrades, data destinations and validation limits are documented, with all demonstration images replaced by 0.5.0 host captures. Operation images use a demo copy of the designated WebP; mode-configuration captures do not establish model quality, and controlled local responses illustrate actual UI/layer operations only.

### Known limits

This remains experimental. Offline tests do not establish live platform keys, every host/system, all-mode installation acceptance or long-term stability. Five real ComfyUI image-plus-selection asset samples failed visual inspection; portrait changes remained weak in the limited Qwen blending comparison. Real-photo lighting layers and original-detail fidelity still need human acceptance. Follow each mode's guide and inspect raw outputs; transparent pixels, successful application and controlled samples do not prove visual quality.

- [CCX plugin]({{CCX_URL}}): install through Adobe Creative Cloud desktop. If double-clicking does nothing, use `scripts/install-ccx.ps1 -PackagePath` from the matching environment tools. Photoshop File → Open does not install plugins.
- [Portable plugin]({{PORTABLE_URL}}): extract and copy the entire `PS-AI-FOR-ME` folder into the actual Photoshop `Plug-ins` directory, with its manifest directly inside that folder.
- [Environment tools]({{ENVIRONMENT_URL}}): backend checks, preparation for an existing environment, CCX installer, examples, guides and the standalone platform gateway. ComfyUI, Node.js, models and API keys are separate.
- Each package has a matching `.sha256`. `release-manifest.json` records this batch's sizes, SHA256 hashes, source and workflow identity. These are integrity checks, not a digital signature.

Save documents and quit Photoshop before installation or upgrade. Keep one installation method. CCX and Portable use separate settings and history; export settings and required PNGs before switching. Replace only this plugin. Capture again before applying candidates from older sessions. See the [versioned English guide]({{DOCS_EN_URL}}).

The manifest requires Photoshop **{{HOST_MINIMUM}}** or later. Existing manual evidence mainly covers Windows Photoshop 27.0; it does not establish acceptance of every host, system or installation method. Archive names retain `experimental`; choosing stable only selects the GitHub release channel.

Automation runs offline tests, type checking, production builds and archive verification. It does not run Photoshop, GPU inference, model downloads or paid providers. Consult the [tagged source and guides]({{SOURCE_URL}}) for actual platform, panel, image, color/alpha/depth and installation acceptance. Passing CI does not establish full Photoshop acceptance. Use saved copies and inspect structure, colors and edges. Code: GPL-3.0-only; model licenses are separate.
