# PS-AI 开发指南 / Development guide

[中文](#development-zh) | [English](#development-en) | [Git commit attribution](#git-commit-attribution)

<a id="development-zh"></a>
## 中文

### 从这里开始

PS-AI 是 Photoshop 的 UXP 插件，通过 ComfyUI 运行本地 Qwen-Image 2.1 工作流。先读 [README](README.md) 了解功能边界，再读 [ComfyUI 配置](COMFYUI.md) 和 [使用指南](USER_GUIDE.md)。后端版本、节点、模型文件与验收范围以 [兼容清单](config/compatibility.json) 为准；可迁移配置见 [配置样例](config/settings.example.json)。

功能分为局部修图、COSPLAY、文字生图，共九种模式。角色参考辅助、特效与氛围素材在当前范围内，常规人像精修不在范围内。参考图不保证锁定身份，透明素材与生成效果仍需检查。新增模型或工作流不能仅凭“能选到模型”就宣布兼容。

公开文档和当前源码是开发入口。本机交接、旧方案和原生验收证据被 Git 忽略，不是克隆或 Fork 后的前置条件；不要为了补齐开发资料把它们整目录上传。

### 代码地图

| 要改什么 | 先看哪里 |
| --- | --- |
| 面板流程、参数、进度和历史 | [src/panel.ts](src/panel.ts)、[src/i18n.ts](src/i18n.ts)、[plugin/index.html](plugin/index.html)、[plugin/style.css](plugin/style.css) |
| Photoshop 捕获、选区、保护区、回填和撤销 | [src/photoshop.ts](src/photoshop.ts)、[src/range-preview.ts](src/range-preview.ts) |
| 像素、透明度、坐标和色彩 | [src/image.ts](src/image.ts)、[src/composite.ts](src/composite.ts)、[src/color.ts](src/color.ts)、[src/png-decode.ts](src/png-decode.ts)、[src/png16.ts](src/png16.ts) |
| 九种模式和 ComfyUI 图 | [src/intent.ts](src/intent.ts)、[src/workflow.ts](src/workflow.ts) |
| 上传、任务状态、取消和恢复 | [src/client.ts](src/client.ts)、[src/jobs.ts](src/jobs.ts)、[src/storage.ts](src/storage.ts) |
| 地址、模型映射、环境检查和诊断 | [src/profile.ts](src/profile.ts)、[src/environment.ts](src/environment.ts)、[src/diagnostics.ts](src/diagnostics.ts) |
| 可选 16 位输出节点 | [comfyui/ps_ai_sdr16/__init__.py](comfyui/ps_ai_sdr16/__init__.py)、[tests/test_sdr16.py](tests/test_sdr16.py) |
| 构建、打包、环境工具和 CI | [scripts/build.mjs](scripts/build.mjs)、[scripts/package.mjs](scripts/package.mjs)、[scripts/check-environment.ps1](scripts/check-environment.ps1)、[scripts/prepare-environment.ps1](scripts/prepare-environment.ps1)、[.github/workflows/build.yml](.github/workflows/build.yml) |
| 品牌 SVG、图标和导出 | [BRAND.md](BRAND.md)、[assets/brand/mark.svg](assets/brand/mark.svg)、[scripts/export-brand.mjs](scripts/export-brand.mjs) |

### 环境与常用命令

使用 [package.json](package.json) 与锁文件安装依赖。CI 的 Node 版本写在工作流里，已测工具链版本写在兼容清单里。当前构建使用 TypeScript 和 esbuild；插件运行时由 Photoshop 提供 `photoshop`、`uxp`，不能依赖 Node 文件系统、子进程或完整浏览器 API。

```powershell
npm ci
npm test
npm run typecheck
npm run build
```

构建输出为 `dist/plugin`。在 Photoshop 启用开发人员模式并重启后，通过 UXP Developer Tool 加载 `dist/plugin/manifest.json`，步骤见 README。当前宿主最低版本见 [plugin/manifest.json](plugin/manifest.json)；最低版本不等于所有系统都已实测。

- `npm run package`：测试、构建，再生成 CCX、Portable、环境工具 ZIP 及 SHA256 文件。
- `npm run brand:export` / `npm run brand:check`：更新品牌图标导出／检查是否同步。
- `npm run p0`：**会向运行中的 ComfyUI 提交真实推理任务**，不是离线测试。先读 [scripts/p0-live.ts](scripts/p0-live.ts)，确认显存采样命令 `nvidia-smi` 可用。当前脚本默认连接 `http://localhost:8188`，使用合成样图，不能代替真实照片或 Photoshop 验收。
- `node scripts/build-p0-script.mjs`：构建原生 UXP 探针 `dist/ps-ai-p0.psjs`；先检查脚本及对应 `src/p0-*.ts`，再在 Photoshop 运行。
- 修改 16 位保存节点时，在带 NumPy 的后端 Python 环境运行 `python -m unittest discover -s tests -p test_sdr16.py`；这项检查不代替 ComfyUI 推理与原生回填。

### 必须保留的行为约束

**文档与编辑安全。** 捕获时冻结来源文档、会话、尺寸、配置文件、颜色模式、位深、历史状态、裁切坐标和灰度蒙版。回填按来源 ID 定位，不能写入恰好处于活动状态的另一张图。来源关闭、跨会话或内容状态变化时拒绝回填，仍允许导出候选；只保留已验证的插件自有候选替换例外。不要放宽整个历史校验来绕过报错。

上下文裁切不等于允许编辑的范围。有效选区为 `M * (1 - P)`，其中 `M` 是选区、`P` 是保护区，羽化值和原图坐标必须保留。Photoshop 可能裁去透明像素或返回缓存级别坐标，须还原真实边界。保持像素预算、候选数量限制和顺序处理，避免同时持有过多全尺寸缓冲区。

`executeAsModal` 只包住需要的捕获或写入步骤，不能跨网络请求和推理等待。应用候选应新增带可编辑蒙版的图层，形成一次撤销；失败通过 `resumeHistory(..., false)` 回滚。写入灰度蒙版前保持安全的隐藏状态，并在 `finally` 释放 Imaging API 的像素、蒙版资源。原图层不得被破坏。

**色彩、透明度与位深。** 当前输入为有配置文件的 RGB／灰度 8/16 位。未标记色彩、CMYK、Lab、索引色、多通道和 32 位 HDR 等走明确拒绝路径；需要转换时在副本处理，不能暗改来源文档。给模型的输入、参考和蒙版是 sRGB8／8 位；宽色域与精度有损失，不能宣称无损交换。

内部 RGBA 使用非预乘 alpha。开启“保留原透明轮廓”（`preserveAlpha`）时保留原 alpha，避免半透明区域叠加两次；此路径需要剪贴底层时必须校验，多层状态不安全则提示处理副本或导出手工合成。背景／场景替换可关闭此选项，在编辑蒙版范围内改变 alpha。8 位输出模板是 `qwen21-local-v2-rgba`；16 位 SDR 使用 `qwen21-local-v3-rgba16` 和可选 `PS_AISavePNG16`。16 位像素经 `Uint16Array` 保留到合成、保存和原生回填，预览使用单独的 8 位副本；不能先量化成 8 位再放大数值冒充 16 位。SDR16 不代表 HDR 或模型具有原生 16 位精度。

PNG 在解码前校验尺寸、解压预算、扫描行、CRC 和色彩标记。不要用宽松解码兜底绕过验证；无 sRGB 标记的兼容例外只适用于既有、已验证的 8 位模板。

**后端与任务。** 设置格式当前为 `schemaVersion: 1`；地址只接受 HTTP(S) 根地址与可选端口，不接受路径、凭据、查询参数。模型映射使用后端模型目录中的相对文件名，不写开发机绝对路径。现有模板支持 Qwen 2.1 GGUF，不支持导入任意 ComfyUI 网页工作流。新增适配要一起核对节点必填项、连接类型、模型和真实效果。

图中第一张输入是来源，启用引导后占用下一输入位，参考图顺延。`LoadImage` 的反向 MASK 直接连接到 `JoinImageWithAlpha` 以还原 alpha，不额外反转一次；不要因输入顺序或裁切缩放改变而破坏原图对应关系。输出取约定的保存节点 `8`，16 位缺少保存节点时在上传／提交前报错。

提交前持久化调用方生成的 UUID；响应丢失时用原 ID 查询恢复，不能自动重新提交。历史任务继续使用它原来保存的后端地址。进度、结果和取消都按任务 ID 隔离；取消只用原子的 `/api/jobs/{id}/cancel`，不回退到全局 `/interrupt`。展示真实阶段或步数，不编造预计耗时。诊断追踪只记录阶段和任务标识，不把私人像素或提示词写入追踪日志；不要把所有后端错误都归为显存不足。

### 修改、验证与发布

让改动集中解决一个问题，先看相关实现与 `tests/` 中的测试；修复行为缺陷时增加能复现问题的回归。UI 保持 Photoshop 紧凑面板布局，配置与进阶参数折叠，中英文同步；切换语言不能改写提示词、模型名或已保存的任务参数。UXP 的输入框、下拉框和 CSS 行为须在宿主检查，浏览器截图不能证明插件正常。

提交前运行与改动相关的检查。运行代码、工作流或打包改动，至少完成 `npm test` 和 `npm run build`；发版前运行 `npm run package`。仅修改文档时检查差异和链接；改到随环境工具分发的指南时，运行 `node --import tsx --test --test-timeout=15000 tests/package.test.ts`，确认归档内的相对链接仍可用。公开开发入口新增的链接必须在干净克隆中存在，不能依赖被忽略的本机文件。

`tests/uxp-harness.ts` 是模拟环境，不是 Photoshop 真机证明。涉及捕获／回填、透明度、ICC、位深、撤销、选区或宿主控件时，补做原生验证，并分别记录源码检查、模拟测试、真实推理与宿主验证的结果。未做的检查写清楚，不把一次成功或暂未崩溃写成长时间稳定。

发版需同步 `package.json`、`package-lock.json`、`plugin/manifest.json` 的版本，按 [打包脚本](scripts/package.mjs) 的白名单检查三个归档、许可和校验文件，分别验证 CCX 与 Portable 安装路径。两个插件 ID 为 `local.ps-ai` 与 `local.ps-ai.portable`，Portable 目录保留 `PS-AI-FOR-ME`；变更它们会影响 UXP 数据与安装行为，不能顺手重命名。环境准备工具不自动下载模型或改装现有后端。

GitHub Actions 在推送到 `main` 和 PR 时检查构建，只有手动运行工作流才上传发行产物；当前不自动创建 Release。发布标签与附件应对应实际验收的代码，不移动已公开标签。文档改动不意味着需要重发已有发行包。

面向使用的中英文说明放在仓库根目录，顶部保留语言切换、使用相对链接，描述以实际实现和验收为准。修改配置标准同步两种语言的 COMFYUI 与兼容清单；修改交互同步 USER_GUIDE；品牌 SVG 变更同步导出和引用。新截图使用有权公开的素材，保持原始清晰度，不补画宿主界面。模型、输入输出、私人诊断与构建产物保持被忽略。提交署名遵循本文件末尾的共同作者规则。

<a id="development-en"></a>
## English

### Start here

PS-AI is a Photoshop UXP plugin that runs local Qwen-Image 2.1 workflows through ComfyUI. Read the [README](README.en.md), [ComfyUI setup](COMFYUI.en.md) and [user guide](USER_GUIDE.en.md). The [compatibility manifest](config/compatibility.json) records backend, node and model pins and the scope of validation; the [settings example](config/settings.example.json) defines portable configuration.

The three workspaces cover local editing, COSPLAY and text-to-image, with nine modes. Character references, effects and atmosphere assets are in scope; routine portrait retouching is not. References do not guarantee identity preservation, and generated results and transparency need inspection. Finding a model in the backend list does not establish compatibility.

Use public guides and current source as the development entry point. Ignored handoff notes, historical plans and native evidence are local records, not prerequisites for a clone or fork. Do not publish those directories wholesale.

### Source map

| Area | Entry points |
| --- | --- |
| Panel, parameters, progress and history | [src/panel.ts](src/panel.ts), [src/i18n.ts](src/i18n.ts), [plugin/index.html](plugin/index.html), [plugin/style.css](plugin/style.css) |
| Capture, selections, protection, apply and undo | [src/photoshop.ts](src/photoshop.ts), [src/range-preview.ts](src/range-preview.ts) |
| Pixels, alpha, coordinates and color | [src/image.ts](src/image.ts), [src/composite.ts](src/composite.ts), [src/color.ts](src/color.ts), [src/png-decode.ts](src/png-decode.ts), [src/png16.ts](src/png16.ts) |
| Mode intent and ComfyUI graphs | [src/intent.ts](src/intent.ts), [src/workflow.ts](src/workflow.ts) |
| Uploads, job state, cancellation and recovery | [src/client.ts](src/client.ts), [src/jobs.ts](src/jobs.ts), [src/storage.ts](src/storage.ts) |
| Profiles, environment checks and diagnostics | [src/profile.ts](src/profile.ts), [src/environment.ts](src/environment.ts), [src/diagnostics.ts](src/diagnostics.ts) |
| Optional 16-bit output | [comfyui/ps_ai_sdr16/__init__.py](comfyui/ps_ai_sdr16/__init__.py), [tests/test_sdr16.py](tests/test_sdr16.py) |
| Build, packages, environment tools and CI | [scripts/build.mjs](scripts/build.mjs), [scripts/package.mjs](scripts/package.mjs), [scripts/check-environment.ps1](scripts/check-environment.ps1), [scripts/prepare-environment.ps1](scripts/prepare-environment.ps1), [.github/workflows/build.yml](.github/workflows/build.yml) |
| Brand sources and exports | [BRAND.en.md](BRAND.en.md), [assets/brand/mark.svg](assets/brand/mark.svg), [scripts/export-brand.mjs](scripts/export-brand.mjs) |

### Setup and commands

Install dependencies from [package.json](package.json) and the lockfile. CI pins Node in its workflow; the compatibility manifest records tested toolchain versions. The build uses TypeScript and esbuild. Photoshop provides `photoshop` and `uxp` at runtime; do not assume Node filesystem access, subprocesses or full browser APIs.

```powershell
npm ci
npm test
npm run typecheck
npm run build
```

The output is `dist/plugin`. Enable Photoshop developer mode, restart and load `dist/plugin/manifest.json` through UXP Developer Tool as described in the README. See [plugin/manifest.json](plugin/manifest.json) for the minimum host version; this is not a claim of testing every supported system.

- `npm run package` runs tests and builds, then produces CCX, Portable and environment-tool archives plus SHA256 files.
- `npm run brand:export` / `npm run brand:check` exports brand icons / checks that exports are current.
- `npm run p0` **submits real inference jobs to a running ComfyUI**. Inspect [scripts/p0-live.ts](scripts/p0-live.ts) first and ensure `nvidia-smi` is available for VRAM sampling. It currently defaults to `http://localhost:8188` and uses synthetic fixtures; it does not validate real photographs or Photoshop integration.
- `node scripts/build-p0-script.mjs` builds the native UXP probe `dist/ps-ai-p0.psjs`. Inspect the builder and relevant `src/p0-*.ts` before running it in Photoshop.
- For the 16-bit save node, run `python -m unittest discover -s tests -p test_sdr16.py` with backend Python and NumPy installed. This does not replace real inference or native apply tests.

### Contracts to preserve

**Document safety.** Capture freezes the source document, session, dimensions, profile, mode, depth, history, crop coordinates and grayscale mask. Resolve apply targets by source ID, never by whichever document is active. Reject closed, previous-session or modified sources while preserving candidate export. Keep only the validated exception for replacing the plugin's own candidate layer; do not bypass history checks generally.

Context is not the editable area. The effective mask is `M * (1 - P)`, with selection `M` and protection `P`; preserve feathering and original coordinates. Photoshop can trim transparent pixels or return cache-level coordinates: restore actual bounds. Keep pixel and candidate limits and sequential processing to bound full-size buffers.

Keep `executeAsModal` limited to capture/write operations, outside network and inference waits. Apply to a new layer with an editable mask and one undo step; roll back failures with `resumeHistory(..., false)`. Keep the mask safely hidden before writing grayscale data, dispose Imaging API resources in `finally`, and preserve original layers.

**Color, alpha and depth.** Inputs are tagged RGB / Grayscale 8/16-bit. Untagged sources, CMYK, Lab, Indexed, Multichannel and 32-bit HDR take explicit rejection paths. Convert copies when needed; never silently alter source documents. Model images, references and masks use sRGB8 / 8-bit, with gamut and precision loss; do not claim a lossless round trip.

Internal RGBA is straight alpha. When “Preserve source transparency” (`preserveAlpha`) is enabled, preserve source alpha without applying semitransparency twice. Validate the clipping base when this path needs one; for unsafe multilayer cases, ask for a merged copy or manual composition after export. Background/scene replacement may disable this option and change alpha within the edit mask. The 8-bit template is `qwen21-local-v2-rgba`; SDR16 uses `qwen21-local-v3-rgba16` and optional `PS_AISavePNG16`. Preserve `Uint16Array` values through composition, export and native apply, with separate 8-bit previews. Quantizing to 8-bit then scaling values is not 16-bit preservation. SDR16 does not mean HDR or native 16-bit model precision.

Validate PNG dimensions, inflation budget, scanlines, CRC and color tags before decoding. Do not fall back to permissive decoding. The untagged-output exception belongs only to the existing verified 8-bit template.

**Backend and jobs.** Settings currently use `schemaVersion: 1`. Accept HTTP(S) origins with optional ports, without paths, credentials or queries. Model mappings are filenames relative to backend model directories. The existing graph supports Qwen 2.1 GGUF, not arbitrary imported UI workflows. New adapters need node-required-input, connection-type, model and real-output validation.

The source is the first image, an enabled guide occupies the next slot and references follow it. `JoinImageWithAlpha` restores alpha from `LoadImage`'s inverted MASK; preserve the direct connection without adding another inversion. Preserve image ordering and crop/scale correspondence. Read outputs from save node `8`; missing optional 16-bit support must fail before upload/submission.

Persist the caller-assigned UUID before POST. Recover lost responses by querying that ID, never by automatic resubmission. Historical jobs use their saved backend URL. Filter progress, results and cancellation by job ID. Use only atomic `/api/jobs/{id}/cancel`, without a global `/interrupt` fallback. Show real stages or steps, not invented timing. Diagnostic traces record stages and task IDs, not private pixels or prompts; classify backend errors rather than assuming every failure is OOM.

### Changes, validation and releases

Keep changes focused. Read the relevant implementation and tests; add a reproducer for behavior fixes. Preserve the compact Photoshop panel with collapsed setup/advanced controls and matching Chinese/English UI. Language changes must not rewrite prompts, model names or stored task parameters. Validate UXP inputs, selects and CSS in Photoshop; a browser screenshot is not host evidence.

Run checks appropriate to the change. Runtime, workflow and packaging changes need at least `npm test` and `npm run build`; releases need `npm run package`. For documentation changes, check the diff and links. If shipped guides change, run `node --import tsx --test --test-timeout=15000 tests/package.test.ts` to validate relative links inside the environment archive. New development links must exist in a clean clone without ignored files.

`tests/uxp-harness.ts` is a mock, not native validation. Capture/apply, alpha, ICC, depth, undo, selections and host controls require Photoshop checks. Record source review, mock tests, inference and host results separately, including anything not run. A successful run or a period without crashes does not establish long-term stability.

Before release, align versions in `package.json`, `package-lock.json` and `plugin/manifest.json`; inspect all three archives, licenses and checksums against the [packaging allowlists](scripts/package.mjs). Validate CCX and Portable installation separately. Preserve IDs `local.ps-ai` and `local.ps-ai.portable` and the Portable folder `PS-AI-FOR-ME`; changing them affects installation and UXP data. Environment preparation does not automatically download models or replace an existing backend.

GitHub Actions validates pushes to `main` and PRs. Package artifacts upload only on manual workflow runs; releases are currently published separately. Tags and assets must match validated code; do not move public tags. Documentation updates alone do not require replacing existing release assets.

Keep public guides at the repository root, bilingual, with language links at the top and relative repository links. Reflect implementation and actual validation. Configuration changes update both COMFYUI guides and the manifest; interaction changes update USER_GUIDE; brand SVG changes update exports and references. Use publishable screenshots at their original clarity, without fabricated host UI. Keep models, runtime images, private diagnostics and build artifacts ignored. Follow the shared attribution rules below for commits.

## Git Commit Attribution

When Codex contributes to code changes in this repository:

- Preserve the repository owner's configured Git identity as the primary commit author.
- Always append the following trailer to commit messages created by Codex:

  Co-authored-by: codex <codex@openai.com>

- Add the trailer after the commit message body, separated by a blank line.
- Do not add duplicate Co-authored-by trailers.
- Preserve other contributors' existing attribution.
- Do not attribute commits to Codex when Codex did not contribute.
- Do not modify global or local Git user.name / user.email settings.
- Do not amend or rewrite existing commits solely to add attribution.
- Follow existing repository commit conventions.
