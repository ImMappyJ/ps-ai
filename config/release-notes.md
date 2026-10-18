# PS-AI {{TAG}} · {{CHANNEL}}

## 中文

本版本通道：**{{CHANNEL}}**。标签对应源码：[{{SOURCE_SHA}}]({{SOURCE_URL}})。[该版本提交记录]({{COMMITS_URL}})；实际变更与贡献者由下方 GitHub 生成信息和比较链接补充。

- [CCX 插件包]({{CCX_URL}})：通过 Adobe Creative Cloud 桌面应用安装；双击无反应时，使用同版本环境工具的 `scripts/install-ccx.ps1 -PackagePath`。不要用 Photoshop 的“打开”导入。
- [Portable 插件包]({{PORTABLE_URL}})：解压后将完整 `PS-AI-FOR-ME` 文件夹复制到实际 Photoshop 安装目录的 `Plug-ins`，清单直接位于该文件夹下。
- [环境工具包]({{ENVIRONMENT_URL}})：包含后端检查、已有环境准备、CCX 安装脚本、配置示例、使用指南及独立平台网关；不含 ComfyUI、Node.js、模型或 API Key。
- 每个包均附同名 `.sha256`；`release-manifest.json` 记录本批文件大小、SHA256、源码和工作流身份。这些是完整性校验，不是数字签名。

安装或更新前保存文档并退出 Photoshop。只保留一种插件安装形式；CCX 与 Portable 的设置、候选和历史不自动迁移，切换前导出设置和需要的 PNG。升级只替换本插件；旧会话候选需重新捕获后才能应用。详见[本版本中文指南]({{DOCS_ZH_URL}})。

manifest 的最低宿主为 Photoshop **{{HOST_MINIMUM}}**。现有人工记录主要来自 Windows Photoshop 27.0；这不代表所有支持版本、系统或安装方式均已验收。发行文件保留 `experimental` 命名；选择 stable 仅声明 GitHub 发行通道，不扩大验证范围。

自动流水线运行离线测试、类型检查、生产构建和归档校验。它不会运行 Photoshop、GPU 推理、下载大模型或调用付费平台。平台输出、新版面板、图像质量、颜色/透明度/16 位和安装的实际验收，以[该标签的说明]({{SOURCE_URL}})为准；CI 通过不等于 Photoshop 全模式实测通过。请在已保存副本中使用，检查结构、颜色和边缘。代码采用 GPL-3.0-only，权重另行授权。

## English

Release channel: **{{CHANNEL}}**. Tagged source: [{{SOURCE_SHA}}]({{SOURCE_URL}}). [Commits at this source]({{COMMITS_URL}}); GitHub-generated changes, contributors and the actual comparison link follow below.

- [CCX plugin]({{CCX_URL}}): install through Adobe Creative Cloud desktop. If double-clicking does nothing, use `scripts/install-ccx.ps1 -PackagePath` from the matching environment tools. Photoshop File → Open does not install plugins.
- [Portable plugin]({{PORTABLE_URL}}): extract and copy the entire `PS-AI-FOR-ME` folder into the actual Photoshop `Plug-ins` directory, with its manifest directly inside that folder.
- [Environment tools]({{ENVIRONMENT_URL}}): backend checks, preparation for an existing environment, CCX installer, examples, guides and the standalone platform gateway. ComfyUI, Node.js, models and API keys are separate.
- Each package has a matching `.sha256`. `release-manifest.json` records this batch's sizes, SHA256 hashes, source and workflow identity. These are integrity checks, not a digital signature.

Save documents and quit Photoshop before installation or upgrade. Keep one installation method. CCX and Portable use separate settings and history; export settings and required PNGs before switching. Replace only this plugin. Capture again before applying candidates from older sessions. See the [versioned English guide]({{DOCS_EN_URL}}).

The manifest requires Photoshop **{{HOST_MINIMUM}}** or later. Existing manual evidence mainly covers Windows Photoshop 27.0; it does not establish acceptance of every host, system or installation method. Archive names retain `experimental`; choosing stable only selects the GitHub release channel.

Automation runs offline tests, type checking, production builds and archive verification. It does not run Photoshop, GPU inference, model downloads or paid providers. Consult the [tagged source and guides]({{SOURCE_URL}}) for actual platform, panel, image, color/alpha/depth and installation acceptance. Passing CI does not establish full Photoshop acceptance. Use saved copies and inspect structure, colors and edges. Code: GPL-3.0-only; model licenses are separate.
