<p align="center">
  <img src="../../assets/brand/avatar.png" width="72" alt="PS-AI">
</p>
<h1 align="center">ComfyUI 配置与模型适配</h1>
<p align="center"><strong>简体中文</strong> · <a href="COMFYUI.en.md">English</a> · <a href="../../README.md">返回首页</a></p>

PS-AI 直接连接你的 ComfyUI，插件不附带后端或模型。已有兼容安装即可复用。云端 API 请看[平台配置](PLATFORMS.md)。

<a id="backend"></a>

## 1. 先准备能用的后端

启动 ComfyUI，确认浏览器能打开它。新安装按官方 [Windows Portable](https://docs.comfy.org/installation/comfyui_portable_windows) 或[手动安装](https://docs.comfy.org/installation/manual_install)指南完成，再使用该后端的 Python 按说明安装 [ComfyUI-GGUF](https://github.com/leejet/ComfyUI-GGUF)，正常重启。

记录的兼容基线为 ComfyUI `0.37.4`（`8ff6dc384ba5c410266b40e137799e049459d4f2`）和 GGUF 提交 `373048b8403a7820620065210a691263d4da0a61`。所需节点、哈希和验证范围见[兼容清单](../../config/compatibility.json)，其他版本需满足同样的节点字段与任务 API。

<a id="model-files"></a>

## 2. 模型放在哪里

预设使用以下三个文件。可以使用 ComfyUI 自己的 `models` 目录，也可以在 `extra_model_paths.yaml` 配置已有目录。插件只保存加载器返回的相对文件名，不读取权重的绝对路径。

如果直接放在 ComfyUI 目录中，结构如下。不要把三个文件都放进 `checkpoints`：

```text
ComfyUI/
└─ models/
   ├─ diffusion_models/
   │  └─ qwen-image-2.1-Q4_K_M.gguf
   ├─ text_encoders/
   │  └─ qwen3vl_8b_int8_convrot.safetensors
   └─ vae/
      └─ qwen_image_2.1_vae_bf16.safetensors
```

| 搜索类别 | 预设文件 | 约占磁盘 |
| --- | --- | ---: |
| `diffusion_models` | [qwen-image-2.1-Q4_K_M.gguf](https://huggingface.co/Janchan123/Qwen-Image-2.1-Uncensored-GGUF/resolve/2a9f9f126b8cad42b48f8b1ac3c89bb884eeeee4/qwen-image-2.1-Q4_K_M.gguf) | 4.60 GB |
| `text_encoders` | [qwen3vl_8b_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/df94239739eef7205973a145ffa6f441f7b64e84/text_encoders/qwen3vl_8b_int8_convrot.safetensors) | 9.35 GB |
| `vae` | [qwen_image_2.1_vae_bf16.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/df94239739eef7205973a145ffa6f441f7b64e84/vae/qwen_image_2.1_vae_bf16.safetensors) | 0.68 GB |

![模型、编码器与 VAE 配置](../../assets/guide/050-models-zh.png)

这是测试组合，不代表推荐所有用途。生成模型是第三方量化版本，使用前阅读它的模型卡以及上游 [Qwen 许可](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE)：当前许可限定非商业研究／评估，商业用途需另行授权。权重不随插件分发。

精确字节数、固定来源版本和 SHA256 位于 [compatibility.json](../../config/compatibility.json)。已有同一文件不必重新下载。环境检查脚本会校验预设模型的文件大小和哈希，自选模型则标为“需要自行验证”。

<a id="connection"></a>

## 3. 插件地址与配置格式

### 按面板完成配置

1. 打开“设置 → 模型与连接”，选择 **ComfyUI**。
2. 填写浏览器能打开的 HTTP(S) 源地址，例如 `http://localhost:8188`、`http://192.168.1.20:8188` 或 `https://comfy.example.com`。
3. 点“扫描模型”，选择生成模型、视觉／文本编码器和 VAE。使用扫描返回的完整相对文件名，包含子目录。
4. 点“保存配置”和“连接”，显示“已连接”后试生成一张。

地址不能带账号密码、路径或查询参数。反向代理需在根路径转发 HTTP 和 WebSocket；HTTPS 需有效证书。插件没有集成 API Key 认证。远端后端会收到图片、参考图和提示词，请勿公开无认证的服务。

“连接”检查通过后才保存；“保存配置”和“导入 JSON”可保存未检查的草稿。跨机器可导出／导入 JSON，再核对地址和文件名。字段见[配置示例](../../config/settings.example.json)。模型名不接受绝对路径或 `..`。生成期间设置锁定，任务保留原后端地址。

### 配置向导

首次启动会依次引导测试地址、扫描模型和检查环境。随后“生成示例”会在独立测试文档中提交真实任务，检查结果图层和蒙版后撤销一次。以后可点“配置”重开检查。连接或扫描成功还不能确认模型兼容。

### 色彩与安全编辑

使用具有明确色彩空间的 RGB／灰度 8/16 位文档。Photoshop 已加载的 ICC 会保留。支持的未标记 WebP／PNG 可能要求选择原文件，再创建带配置的工作副本；未知色彩需在副本上指定正确配置。不支持 CMYK、Lab 和 32 位 HDR。详见[来源色彩](../usage/USER_GUIDE.md#source-color)。

模型输入为 sRGB8，宽色域颜色和原图精度可能损失。结果按保存的选区／保护蒙版应用到新图层，可一步撤销；来源改动、关闭或会话失效时禁止应用，仍可导出。请在已保存的副本上检查透明度、色彩和边缘。

<a id="output-depth"></a>

## 可选 16 位 SDR 输出

默认仍为 8 位。需要保留生成结果的更高精度时：

1. 从源码或同版本环境工具包中找到 `comfyui/ps_ai_sdr16` 文件夹。
2. 将整个文件夹复制到后端的 `ComfyUI/custom_nodes/ps_ai_sdr16`，确认 `__init__.py` 直接位于其中。不替换 ComfyUI 核心或已有节点，也不需要另外安装 Python 包。
3. 等后端任务结束，按原来的方式重启 ComfyUI。节点搜索中应能找到 **PS-AI Save PNG16 (sRGB SDR)**。
4. 在插件的“输出位深”选择 **16-bit SDR**。缺少节点时会在生成前报错；可暂时改回 8 位。
5. 要保留结果精度，请应用到 16 位文档，或用“新文档查看”自动创建 16 位 sRGB 文档。“另存 PNG”保留当前候选位深。回填 8 位文档时会明确降为 8 位。

节点直接把 VAE 解码的浮点像素保存为带 sRGB 标记的 16 位 RGB/RGBA PNG。插件的缩放、透明度处理和 PNG 导出继续保留 16 位颜色；面板缩略图及模型输入使用 8 位。选区／保护区仍使用 8 位灰度蒙版。16 位容器不等于模型有 16 位有效细节；BF16/FP16 推理、sRGB 色域和生成偏色的限制仍然存在，不支持 HDR。

配置 JSON 的可选字段 `"outputDepth": 16` 可随地址和模型映射一起导入、导出。旧配置不含此字段时使用 8 位。旧任务按各自原模板恢复。

<a id="model-compatibility"></a>

## 4. 自己的模型怎样适配

这版开放的是 **当前工作流内的模型映射**。模型必须属于兼容的 Qwen-Image 2.1 架构，并能被这些加载器以这些选项正确加载：

| 角色 | 节点与参数 | 约定 |
| --- | --- | --- |
| 生成模型 | `UnetLoaderGGUF.unet_name` | `.gguf`，兼容 Qwen 2.1 的模型结构和采样链 |
| 编码器 | `CLIPLoader.clip_name` | `.safetensors`，`type=qwen_image`，`device=default` |
| VAE | `VAELoader.vae_name` | `.safetensors`，与模型 latent 格式匹配 |
| 编码／参考 | `TextEncodeQwenImage21` | `prompt`、`negative_prompt`、`resolution`；多图字段 `images.image_1` 至 `images.image_3`，有图时接受 `vae` |
| 模型包装 | `QwenImage21Cache` | `model`、`device=auto`、`dtype=default` |
| 输出 | `KSampler → VAEDecode → SaveImage / PS_AISavePNG16` | `euler`／`simple`，`cfg=1`，`denoise=1`，输出节点 ID 固定为 `8` |

其他必需节点：`LoadImage`、`JoinImageWithAlpha`。模型扫描验证的是文件可见性，不验证权重内部架构。即使扩展名和节点检查都通过，仍须实际完成文字生图和局部编辑；量化方式、显存占用、效果和许可由适配者核对。

输入／输出约定：

- 工作流生成代码在 [src/generation/workflow.ts](../../src/generation/workflow.ts)，提交的是 ComfyUI API 图，不是带节点坐标的 UI 工作流 JSON。
- 编辑输入为预缩放后的 sRGB 8-bit RGBA PNG。`image_1` 是原图，范围辅助启用时占 `image_2`；角色参考放下一槽。`JoinImageWithAlpha` 从 `LoadImage` 的反向 MASK 还原 alpha。
- 编辑时 `resolution=0`，输出尺寸由第一张输入决定，必须完全一致；插件发现尺寸变化会拒绝回填。文字生图使用所选分辨率。
- 范围辅助是视觉提示，不是 latent inpaint 遮罩。最终选区和保护区由 Photoshop 回填蒙版约束。
- 输出读取节点 `8` 的 `images`。编辑后插件还会按所选设置处理透明轮廓、对齐和颜色，浏览器里直接跑图的原始输出可能不同。

SD、SDXL、Flux、其他 Qwen 架构和任意工作流导入不在当前支持范围。适配这些模型需要独立模板、节点校验、尺寸／蒙版约定及真机回填验证，不能只修改下拉框文件名。

背景／场景和融合省略 ComfyUI 灰度辅助图，最终仍由 Photoshop 应用保存的蒙版。重打光复用已有模型，无需另下模型。带图素材在已有测试中未通过视觉验收，请检查原图残留、辅助边界、透明度和边缘。详见[使用指南](../usage/USER_GUIDE.md)。

<a id="api"></a>

## 5. 后端接口标准

插件使用以下 HTTP API。代理或自建服务必须保留这些接口语义：

| 接口 | 要求 |
| --- | --- |
| `GET /system_stats` | 返回系统信息 |
| `GET /object_info/{class}` | 返回节点 schema 和三个加载器的模型列表 |
| `POST /upload/image` | multipart PNG，返回 `name`、`subfolder` |
| `POST /prompt` | 接受客户端指定 UUID `prompt_id`、`client_id` 和 `prompt`，响应同一 `prompt_id` |
| `GET /history/{id}`、`GET /queue` | 只查询该 ID 的终态、节点 `8` 输出及排队状态 |
| `GET /view` | 按 `filename`、`subfolder`、`type=output` 下载 PNG |
| `POST /api/jobs/{id}/cancel` | 原子地取消该 ID，响应布尔值 `cancelled` |
| `/ws?clientId=…` | HTTP 用 WS、HTTPS 用 WSS；`progress` 消息含 `prompt_id`、`value`、`max` |

仅有常见的 `/prompt` 接口还不够。旧后端如果忽略客户端 ID 或没有按 ID 取消接口，应升级／适配后再用；插件不会退回全局 `/interrupt`，以免停止别人的任务。连接检查只读节点和模型，不会为了探测取消能力中断任务；完整接口验收还要实际提交、恢复和取消一次测试任务。参考 [ComfyUI 官方服务接口](https://docs.comfy.org/development/comfyui-server/comms_routes)。

<a id="environment-tools"></a>

## 6. 环境工具

在源码目录，或解压后的同版本环境工具根目录，运行：

```powershell
powershell.exe -NoProfile -File .\scripts\check-environment.ps1 -SettingsPath .\config\settings.example.json -ReportPath .\environment-report.json
```

先复制、修改示例 JSON，或者使用面板导出的配置。可加 `-ModelRoot` 指定含 `diffusion_models`、`text_encoders`、`vae` 的目录，校验预设大小／哈希；`-SkipHash` 跳过耗时哈希，`-Offline` 只做本地检查，`-ComfyRoot` 核对源码提交和取消路由。退出码：`0` 全部通过，`2` 有未验证项，`1` 有错误。预检不代表 Photoshop 验收通过。

想为已有 Python 后端生成单独启动配置时：

```powershell
$comfy = Read-Host 'ComfyUI 目录（含 main.py）'
$models = Read-Host '模型根目录'
$python = Read-Host '该后端的 python.exe 完整路径'
powershell.exe -NoProfile -File .\scripts\prepare-environment.ps1 -ComfyRoot $comfy -ModelRoot $models -PythonPath $python -OutputDirectory .\prepared-backend -Port 8199
```

输出新的 `extra_model_paths.yaml`、`start-comfyui.ps1` 和 `ps-ai-settings.json`，导入后者即可。脚本不覆盖已有目录、不安装依赖、不下载权重、不修改现有后端。仅在服务未运行时由你启动生成的脚本；默认监听本机。已有服务正在用该端口时，继续复用并检查它。

<a id="troubleshooting"></a>

## 7. 常见问题

| 现象 | 先检查什么 |
| --- | --- |
| 浏览器能打开，插件连接失败 | 地址是否完整；代理是否转发 API；HTTPS 证书；Photoshop 是否被防火墙阻断。此前手动设置的“仅回环联网”规则会阻止 LAN／远程服务，需由管理员按实际需求调整。 |
| 扫描不到模型 | 检查搜索类别、相对名和后端启动日志；变更模型目录后按正常方式刷新／重启。 |
| 缺少 Qwen 节点或字段 | 对照固定提交和节点 schema；同名旧节点不一定兼容。 |
| 返回不同任务 ID／取消接口 404 | 后端不满足任务协议；保留原记录并核对版本，不要重复生成或使用全局中断。 |
| Text Encode 慢 | 模型首次加载、显存不足和 CPU 卸载都可能耗时。插件使用 `device=default`，实际设备由 ComfyUI 决定；先看后端日志，不要盲目把所有模型常驻 GPU。 |
| 采样前没有百分比 | 节点尚未上报采样步数。面板显示当前阶段，收到本任务进度后更新百分比。 |
| 候选尺寸不符 | 检查图像缩放和第一参考图尺寸；不要修改模板输出尺寸来绕过检查。 |
| 结果有白边、偏色 | 保透明只适用于保留原轮廓；检查 ICC、模型结果、主体对齐和上下文调色，必要时手工合成。 |
| 来源／参考图未标记色彩 | 按[色彩说明](../usage/USER_GUIDE.md#source-color)处理，必要时使用正确指定配置的副本。 |
