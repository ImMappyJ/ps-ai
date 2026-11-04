# PS-AI {{TAG}} · {{CHANNEL}}

## 中文

本版本通道：**{{CHANNEL}}**。标签源码：[{{SOURCE_SHA}}]({{SOURCE_URL}})，[提交记录]({{COMMITS_URL}})。本次包含 0.6.1 之后合并的功能和修复。

### 0.7.0 的主要变化

- **功能重新排布**：照片修图、光影与素材、生图三个工作区，共 8 个模式。场景替换并入换背景；服装／道具修复改为局部编辑预设；角色参考移入照片修图。旧历史仍按保存的来源与蒙版应用，复用参数进入对应共享模式。
- **12 个人像／风光预设**：人像包含服装修复、服装改色、道具修复、棚拍背景、户外背景与环境融合；风光包含蓝天、日落、薄雾、秋色、水面与杂物移除。先预览选区说明和提示词，再明确使用；不会自动读取图片或生成。切换语言不改写已输入的描述。
- **边缘融合升级**：普通局部修改、服装与参考编辑共用 outward-v2；自动宽度为选区短边的 15%，限制 8–512 原图像素，手动可设 0–1024，0 关闭。保护区仍生效，旧历史保留原公式。
- **历史选区与来源验证**：保存原始选区、羽化与保护区；可在同会话原文档恢复并复用当前像素。明确的全原生像素核验可验证旧候选来源，没有通过验证的旧任务不会获得新的应用权限。
- **参考图与预览修复**：增加单次明确允许的无配置 RGB8/16 参考图近似 sRGB 读取，保留原图与近似标识；修复多图层顶层无交集像素时的选区预览，以及过期错误提示的清理。
- **原 ICC 光影组**：支持通过实际 ICC 检查的已标记 RGB8/16 来源，在原文档色彩空间中提取和应用溶图／重绘光影层，保留来源、蒙版与撤销检查。旧非 sRGB 光影记录缺少所需原生数据时，须重新捕获生成。

开发验证：功能实现通过 **1191 项离线测试**、类型检查、构建、7 项归档检查和独立代码审查。发布流水线对最终标签重新执行完整打包检查。此前合并修复的 Photoshop 原生 API 记录按兼容清单中的日期和范围保留；本次没有新增 12 个预设的真实推理、安装面板或照片效果验收。

发布依据：用户于 **2026-11-04** 明确授权创建 PR、发布新版本和生成本地安装包。这是发布授权，不代表新增预设或所有安装方式均已验收。

### 安装与限制

- [CCX 安装包]({{CCX_URL}})：使用 Adobe Creative Cloud 桌面应用安装；不要作为图片打开。
- [Portable 安装包]({{PORTABLE_URL}})：退出 Photoshop 后，将完整 `PS-AI-FOR-ME` 文件夹放入 Photoshop 的 `Plug-ins`。
- [环境工具包]({{ENVIRONMENT_URL}})：包含检查／安装脚本、配置、指南及独立平台网关，不含 ComfyUI、Node.js、模型或 API Key。
- 各包附 `.sha256`；`release-manifest.json` 记录本批文件、源码与工作流身份。校验和用于完整性检查，不是数字签名。

更新前保存文档并退出 Photoshop；CCX 与 Portable 的私有设置和历史不自动迁移。最低宿主为 Photoshop **{{HOST_MINIMUM}}**。文件名保留历史 `experimental` 后缀，正式通道不扩大验收范围。详见[中文指南]({{DOCS_ZH_URL}})。

保留 512 MB 图像工作预算、4500 万文档像素上限及输出保护；并非任意大图都能处理。模型输入为 sRGB8，存在色域／精度损失；SDR16 不等于 HDR 或模型原生 16 位。光影组要求可靠 ICC 的 RGB8/16 与不透明编辑区域；CMYK、Lab、32 位 HDR 等仍不支持。天空预设只编辑指定区域，不自动给全图重新布光。人脸身份、边缘、光影和透明素材仍须检查；没有新增磨皮、瘦脸或身份锁定算法。平台真实 Key 出图、全模式安装与长期稳定性不由离线测试保证。

## English

Release channel: **{{CHANNEL}}**. Tagged source: [{{SOURCE_SHA}}]({{SOURCE_URL}}), [commit history]({{COMMITS_URL}}). This version includes changes merged since 0.6.1.

### Main changes in 0.7.0

- **Eight-mode task layout** across Photo editing, Lighting & assets and Generate. Replace scene shares Replace background; clothing/prop repair becomes local-edit presets; Character reference moves to Photo editing. Saved candidates retain their original source/mask guards, while parameter reuse opens the corresponding shared task.
- **12 Portrait/Landscape presets** covering clothing repair/color, props, studio/outdoor backgrounds and environmental blending; skies, sunset, mist, autumn foliage, water and distraction removal. Preview guidance and prompts before explicit use. Browsing never captures or generates; language changes leave existing prompts untouched.
- **Upgraded outward blending** for ordinary edits, clothing and reference editing: outward-v2 automatically uses 15% of the shorter selection side, clamped to 8–512 native pixels. Manual width is 0–1024; 0 disables it. Protection and legacy formulas remain intact.
- **Historical selections and source proof** save raw selections, feathers and protection for explicit same-session restoration and reuse with current pixels. Explicit full native pixel verification can prove an old candidate's source; unverified records gain no new application permission.
- **Reference and preview fixes** add a one-use explicit approximate-sRGB option for untagged RGB8/16 references, preserving originals and approximation notices. Multilayer capture handles a nonintersecting empty top layer correctly, and resolved diagnostic feedback clears without hiding unrelated errors.
- **Original-ICC lighting groups** support verified tagged RGB8/16 sources, extracting/applying Blend and redraw lighting layers in the original document color space. Source, masks and Undo guards remain. Older non-sRGB lighting records without native color data require fresh capture/generation.

Development validation: **1191 offline tests**, type checking, build, seven archive checks and independent review passed for the implementation. The release workflow reruns packaging checks on the final tag. Earlier merged fixes retain their dated Photoshop API evidence in the compatibility manifest. The new presets have no additional live inference, installed-panel or photographic-quality acceptance.

On **2026-11-04**, the user explicitly authorized the PR, new release and local installation packages. Publication authorization does not establish preset quality or acceptance of every installation method.

### Installation and limits

- [CCX package]({{CCX_URL}}): install with Adobe Creative Cloud desktop, not Photoshop File → Open.
- [Portable package]({{PORTABLE_URL}}): quit Photoshop, then copy the entire `PS-AI-FOR-ME` folder into Photoshop's `Plug-ins` directory.
- [Environment tools]({{ENVIRONMENT_URL}}): scripts, configuration, guides and standalone gateway; no ComfyUI, Node.js, models or API keys.
- Matching `.sha256` files and `release-manifest.json` identify the exact batch, source and workflow. These provide integrity checks, not digital signatures.

Save documents and quit Photoshop before upgrading. CCX/Portable private settings and history do not migrate automatically. Minimum host: Photoshop **{{HOST_MINIMUM}}**. Historical `experimental` filenames remain; the stable channel does not expand acceptance. See the [English guide]({{DOCS_EN_URL}}).

The 512 MB working budget, 45 MP document cap and output guards remain; arbitrarily large images are not guaranteed to fit. Model inputs are sRGB8 with gamut/precision loss; SDR16 is neither HDR nor native 16-bit model precision. Lighting groups require verified-ICC RGB8/16 and opaque editable coverage. CMYK, Lab and 32-bit HDR remain unsupported. Sky presets edit the selected area without automatically relighting the entire image. Inspect identity, edges, lighting and transparency; no skin-smoothing, face-reshaping or identity-lock algorithm is added. Offline tests do not establish live cloud inference, every installation mode or long-term stability.
