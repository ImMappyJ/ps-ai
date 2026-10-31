# ComfyUI 模型兼容与公开说明规范

[简体中文](#zh) · [English](#en) · [开发指南](../../AGENTS.md) · [配置指南](../setup/COMFYUI.md)

<a id="zh"></a>

## 兼容契约

本规范记录 2026-10-31 的源码路线与沟通边界。**已发布 0.5.2 仅支持 GGUF 主模型；0.6.0 是未发布源码候选，新增原生 Safetensors 主模型路线。**指定 INT8 组合已有真实推理／PNG 与有限 Photoshop API 证据，已安装面板及 CCX／Portable 验收仍待完成；源码能力不能写成已发布能力。

| 组件角色 | 路线与约束 |
| --- | --- |
| 生成模型 | `.gguf` → `UnetLoaderGGUF`；本分支新增 `.safetensors` → 内置 `UNETLoader(weight_dtype=default)`。两者都要求兼容 Qwen-Image 2.1 架构及固定 `QwenImage21Cache`、`cfg=1`、`euler/simple`、`denoise=1` |
| 视觉／文本编码器 | 匹配的 Qwen3-VL 8B Safetensors；保持 `CLIPLoader(type=qwen_image, device=default)` 和 `TextEncodeQwenImage21` 的文字／多图条件契约 |
| VAE 编解码器 | 匹配 Qwen 2.1 的 Safetensors RGBA VAE，保留 64 latent 通道、16 倍缩放、归一化及布局；同一 VAE 编码编辑输入并解码输出 |

三个角色不是固定三个文件。扩展名只选加载器，不证明架构；作者、文件名、格式或下拉框可见性都不是兼容性白名单。SD、SDXL、Flux、其他 Qwen 架构、需不同采样链的 Turbo／LoRA，以及任意工作流导入，不能通过更换文件名接入。

配置保留 `schemaVersion: 1` 与 `models.unet`、`models.clip`、`models.vae`。路径必须是对应加载器的完整相对名。保留明确选择，不以预设建议把原生路线自动换回 GGUF；不自动装节点、下载权重、改扩展名、切换加载器或重试推理。扫描两条主模型路线，连接只要求所选路线及共享节点；不用的加载器缺失可以接受，网络失败和损坏 schema 必须报告。原生路线不需要 GGUF 扩展包。

## 证据分级

| 级别 | 可以证明什么 | 不能据此声称什么 |
| --- | --- | --- |
| 文件可见 | 文件出现在正确加载器的模型列表 | 已检查内部架构、显存或质量 |
| 节点／schema | 所选路线及共享节点的字段、选项和连接类型符合图契约 | 权重已成功加载或真实生成通过 |
| 真实推理 | 指定权重与环境完成文字生图、来源／参考编辑，并检查输出尺寸、色彩、alpha 和效果 | Photoshop 回填、撤销或其他组合已通过 |
| Photoshop 宿主 | 指定构建／文档完成新图层与可编辑蒙版、来源保护和一次撤销检查 | 所有模式、安装形式、硬件或长期稳定性已通过 |

每条记录包含日期、构建、节点／权重版本和哈希、场景及未测范围。离线测试、只读 schema 检查、真实推理和原生宿主结果分别记录，不得用较低级证据替代较高级验收。[兼容清单](../../config/compatibility.json)的旧 `nodes`、模型哈希与 `workflow.loader` 保留 GGUF 基线；新增源码路线单独列出。

当前原生证据仅属于固定 `qwen_image_2.1_int8_convrot.safetensors`、已记录 INT8 Qwen3-VL 8B 编码器与 BF16 RGBA VAE 的组合：真实任务／PNG、显式配置 P0 8/16 位、同素材 GGUF 对照及原 UUID 恢复／原子取消已有记录。公开宇航员照片虽完成推理，原始结果却改了整件宇航服，未达到严格局部指令验收；不能据此承诺视觉质量。Photoshop 27.0.0 的独立生产适配器 API 已使用真实输出检查小型 RGB8/16 的选区／保护／可编辑蒙版、来源不变、一次撤销、注入取消回滚和来源改变拒绝，另通过无文件选择器的已标记／假定 sRGB 多图层来源路径，以及一例 4096×3072 RGB16 原生蒙版／条带应用和撤销。它不覆盖已安装面板、照片回填、其他大图／宽色域、完整升级历史或 CCX／Portable。精确组合与包含既有本地修改的运行时见[原生实测示例](../setup/COMFYUI.md#native-tested)与兼容清单；上游版本号不能单独复现该环境，也不能推导通用性能或最低显存。

面板只读路线来自当前所选文件名；ComfyUI 检查通过显示“节点已检查”，仍提示权重真实推理未验证。它不读取权重内部，也不把项目的外部验收记录当成用户所选文件的证明；修改地址、模型或输出位深使旧检查失效。

## 基线与内容同步

leejet 提交 `373048b8403a7820620065210a691263d4da0a61` 是已记录 GGUF 基线，其[检测代码](https://github.com/leejet/ComfyUI-GGUF/blob/373048b8403a7820620065210a691263d4da0a61/tools/convert.py#L163)提供相关能力。**截至 2026-10-31**，city96 上游尚缺对应 Qwen 2.1 检测，[PR #483](https://github.com/city96/ComfyUI-GGUF/pull/483)仍开放。这是具体能力差异，不构成永久作者限制；替代实现仍需分级验证。

README、双语配置／使用指南、清单、教程脚本、字幕、卡片和视频必须使用相同的版本边界、角色名称、路线与证据级别。面向新手先区分已有／新装环境，再选 GGUF／原生路线，最后列所需节点与示例文件大小。不得把示例三文件当作通用下载要求，不得把模拟演示或源码新增能力写成已发布／宿主验收。对外引用完整项目地址： https://www.github.com/ImMappyJ/ps-ai 。

语音、字幕、语义 UI 提示与音效共享一份真实语音时间清单；不能按字数或场景百分比猜时序。字幕用阿拉伯数字、去句末标点并保留“百炼”等专名，保持一位女声与口播感谢。对齐工具安装、媒体渲染和验收各自记录，文档同步不证明音频已对齐或视频已生成。

<a id="en"></a>

## Compatibility contract

This standard records the source routes and communication boundary on 2026-10-31. **Published 0.5.2 is GGUF-only. The unreleased 0.6.0 source candidate adds native Safetensors diffusion loading.** One INT8 combination has real inference/PNG and bounded Photoshop API evidence. Installed panels and CCX/Portable acceptance remain pending; source capability is not released capability.

Diffusion `.gguf` selects `UnetLoaderGGUF`; this branch adds `.safetensors` through built-in `UNETLoader(weight_dtype=default)`. Both retain compatible Qwen-Image 2.1 architecture, `QwenImage21Cache`, `cfg=1`, `euler/simple` and `denoise=1`. The other two roles remain the matching Qwen3-VL 8B Safetensors vision/text encoder and Qwen 2.1 RGBA Safetensors VAE, including its 64 latent channels, 16× scaling, normalization and encode/decode contracts.

Three roles do not mean three fixed files. Format chooses a loader, not an architecture. Authors, filenames and inventory visibility do not establish compatibility. Arbitrary SD/SDXL/Flux, other Qwen architectures, Turbo/LoRA requiring different sampling and workflow imports remain outside this graph.

Keep schemaVersion 1, `models.unet` / `models.clip` / `models.vae` and full loader-relative paths. Preserve explicit choices. Never silently replace a native choice with the GGUF preset, install nodes, download weights, rename extensions, change loaders or retry inference. Scan both diffusion inventories; validate the selected route plus shared nodes. An absent unused loader is acceptable; network failures and malformed schemas remain errors. Native loading needs no GGUF extension package.

## Evidence and communication

Record four levels separately: **correct-loader file visibility → selected-route/shared node fields and socket validation → real-weight text-to-image and source/reference editing → Photoshop layer/mask, source preservation and one Undo**. Earlier levels never prove later ones. Record date, build, node/weight identities and hashes, cases and untested scope. Retain the manifest's existing GGUF baseline nodes, hashes and `workflow.loader`; list new source routes separately.

Current native evidence belongs only to pinned `qwen_image_2.1_int8_convrot.safetensors` with the recorded INT8 Qwen3-VL 8B encoder and BF16 RGBA VAE: real tasks/PNGs, explicitly configured P0 8/16-bit runs, GGUF comparisons and original-UUID recovery/atomic cancellation. A public astronaut photo completed inference, but raw results recolored the entire spacesuit and failed strict local instruction acceptance; completion does not establish visual quality. Photoshop 27.0.0 standalone production-adapter API checks used real outputs for small RGB8/16 selection/protection/editable masks, source preservation, one Undo, injected cancellation rollback and stale-source rejection. Tagged/assumed-sRGB multilayer capture without file pickers and one 4096×3072 RGB16 native-mask/strip application/Undo case also passed. Installed panels, photographic application, other large-source/wide-gamut cases, complete upgrade/history and CCX/Portable remain separate. The [tested example](../setup/COMFYUI.en.md#native-tested) and manifest record the exact combination and runtime with preexisting local backend modifications. Upstream version alone does not reproduce it or establish general performance/minimum VRAM.

The panel's read-only route follows the selected filename. ComfyUI success says **Nodes checked** and still warns that real inference with the selected weights is unverified. Checks do not inspect weight internals or transfer external acceptance records to the user's files. Address, model or output-depth changes invalidate the old check.

Pinned leejet `373048b8403a7820620065210a691263d4da0a61` is the recorded GGUF baseline, not an author allowlist. Its [detection code](https://github.com/leejet/ComfyUI-GGUF/blob/373048b8403a7820620065210a691263d4da0a61/tools/convert.py#L163) has the relevant support. As of 2026-10-31, upstream city96 lacks the corresponding Qwen 2.1 detection and [PR #483](https://github.com/city96/ComfyUI-GGUF/pull/483) remains open. Recheck this dated capability gap before revising recommendations.

Keep README, bilingual setup/usage, manifest, tutorial narration, subtitles, cards and videos consistent about release status, roles, routes and evidence. Start beginner guidance with existing/new environment and GGUF/native choices, then required nodes and example sizes. Do not turn sample files into universal requirements or simulations into host acceptance. Use the full public project URL https://www.github.com/ImMappyJ/ps-ai .

Voice, subtitles, semantic UI cues and sound effects share one measured speech-time manifest; never estimate timing from character count or scene percentage. Use Arabic numerals and omit terminal subtitle punctuation while preserving names such as 百炼; retain one female narrator and spoken thanks. Record alignment-tool installation, rendering and acceptance separately. Documentation updates do not prove audio alignment or a rendered video.
