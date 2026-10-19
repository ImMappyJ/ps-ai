<p align="center">
  <img src="../../assets/brand/avatar.png" width="72" alt="PS-AI">
</p>
<h1 align="center">ComfyUI 配置与模型适配</h1>
<p align="center"><strong>简体中文</strong> · <a href="COMFYUI.en.md">English</a> · <a href="../../README.md">返回首页</a></p>

插件不包含推理后端和模型。已有 ComfyUI 能运行下面的工作流，就可以直接接入，不必重装环境。8 位使用 `qwen21-local-v2-rgba`，16 位使用 `qwen21-local-v3-rgba16`。文中的旧面板截图来自 0.3.0；0.4.0 的配置流程见下文。

本页只讲 ComfyUI 本地模型路径。开发中的平台接入见 [百炼](../providers/BAILIAN.md)、[Gemini / Nano Banana](../providers/GEMINI.md) 与 [OpenAI Images](../providers/OPENAI.md)，不要求安装这里的权重。服务端重写的公开契约见仓库的 `docs/development/BACKEND.md`，不能把 ComfyUI 节点协议与平台接口混用。

**快速定位：** [模型放置](#model-files) · [连接面板](#connection) · [16 位输出](#output-depth) · [常见问题](#troubleshooting)

<a id="output-depth"></a>

当前开发版先选择后端类型 **ComfyUI**，再填地址。这条路径不会启动平台中转服务，切回时恢复原先保存的地址、模型与位深。其他后端见 [平台选择](PLATFORMS.md)。

## 16 位输出（0.4.0）

默认仍为 8 位。需要保留生成结果的更高精度时：

1. 从源码或同版本环境工具包中找到 `comfyui/ps_ai_sdr16` 文件夹。
2. 将整个文件夹复制到后端的 `ComfyUI/custom_nodes/ps_ai_sdr16`，确认 `__init__.py` 直接位于其中。不替换 ComfyUI 核心或已有节点，也不需要另外安装 Python 包。
3. 等后端任务结束，按原来的方式重启 ComfyUI。节点搜索中应能找到 **PS-AI Save PNG16 (sRGB SDR)**。
4. 在插件的“输出位深”选择 **16-bit SDR**。缺少节点时会在生成前报错；可暂时改回 8 位。
5. 要保留结果精度，请应用到 16 位文档，或用“新文档查看”自动创建 16 位 sRGB 文档。“另存 PNG”保留当前候选位深。回填 8 位文档时会明确降为 8 位。

节点直接把 VAE 解码的浮点像素保存为带 sRGB 标记的 16 位 RGB/RGBA PNG。插件的缩放、透明度处理和 PNG 导出继续保留 16 位颜色；面板缩略图及模型输入使用 8 位。选区／保护区仍使用 8 位灰度蒙版。16 位容器不等于模型有 16 位有效细节；BF16/FP16 推理、sRGB 色域和生成偏色的限制仍然存在，不支持 HDR。

配置 JSON 的可选字段 `"outputDepth": 16` 可随地址和模型映射一起导入、导出。旧配置不含此字段时使用 8 位。旧任务按各自原模板恢复。

<a id="backend"></a>

## 1. 先准备能用的后端

已有环境：先启动 ComfyUI，在浏览器打开它的地址，再检查节点和权重。不要为了接入插件覆盖已有模型或工作流。

还没有环境：按 ComfyUI 官方的 [Windows Portable 安装说明](https://docs.comfy.org/installation/comfyui_portable_windows) 或 [手动安装说明](https://docs.comfy.org/installation/manual_install) 安装。显卡驱动、Python 和 PyTorch 以所选发行版的要求为准。插件的环境工具只生成配置和做检查，不自动安装后端、依赖或下载权重。

已验证基线如下。新版本可能兼容，但不能仅看版本号判断；后面的节点和接口要求也必须满足。

| 组件 | 已测试版本 |
| --- | --- |
| ComfyUI | `0.37.4`，提交 `8ff6dc384ba5c410266b40e137799e049459d4f2` |
| [leejet/ComfyUI-GGUF](https://github.com/leejet/ComfyUI-GGUF) | 提交 `373048b8403a7820620065210a691263d4da0a61` |
| Python / PyTorch | 现有后端为 `3.13.15` / `2.14.0+cu130`；不是其他硬件的最低要求 |

`UnetLoaderGGUF` 来自 GGUF 扩展；Qwen 2.1 节点和其余基础节点由兼容的 ComfyUI 提供。按扩展仓库说明安装到自己的 `custom_nodes`，使用该后端的 Python 安装依赖，并由你正常重启后端。不要从同名节点判断接口一定相同。

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

启动后，点 ComfyUI 左侧“模型库”，搜索文件名的主要部分。下面以 VAE 为例：文件出现在 `vae` 分类中，说明后端已经识别到它。模型库显示名可能省略扩展名；插件里仍要选择扫描返回的完整文件名。

<p align="center">
  <a href="../../assets/comfyui-model-library.jpg"><img src="../../assets/comfyui-model-library.jpg" width="360" alt="ComfyUI 模型库中 vae 分类下的预设 VAE"></a>
  <br><sub>模型库 → vae · 点击查看原始截图。</sub>
</p>

这是测试组合，不代表推荐所有用途。生成模型是第三方量化版本，使用前阅读它的模型卡以及上游 [Qwen 许可](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE)：当前许可限定非商业研究／评估，商业用途需另行授权。权重不随插件分发。

精确字节数、固定来源版本和 SHA256 位于 [compatibility.json](../../config/compatibility.json)。已有同一文件不必重新下载。环境检查脚本会校验预设模型的文件大小和哈希，自选模型则标为“需要自行验证”。

<a id="connection"></a>

## 3. 插件地址与配置格式

在“模型与连接”输入完整的 **HTTP(S) 服务根地址**：

```text
http://localhost:8188
http://localhost:8199
http://192.168.1.20:8188
https://comfy.example.com
```

本机后端通常监听 `127.0.0.1`。另一台机器需要监听可访问的网卡地址，并由后端管理者配置防火墙和可信网络。插件不更改这些设置。不支持地址中的用户名、密码、查询参数或 `/comfy` 这样的子路径；反向代理要在根路径转发 HTTP 和 WebSocket，HTTPS 需要有效证书。插件不提供 API Key 登录。

### 按面板完成配置

1. 展开“模型与连接”，在“ComfyUI 地址”填入浏览器能打开的服务根地址。后端端口改过，这里也要一起改。
2. 后端启动后，点“扫描模型”。按上表依次选择“生成模型”“视觉／文本编码器”和“VAE”；扫描使用当前输入的地址。
3. 点“保存配置”，再点顶部“连接”。顶部显示“已连接”后，再运行一次测试生成。连接失败时先看提示和本文末尾的排错表。
4. 要迁移到另一台机器，点“导出 JSON”，在另一台机器“导入 JSON”，重新核对地址和模型。切换界面语言只保存语言，不会提交尚未保存的地址。

<details>
<summary>连接设置截图 · 中文／English（0.3.0）</summary>

以下截图来自 Photoshop 27.0 中的 0.3.0 Portable 面板，已完成模型扫描和连接检查；CCX 的配置项相同。连接成功后，顶部显示“已连接”。

<table>
  <tr>
    <th width="50%" align="center">中文界面</th>
    <th width="50%" align="center">英文界面</th>
  </tr>
  <tr>
    <td align="center" valign="top"><a href="../../assets/setup-zh.png"><img src="../../assets/setup-zh.png" width="340" alt="中文 Portable 面板：地址、模型与已连接状态"></a></td>
    <td align="center" valign="top"><a href="../../assets/setup-en.png"><img src="../../assets/setup-en.png" width="340" alt="英文 Portable 面板：地址、模型与已连接状态"></a></td>
  </tr>
</table>

<p align="center"><sub>点击任一截图查看原始分辨率。0.4.0 的向导流程见下文。</sub></p>

</details>

0.4.0 中的“连接”会在检查通过后保存配置；失败时保留原有设置。“保存配置”和“导入 JSON”可先保存待检查的配置。对应的配置示例：

```json
{
  "schemaVersion": 1,
  "baseUrl": "http://localhost:8188",
  "language": "zh-CN",
  "models": {
    "unet": "qwen-image-2.1-Q4_K_M.gguf",
    "clip": "qwen3vl_8b_int8_convrot.safetensors",
    "vae": "qwen_image_2.1_vae_bf16.safetensors"
  }
}
```

`language` 为 `zh-CN` 或 `en-US`，旧配置可省略，默认中文。模型名必须与扫描结果完全一致，包括子目录和分隔符；例如 `my-qwen/model.gguf`。不允许绝对路径和 `..`。生成期间不能切换配置。历史任务记录原后端地址；旧版未记录地址的历史按 `http://localhost:8188` 处理。

为支持自定义主机，UXP 清单声明了网络访问 `domains: "all"`。运行代码只向配置的 ComfyUI 发请求，不带遥测。远程后端会收到上传的图片、参考图和提示词，也会保存它们；不要把服务直接裸露到不可信网络。


### 0.4.0 配置向导

首次打开会显示三步向导；已有有效配置会直接进入工作区，也可以随时点“配置向导”重新检查。

1. 展开“模型与连接”，填写地址，点“测试并保存地址”。成功后才保存这个地址。
2. 扫描模型，选择三个文件，点“检查环境”。这一步只读取 PS 版本、后端接口、节点字段及模型清单，不安装依赖、不改模型。
3. 点“运行生成示例”才会提交任务。示例会新建自己的测试文档，修改中央色块，再应用为带蒙版的新图层。可以检查图层和蒙版，用 Ctrl+Z 撤销。

预设是测试过的 Qwen 2.1 文件组合；自定义映射只说明文件可见、接口符合模板，仍需实际跑图确认架构兼容。地址能保存，也不等于所有带认证的云服务都能接入。

失败时，面板会给出失败类别、影响和下一步。展开“技术详情（可复制）”查看原始报错。已有任务先按原 ID 恢复或取消；没有明确的内存不足报错时，不会直接归因为显存问题。

### 色彩与安全编辑

主图和参考图支持色彩空间明确的 RGB／灰度 8/16 位。已有文档 ICC 时沿用当前配置，包括 Photoshop 打开或编辑时做过的色彩转换。

**开发分支的补充处理（已发布 v0.4.0 不包含）：** 没有文档 ICC 时，会请你选择当前文档对应的原文件，读取保存的颜色声明。静态 WebP 没有嵌入 ICC 时按格式规范使用 sRGB；PNG 有显式 sRGB 标记时也可识别。文件必须与当前文档路径、尺寸和位深一致，读取前后还会核对当前文档状态。识别成功后创建保留图层的 sRGB 工作副本，后续捕获和回填都在该副本上进行，原图不改动，未保存的图层也会保留在副本中。没有 ICC 的新增内容同样按原文件色彩解释，无法据此保证它原先的显示效果。WebP 8 位路径已在 Photoshop 27 的独立无 ICC 副本上通过捕获、等值回填（像素差 0）、一次撤销和清理；PNG、参考导入及新版面板交互仍待实机验收。

其他格式回退到 Photoshop 已加载的 ICC；无法确定颜色、只有 gamma、含自定义色彩声明但 PS 没有加载 ICC，或找不到可核对原文件的无配置文件文档，仍需在副本中指定正确配置文件。自动读取原文件上限为 64 MB；不是把所有 RGB 图片都假定为 sRGB。CMYK、Lab、HDR 等模式请先准备 RGB 副本。

开发版进一步把工作副本赋色提交为独立历史基线，覆盖“应用 → Ctrl+Z → 再次捕获”的 mock 回归；该修正仍待原生验收。旧版本留下的无 ICC、无路径副本仍需确认后手动指定正确配置文件，不能借另一张图片的颜色信息放行。详见[来源颜色与撤销](../usage/USER_GUIDE.md#source-color)。

| 环节 | 色彩约定 |
| --- | --- |
| 捕获、参考、模型输入 | Photoshop 把读取的副本转换为 sRGB，模型交换为 8-bit RGBA PNG，保留非预乘 alpha。 |
| 后端返回 | 8 位模板接受 sRGB 8-bit PNG，允许已验证的无标记输出；16 位模板要求带 sRGB 标记的 RGB/RGBA16 PNG。冲突的 gamma、ICC、HDR 标记会被拒绝，原始文件仍保留。 |
| 预览、另存 PNG | 统一使用带 sRGB 标记的 PNG。显示效果还受显示器和宿主色彩管理影响。 |
| 应用到图层 | Photoshop 将候选 sRGB 转到来源配置文件。原图层、原文档配置文件和位深保持原样；输出与来源文档都是 16 位时保留高位深颜色；8 位结果写入 16 位文档只是扩展数值。 |

下载后还会检查 PNG 校验、像素格式、解压长度和扫描行。文字元数据不参与解码，异常像素不会作为候选应用；原始下载文件保留在任务记录中。

PS 27.0 中已通过 sRGB、Adobe RGB、Display P3、ProPhoto 的 8/16 位来源文档往返及独立转换对照，该矩阵使用 8 位模型交换。新增 16 位输出另在 sRGB / 16 位文档完成真实生成、回填、导出和已知数值验证。模型输入仍会丢失超出 sRGB 的颜色和原始 16 位细节；16 位输出减少后续量化损失，不保证生成区无色差。“匹配上下文颜色”只做小幅整体校正，不能恢复色域。操作示例见 [使用说明](../usage/USER_GUIDE.md)。

生成时显示实际捕获范围：橙色为有效编辑区，蓝色为手动保护区，灰色为模型上下文。最终回填仍使用真实羽化蒙版，范围辅助图不会变成严格的模型 inpaint 遮罩。候选显示来源文档及新增／替换方式；来源关闭、改动或会话结束后停止回填，候选仍可导出或新建文档。宿主崩溃须结合日志和 GPU／网络设置分别排查；一次通过不代表长期稳定，请保存副本。

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
- 开发版“换背景／场景替换”选择要保留的主体，读取整张画布并结合原始 alpha 处理背景和半透明边缘；不发送范围辅助图，避免 Qwen 将黑白参考图编码成输出内容。角色参考仍跟在来源图之后，只有模型输入垫白，保存的来源捕获不变。两种模式自动关闭原透明轮廓保留、主体对齐和上下文颜色匹配，离开后恢复普通偏好；手工保护区仍生效，旧背景候选保留已存颜色匹配设置。透明背景候选会提示并拦截回填，文件保留供另存检查。主体选择与 RGBA 新流程尚待原生和推理验收，先前舞台测试不能代替它。详见[背景替换与实测范围](../usage/USER_GUIDE.md#background-fix)。已发布 v0.4.0 不包含此改动。
- 开发版[光影重塑工作台](../usage/USER_GUIDE.md#relight)使用同一编辑工作流和模型，不需要额外下载。光源参数编译为语义文字，干净原图仍排第一，范围辅助与参考图沿用既有顺序；本地示意与标记不会上传。结构化布光关闭主体对齐和颜色匹配，保存原生位深的来源缓存，模型输入仍为 sRGB8。输出仅提供整图重绘和实验光影层，提取失败保留参考图而不自动改成重绘；实际照片效果与平台能力分别验收。
- 开发版[溶图](../usage/USER_GUIDE.md#blend)沿用编辑工作流，以整图提供环境参考、选中主体作为回填范围；移除杂物使用内置指令，无需提示词。模型与节点配置不变，新增效果仍待真实推理验收。
- 输出读取节点 `8` 的 `images`。编辑后插件还会按所选设置处理透明轮廓、对齐和颜色，浏览器里直接跑图的原始输出可能不同。

SD、SDXL、Flux、其他 Qwen 架构和任意工作流导入不在当前支持范围。适配这些模型需要独立模板、节点校验、尺寸／蒙版约定及真机回填验证，不能只修改下拉框文件名。

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
| 参考 PNG 提示未标记颜色 | v0.4.0 需在副本中嵌入正确 ICC。开发分支可读取原文件的显式 sRGB 标记并在工作副本处理；未知颜色仍需手动确认。见[参考图示例](../usage/USER_GUIDE.md#reference)。 |
