<p align="center">
  <img src="../../assets/brand/avatar.png" width="72" alt="PS-AI">
</p>
<h1 align="center">从零配置 ComfyUI</h1>
<p align="center"><strong>简体中文</strong> · <a href="COMFYUI.en.md">English</a> · <a href="../../README.md">返回首页</a></p>

PS-AI 直接连接你的 ComfyUI，插件不附带后端或模型。本页从 Windows + NVIDIA 的环境选择讲到第一张结果。云端 API 请看[平台配置](PLATFORMS.md)。

> **先核对版本：**已发布的 [0.5.2 实验版](https://github.com/ImMappyJ/ps-ai/releases/tag/v0.5.2)仅支持 GGUF 主模型。**0.6.0 是未发布源码候选**，新增 `.safetensors` 原生路线；指定 INT8 组合已有真实推理／PNG 及小型 Photoshop API 证据，见[实测示例](#native-tested)。已安装面板、CCX／Portable 与完整宿主验收仍待完成，旧包不会因修改设置获得新路线。

起步顺序：选已有环境或新装环境 → 按版本选 GGUF 或原生路线 → 准备对应节点与三个模型角色 → 启动并连接 → 真实生成、检查新图层并撤销。

<a id="beginner"></a>

## 开始前：确认要准备什么

先作两个选择，再下载：

| 选择 | 接下来做什么 |
| --- | --- |
| 已有兼容 ComfyUI | 保留现有安装和权重，先看[模型兼容条件](#model-compatibility)，再[扫描并连接](#connection)；运行中的后端也可使用[配置工具](#environment-tools) |
| 新装 ComfyUI | 按[后端准备](#backend)下载适合硬件的官方 Portable，再补所选路线真正缺少的节点与模型 |
| GGUF 主模型 | 0.5.2 与本分支源码均有此路线；需要能识别 Qwen 2.1 的 `UnetLoaderGGUF`，见[GGUF 节点基线](#gguf-nodes) |
| 原生 Safetensors 主模型 | 0.6.0 未发布源码候选提供；使用内置 `UNETLoader`，不需要安装 GGUF 扩展包，仍需共享 Qwen 节点、匹配编码器和 RGBA VAE；先看[已测组合](#native-tested) |

1. **Photoshop 27.0 或更高版本。** 本项目记录的宿主是 Windows Photoshop 27.0。先按[首页安装说明](../../README.md#安装发行包)安装 PS-AI 的 CCX 或 Portable 包，在 Photoshop“增效工具”中打开 PS-AI。两种 Portable 是不同东西：PS-AI Portable 是插件，下面的 ComfyUI Portable 是推理后端。
2. **一块兼容的 NVIDIA 显卡、可用驱动及足够空间。** 本项目参考机器为 RTX 5080 16 GiB 显存、约 48 GB 内存；这不是最低配置。已测 GGUF 示例合计约 14.63 GB，原生 INT8 示例约 17.28 GB，可复用相同编码器与 VAE；其他组合另核对磁盘、显存和算子支持。另留 Portable、解压副本、Python 依赖、下载缓存与生成图片的空间。其他显卡、CPU、macOS 未完成相同验证。
3. **匹配插件版本与教程。** 公开下载为 0.5.2，新增路线属于 0.6.0 未发布源码候选。核对“设置”中的版本／构建标识及包附带说明；原生路线需[构建包含此变更的源码](../../README.md#从源码构建)，没有已验收的 0.6.0 安装包。版本匹配不代表全新机器安装或完整宿主验收通过。

本地已打包插件 + ComfyUI 的默认 8 位路径不需要 Node.js、全局 Python、Git、ComfyUI-Manager 或手动导入工作流。Node.js 24+ 只在[云平台本机适配服务](PLATFORMS.md)或源码构建时需要。环境工具包是可选检查／配置工具，不会替你安装后端、依赖或下载模型。本页是操作说明，不是一次全新机器安装或新版本宿主验收记录。

<a id="backend"></a>

## 1. 先准备能用的后端

### 1.1 下载并解压 ComfyUI Portable

打开官方 [Windows Portable 指南](https://docs.comfy.org/installation/comfyui_portable_windows)，从其中的下载入口选择适合自己 NVIDIA 显卡／Windows 架构的包。按该页当前说明选择 CUDA 构建，不要把 AMD、Intel、ARM64 包当作普通 NVIDIA Windows x64 包。按官方说明使用能解开 `.7z` 的解压工具，完整解压到自己选择的目录，例如 `D:\ComfyUI_windows_portable`。不要直接在压缩包里双击启动器。

打开解压后的文件夹，至少应看到以下结构；模型最终在内层 `ComfyUI` 里，不在外层：

```text
ComfyUI_windows_portable/
├─ run_nvidia_gpu.bat
├─ python_embeded/
│  └─ python.exe
└─ ComfyUI/
   ├─ main.py
   ├─ requirements.txt
   ├─ custom_nodes/
   └─ models/
```

**先核对核心版本，再装节点。** 本项目记录的核心基线为 [ComfyUI 0.37.4](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.37.4)，提交 `8ff6dc384ba5c410266b40e137799e049459d4f2`；官方最新 Portable 不一定携带这个核心。该 tag 的“Source code”是核心源码，不是包含 Python／CUDA 的 Portable。其他版本需满足[兼容清单](../../config/compatibility.json)中的节点字段和[任务 API](#api)，不能只看浏览器能否打开。

在资源管理器打开 Portable **外层目录**，地址栏输入 `powershell` 后回车，运行：

```powershell
Get-Content .\ComfyUI\comfyui_version.py
```

记录输出中的版本号。若不是 `0.37.4`，继续以下节点、模型及连接检查时，将它视为待验证组合，不能宣称与记录基线完全一致。新手主路径使用官方匹配 GPU 的完整 Portable，不需要替换其核心。固定核心源码也不等于固定整套 Python／PyTorch／CUDA；本项目尚未完成全新 Portable 的安装及运行时组合验收。使用 venv 的已有后端应以自己的 Python 执行依赖命令，见[手动安装指南](https://docs.comfy.org/installation/manual_install)。开发者若要隔离复现固定核心，可看末尾的[可选附录](#pinned-core)。

### 1.2 按路线准备节点与依赖

两条路线都需要核心提供 `CLIPLoader`、`VAELoader`、`TextEncodeQwenImage21`、`QwenImage21Cache`、采样与图像节点，具体字段见[适配约定](#model-adaptation)。**原生 Safetensors 路线**使用内置 `UNETLoader(unet_name, weight_dtype=default)`，跳过下面的 GGUF 扩展安装；缺少共享 Qwen 节点时仍不能连接。

<a id="gguf-nodes"></a>

**GGUF 路线的已验证基线：**记录中的组合使用 **[leejet/ComfyUI-GGUF](https://github.com/leejet/ComfyUI-GGUF)** 提交 `373048b8403a7820620065210a691263d4da0a61`。它是可复现的推荐基线，不是作者白名单；其他实现需具备同样的架构识别、节点字段和连接类型。该提交的[检测代码](https://github.com/leejet/ComfyUI-GGUF/blob/373048b8403a7820620065210a691263d4da0a61/tools/convert.py#L163)包含相关识别能力。**截至 2026-10-31**，city96 上游尚缺相应 Qwen-Image 2.1 检测，[PR #483](https://github.com/city96/ComfyUI-GGUF/pull/483)仍开放；同名节点并不证明可加载这些权重。已有满足条件的实现无需替换。

全新环境若选择此 GGUF 基线，无需 Git 或 Manager，可直接下载[固定节点 ZIP](https://github.com/leejet/ComfyUI-GGUF/archive/373048b8403a7820620065210a691263d4da0a61.zip)：

1. 解压 ZIP，把解出的 `ComfyUI-GGUF-373048…` 文件夹改名为 `ComfyUI-GGUF`。
2. 将它放到 `ComfyUI_windows_portable/ComfyUI/custom_nodes/`，确认下列文件直接存在，避免多套一层目录；不要同时保留多个同名 GGUF 实现。

```text
ComfyUI/custom_nodes/ComfyUI-GGUF/
├─ __init__.py
├─ nodes.py
└─ requirements.txt
```

3. 仍在 Portable 外层目录的 PowerShell 中运行：

```powershell
.\python_embeded\python.exe -s -m pip install -r .\ComfyUI\custom_nodes\ComfyUI-GGUF\requirements.txt
```

该提交的 [requirements.txt](https://github.com/leejet/ComfyUI-GGUF/blob/373048b8403a7820620065210a691263d4da0a61/requirements.txt)声明 `gguf>=0.13.0`、`sentencepiece`、`protobuf`。复制文件夹并没有安装这些依赖；不要把命令改成裸 `pip` 或系统 `python`，用另一个 Python 安装不会让后端获得它们。安装成功后再启动；已经运行时，等当前任务结束再正常关闭并重启。默认 8 位不需要额外的 `PS_AISavePNG16` 节点。

### 1.3 启动并检查服务

配齐下面的[三个模型组件](#model-files)后，双击外层 `run_nvidia_gpu.bat`，或在上述 PowerShell 运行 `.\run_nvidia_gpu.bat`。等待控制台显示服务地址，手动在浏览器打开 [http://127.0.0.1:8188](http://127.0.0.1:8188)。使用期间让后端控制台保持打开；关闭它会停止服务。首次加载模型通常比后续任务慢，浏览器页面打开并不表示模型已加载成功。

若窗口很快退出，先试本机地址：可能已有后端占用该端口并正常服务。打不开时，从 PowerShell 启动以保留错误，并检查 GPU／依赖和节点导入日志；不要反复启动多个实例或盲目点 update。能打开页面后，再去 Photoshop 扫描模型和连接。无需在 ComfyUI 浏览器里手工拼节点，PS-AI 会提交自己的固定 API 图。

<a id="model-files"></a>

## 2. 模型放在哪里

需要配齐 **生成模型、视觉／文本编码器、VAE 编解码器** 三个角色；这是组件角色，不是固定三个文件或任意三份权重。下方三个文件是已测试 GGUF 示例。可以使用 ComfyUI 自己的 `models` 目录，也可以在 `extra_model_paths.yaml` 配置已有目录。插件只保存加载器返回的相对文件名，不读取权重的绝对路径。

<a id="model-compatibility"></a>

### 自选模型的兼容条件

已有符合下列条件的组件可以复用，无需为匹配示例文件名重新下载。其他量化／精度版本是否可用取决于实际权重、加载器和节点版本；这里不保证未测试组合兼容。

| 组件 | 替换时必须保持的条件 |
| --- | --- |
| 生成模型 | Qwen-Image 2.1 兼容架构，并适配固定的 `QwenImage21Cache` 与 `KSampler`（`cfg=1`、`euler`／`simple`、`denoise=1`）语义。`.gguf` 由兼容的 `UnetLoaderGGUF` 加载；本分支源码新增 `.safetensors` → `UNETLoader(weight_dtype=default)`。格式只决定加载器，不证明架构；需要其他采样设置的 Turbo／LoRA 不能只凭“2.1”名称直接替换。 |
| 视觉／文本编码器 | Qwen3-VL **8B** 的兼容 `.safetensors`，满足 `CLIPLoader(type=qwen_image, device=default)` 和 `TextEncodeQwenImage21` 的文字、多图及条件输出约定。当前分支不能以 4B、Qwen2.5-VL 或编码器 GGUF 替代，见[固定核心的编码器分支](https://github.com/Comfy-Org/ComfyUI/blob/8ff6dc384ba5c410266b40e137799e049459d4f2/comfy/sd.py#L1955)。 |
| VAE | `VAELoader` 可加载的兼容 `.safetensors`，匹配 Qwen 2.1 的 latent 格式、缩放与归一化；[官方配置](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/vae/config.json)为 64 latent 通道、16 倍空间缩放、RGBA 四通道输入／输出。编辑时同一 VAE 由 `TextEncodeQwenImage21` 编码来源图，再由 `VAEDecode` 解码结果；不能换成任意图像 VAE。 |

可评估的上游选项包括 [leejet 的 Qwen-Image 2.1 GGUF 量化](https://huggingface.co/leejet/Qwen-Image-2.1-GGUF/tree/main)和 [Comfy-Org 的 Qwen3-VL 8B 编码器](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/tree/main/text_encoders)（BF16、INT8 convrot、W4A8）。下方实测组合使用 INT8 convrot 编码器和 BF16 RGBA VAE，不能由此推导 BF16／W4A8 编码器或其他精度也已通过。

在“模型与连接”点击“扫描模型”，为每个角色手动选择加载器返回的完整相对名（含子目录），再连接。插件接受符合路径／扩展名规则的自选名称；扫描只证明文件可见，连接只检查所选名称和节点 schema／接口，不读取权重内部结构。之后按[首次真实生成](#first-generation)分别检查文字生图、局部编辑、实际图层／蒙版和一步撤销，才能验证自己的组合；同时核对显存、效果和许可。不要通过修改扩展名冒充另一种模型格式。

### 已测试 GGUF 预设示例

以下目录、下载表与哈希对应 GGUF 测试组合；原生 INT8 例子见[下一节](#native-tested)，同样使用 `diffusion_models` 搜索类别并复用下方编码器／VAE。三个角色不要求下载三份固定文件。自选组件保留实际名称和搜索类别，单独核对兼容性；不要把所有组件都放进 `checkpoints`：

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

<p align="center">
    <a href="../../assets/guide/workflow-settings-zh.png"><img src="../../assets/guide/workflow-settings-zh.png" width="420" alt="发行准备时 Photoshop Preview 设置面板实拍，已扫描模型，连接仍待检查"></a>
</p>

上图是发行准备时在 Photoshop 27 中使用独立 Preview 演示标识的面板实拍，仅执行只读模型扫描；状态仍为“待检查”，没有提交生成。扫描到文件不代表架构兼容，也不构成 0.5.2 完整宿主或全新机器安装验收。

这是测试组合，不代表推荐所有用途。生成模型是第三方量化版本，使用前阅读它的模型卡以及上游 [Qwen 许可](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE)：当前许可限定非商业研究／评估，商业用途需另行授权。权重不随插件分发。

精确字节数、固定来源版本和 SHA256 位于 [compatibility.json](../../config/compatibility.json)。已有同一文件不必重新下载。提供 `-ModelRoot` 且配置中的完整相对名与预设一致时，环境检查脚本校验预设大小和哈希，不符会报错；其他自选名称标为“需要自行验证”（`warn`），不会只因名称不同而拒绝。警告意味着尚未验证，不是模型兼容证明。

若采用这套预设，点击表中的固定版本链接，等待下载完成后再移动文件；不要把下载中的临时文件或网页 HTML 改成模型扩展名。模型文件本身不需要解压；保留下载文件名方便核对来源与哈希。精确值如下（GB 为十进制近似值）：

| 文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| `qwen-image-2.1-Q4_K_M.gguf` | 4,604,557,984 | `833439e91bc1152d28f37aa198c7f6f4218b7de95754c2f7a318a2422ab4b2f8` |
| `qwen3vl_8b_int8_convrot.safetensors` | 9,350,798,360 | `8bfd0f6e12abf2d2d697ecc888e5e90b0d6741d6708f05799f53afa560452e8f` |
| `qwen_image_2.1_vae_bf16.safetensors` | 675,509,688 | `bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9` |

在 Portable 外层目录可用以下只读命令检查下载；三条结果应分别匹配上表。大文件计算哈希需要时间：

```powershell
Get-FileHash .\ComfyUI\models\diffusion_models\qwen-image-2.1-Q4_K_M.gguf -Algorithm SHA256
Get-FileHash .\ComfyUI\models\text_encoders\qwen3vl_8b_int8_convrot.safetensors -Algorithm SHA256
Get-FileHash .\ComfyUI\models\vae\qwen_image_2.1_vae_bf16.safetensors -Algorithm SHA256
```

<a id="native-tested"></a>

### 原生 INT8 实测示例：0.6.0 未发布源码

2026-10-31 的指定组合以内置 `UNETLoader(weight_dtype=default)` 加载下列主模型，复用上表的 `qwen3vl_8b_int8_convrot.safetensors` 编码器与 `qwen_image_2.1_vae_bf16.safetensors` RGBA VAE；三项合计约 **17.28 GB**，GGUF 示例约 **14.63 GB**。已有相同编码器／VAE 无需重下；不要求改用 BF16 主模型，也不据此推荐其他 INT8／FP8／BF16 变体。

| 搜索类别 | 主模型及固定来源 | 字节数 | SHA256 |
| --- | --- | ---: | --- |
| `diffusion_models` | [qwen_image_2.1_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/aacf31a6d48e707f352ecba714cee0680da3479b/diffusion_models/qwen_image_2.1_int8_convrot.safetensors) | 7,256,783,064 | `cb74113cb03faecd79611b01fd7fd642f0aa60d6f0b95086abee214d75eaa57d` |

来源为 Comfy-Org/Qwen-Image-2.1 固定修订 `aacf31a6d48e707f352ecba714cee0680da3479b`，许可为 **qwen-research**；仍须遵守[上游研究许可](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE)。实测后端基于 ComfyUI 0.37.4，包含本机既有修改；运行时为 Python 3.13.15、PyTorch 2.14.0+cu130、comfy-kitchen 0.2.35、comfy-aimdo 0.5.5，显卡 RTX 5080 16 GiB。这是实测环境记录，不是可凭上游版本号复现的干净安装，也不是最低硬件或性能承诺。固定组件与完整边界见[兼容清单](../../config/compatibility.json)。

| 已有证据 | 边界 |
| --- | --- |
| 真实后端任务及 PNG | 文字生图、来源／参考编辑与素材任务完成 PNG 检查，另有 GGUF 对照及显式配置 P0 8/16 位任务；完整案例列表见兼容清单。NASA 公开宇航员照片两条路线虽完成推理，原始输出却把整件宇航服改色，未达到严格局部指令验收；Photoshop 最终蒙版限制另验，任务完成不等于效果／身份保证 |
| Photoshop 27.0.0 API | 使用真实原生输出和自建 128×96 sRGB8/16 来源，通过灰度选区 64/128/255、保护区、独立图层可编辑蒙版、原始／选区外／保护像素不变、一次撤销、写入像素后注入取消的回滚及来源改变拒绝检查 |
| 来源色彩与大图 API | 已标记及未标记无路径多图层 RGB8/16 来源通过当前复合图捕获、零文件选择器、原始状态保留、假定 sRGB 副本及同会话标记、错误活动文档隔离、撤销／配置基线与已关闭来源拒绝。另有一例 4096×3072 RGB16 的 `edit-analysis` 原生蒙版／条带应用，全图与来源哈希及一次撤销检查通过 |
| 任务恢复与取消 | 一例真实原生任务在服务端接受后注入丢失提交回包，按原 UUID 恢复到运行状态，再以该 ID 原子取消；只有一次推理 POST，无全局 interrupt |
| 仍需验收 | 已安装面板交互、CCX／Portable、照片回填／广泛视觉质量、其他大图／宽色域及完整升级历史流程；独立 API 探针不代表这些流程通过 |

<a id="connection"></a>

## 3. 插件地址与配置格式

### 按面板完成配置

1. 打开“设置 → 模型与连接”，选择 **ComfyUI**。
2. 本机 Portable 填 `http://127.0.0.1:8188`，与浏览器测试一致；已有安装也可使用它实际监听的 HTTP(S) 源地址，例如 `http://192.168.1.20:8188` 或 `https://comfy.example.com`。
3. 点“扫描模型”。本分支源码读取 GGUF 与原生主模型加载器的可用列表，保留明确选择；不会把已选原生路线自动换成 GGUF 预设。未选角色仅按预设完整文件名或子目录内唯一同名文件提示，未解决时手动选择；不会猜测另一个量化版本。0.5.2 仅扫描 GGUF 主模型路线。
4. 查看只读的当前加载路线，再点“连接”，检查所选路线的文件名、共享节点及字段／连接类型后保存配置。源码候选显示“节点已检查”，并提示“所选权重的真实推理尚未验证”；不会把外部验收记录自动绑定到当前文件。改动地址、模型或位深需重新检查；不用的加载器缺失可接受，网络失败或损坏 schema 仍是错误。之后再做自己的真实生成检查。

地址不能带账号密码、路径或查询参数。反向代理需在根路径转发 HTTP 和 WebSocket；HTTPS 需有效证书。插件没有集成 API Key 认证。远端后端会收到图片、参考图和提示词，请勿公开无认证的服务。

“连接”检查通过后才保存；“保存配置”和“导入 JSON”可保存未检查的草稿。跨机器可导出／导入 JSON，再核对地址和文件名。字段见[配置示例](../../config/settings.example.json)。模型名不接受绝对路径或 `..`。生成期间设置锁定，任务保留原后端地址。

### 配置向导

首次启动会依次引导测试地址、扫描模型和检查环境。随后“生成示例”会在独立测试文档中提交真实任务，检查结果图层和蒙版后撤销一次。以后可点“配置”重开检查。连接或扫描成功还不能确认模型兼容。

<a id="first-generation"></a>

### 第一次真实出图与回填

先确认生成模型／编码器／VAE 三个角色满足[兼容条件](#model-compatibility)，可以使用上表预设或自己的待验证组合；若放在子目录，保留扫描返回的完整相对名。保持输出位深 **8 位**、一次一个候选。先在“配置”中完成检查，再点“运行生成示例”；这是实际推理，会加载模型、占用显存并写入后端输入／输出，不是连接演示。等待本任务完成，检查独立测试文档中的结果新图层和可编辑蒙版，再按一次 `Ctrl+Z`，确认应用可撤回。另在“文字生图”生成一张，检查输出和后端错误；一种模式成功不能替代另一种模式的验证。

随后用一张自己有权使用、已保存的 RGB8 图片做普通编辑：画一个小选区，选“局部物体／材质修改”，读取来源，输入明确提示（例如“把选中的杯子改成蓝色陶瓷，保持形状和构图”），生成一个候选。等待期间保留来源文档且不要修改它；在结果里检查预览，再点“应用到图层”。确认原图层仍在、选区外未被改动、边缘和透明度合理，然后撤销一次。公开旧版若没有向导，直接按[使用指南](../usage/USER_GUIDE.md)完成这次小选区测试。成功标准是实际候选与新图层／蒙版／撤销，不只是状态标签；本说明不宣称你的硬件、模型输出或安装已通过验收。

### 色彩与安全编辑

使用具有明确色彩空间的 RGB／灰度 8/16 位文档。Photoshop 当前加载的 ICC 优先。主来源捕获会自动解析可用色彩信息；无法确认声明的未标记 RGB8/16 会创建独立的 sRGB 工作副本，并提示近似处理，保留原文档和原生位深。未知灰度、CMYK、Lab 和 32 位 HDR 仍不支持。详见[来源色彩](../usage/USER_GUIDE.md#source-color)。

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

<a id="model-adaptation"></a>

## 4. 自己的模型怎样适配

这版开放的是 **当前工作流内的模型映射**。模型必须属于兼容的 Qwen-Image 2.1 架构，并能被这些加载器以这些选项正确加载：

| 角色 | 节点与参数 | 约定 |
| --- | --- | --- |
| 生成模型：GGUF | `UnetLoaderGGUF.unet_name` | `.gguf`，兼容 Qwen 2.1 的模型结构和固定采样链；0.5.2 的既有路线 |
| 生成模型：原生 | `UNETLoader.unet_name`、`weight_dtype=default` | `.safetensors`，0.6.0 未发布源码新增；仍须兼容同一 Qwen 2.1 结构和采样链，只有[指定 INT8 组合](#native-tested)具备所述实测证据 |
| 编码器 | `CLIPLoader.clip_name` | `.safetensors`，`type=qwen_image`，`device=default` |
| VAE | `VAELoader.vae_name` | `.safetensors`，与 Qwen 2.1 latent 格式、缩放和归一化匹配；编辑输入编码与输出解码使用同一 VAE |
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

SD、SDXL、Flux、其他 Qwen 架构、需要其他采样链的 Turbo／LoRA 和任意工作流导入不在当前支持范围。适配这些模型需要独立模板、节点校验、尺寸／蒙版约定及真机回填验证，不能只修改下拉框文件名。配置仍用 `schemaVersion: 1` 和 `models.unet`／`models.clip`／`models.vae`，不新增加载器选择字段；扩展名确定路线，不自动切换、重试或转换文件。

背景／场景和融合省略 ComfyUI 灰度辅助图，最终仍由 Photoshop 应用保存的蒙版。重打光复用已有模型，无需另下模型。带图素材在已有测试中未通过视觉验收，请检查原图残留、辅助边界、透明度和边缘。详见[使用指南](../usage/USER_GUIDE.md)。

<a id="api"></a>

## 5. 后端接口标准

插件使用以下 HTTP API。代理或自建服务必须保留这些接口语义：

| 接口 | 要求 |
| --- | --- |
| `GET /system_stats` | 返回系统信息 |
| `GET /object_info/{class}` | 返回节点 schema 和对应加载器的模型列表；本分支扫描两个主模型路线，连接校验所选路线及共享节点 |
| `POST /upload/image` | multipart PNG，返回 `name`、`subfolder` |
| `POST /prompt` | 接受客户端指定 UUID `prompt_id`、`client_id` 和 `prompt`，响应同一 `prompt_id` |
| `GET /history/{id}`、`GET /queue` | 只查询该 ID 的终态、节点 `8` 输出及排队状态 |
| `GET /view` | 按 `filename`、`subfolder`、`type=output` 下载 PNG |
| `POST /api/jobs/{id}/cancel` | 原子地取消该 ID，响应布尔值 `cancelled` |
| `/ws?clientId=…` | HTTP 用 WS、HTTPS 用 WSS；`progress` 消息含 `prompt_id`、`value`、`max` |

仅有常见的 `/prompt` 接口还不够。旧后端如果忽略客户端 ID 或没有按 ID 取消接口，应升级／适配后再用；插件不会退回全局 `/interrupt`，以免停止别人的任务。连接检查只读节点和模型，不会为了探测取消能力中断任务；完整接口验收还要实际提交、恢复和取消一次测试任务。参考 [ComfyUI 官方服务接口](https://docs.comfy.org/development/comfyui-server/comms_routes)。

<a id="environment-tools"></a>

## 6. 环境工具

### 直接复用正在运行的后端

已有 ComfyUI 和模型时，先用这条最短路径；无需再选择 Python 或模型目录：

```powershell
powershell.exe -NoProfile -File .\scripts\prepare-environment.ps1 -BaseUrl http://localhost:8188 -OutputDirectory .\prepared-connection
```

可加 `-SettingsPath` 指向已有的 ComfyUI 配置导出，保留其中仍可见的自定义选择。命令读取加载器列表，优先保留完整匹配的当前映射，否则仅补全预设完整文件名或唯一同名子目录文件。在新的输出目录生成 `ps-ai-settings.json`、`model-discovery.json`、`environment-report.json` 和 `README.txt`。先看报告，再在插件设置中“导入 JSON → 连接”，完成完整节点模板检查。同名歧义、缺失或其他自选模型会保留为明确标注的草稿，需在面板中选择。文件可见不代表架构、授权或结果质量已验证。

命令只读 API 状态，不提交、取消或中断任务，不启动第二个后端，不改搜索路径，不安装依赖或下载权重。退出码 `2` 表示配置已准备，但仍有未解决／未验证项；`1` 表示准备或预检失败。预检失败时仍可保留可用报告；来源／哈希和写入任务协议仍需以下检查。

### 检查准备好的配置

在源码目录，或解压后的同版本环境工具根目录，运行：

```powershell
powershell.exe -NoProfile -File .\scripts\check-environment.ps1 -SettingsPath .\config\settings.example.json -ReportPath .\environment-report.json
```

可使用上述准备好的 JSON、复制修改示例，或使用面板导出的配置。加 `-ModelRoot` 可检查 `diffusion_models`、`text_encoders`、`vae` 下预设文件的大小与 SHA256；`-SkipHash` 跳过哈希。`-Offline` 只检查本地文件；`-ComfyRoot` 额外核对源码提交与取消路由。在线检查还会读取 `/queue` 和新 UUID 的 `/history`，不发送 POST；这些读取不能证明调用方任务 ID 或原子取消语义，报告会保留任务生命周期未验证提示。退出码：`0` 全部通过、`2` 有未验证项、`1` 有错误。这不是 Photoshop 验收。

### 仅在需要时准备独立启动器

已有但尚未运行的 Python 后端可生成独立启动器，无需修改原安装：

```powershell
$comfy = Read-Host 'ComfyUI 目录（含 main.py）'
powershell.exe -NoProfile -File .\scripts\prepare-environment.ps1 -ComfyRoot $comfy -OutputDirectory .\prepared-backend -Port 8199
```

ModelRoot 默认使用 `ComfyUI/models`。自动寻找已有的 `.venv/Scripts/python.exe`、`venv/Scripts/python.exe`，以及同级 Portable 的 `python_embeded/python.exe`／`python_embedded/python.exe`。共享模型目录可显式加 `-ModelRoot`，其他已有后端 Python 可加 `-PythonPath`；脚本不会安装解释器。可用 `-SettingsPath` 保留导出的自定义映射。

输出新的 `extra_model_paths.yaml`、`start-comfyui.ps1`、未检查的草稿 `ps-ai-settings.json` 和操作说明。脚本不覆盖已有目录、不安装依赖、不下载权重、不修改现有后端。仅在服务未运行时由你启动生成的脚本；默认监听本机。已有服务正在用该端口时，继续复用并检查它。后端运行后扫描模型，或执行上面的复用命令，确认完整文件名后连接。

<a id="pinned-core"></a>

<details>
<summary>可选开发者附录：在独立空目录中复现固定核心</summary>

这不是新手主路径，也不是已验收的 Portable 二进制。仅在独立新建的空测试目录内操作，不覆盖或降级已有 ComfyUI。官方仓库的[固定核心 ZIP](https://github.com/Comfy-Org/ComfyUI/archive/8ff6dc384ba5c410266b40e137799e049459d4f2.zip)对应 `0.37.4`／`8ff6dc384ba5c410266b40e137799e049459d4f2`，不含 Python／CUDA。可在该隔离测试目录中保留官方 GPU-matched Portable 的运行时和启动器，将随包核心移到安装目录外保存，再把 ZIP 解出的文件夹改名为 `ComfyUI`。确认 `ComfyUI/main.py` 直接存在，没有多层嵌套。在隔离 Portable 外层执行：

```powershell
Get-Content .\ComfyUI\comfyui_version.py
.\python_embeded\python.exe -s -m pip install -r .\ComfyUI\requirements.txt
```

版本应为 `0.37.4`，完整提交以 ZIP 链接为准；选择 GGUF 基线时再安装本页固定 leejet 节点及其 requirements，原生路线跳过 GGUF 扩展。运行时／依赖组合、节点 schema、任务协议及真实出图仍需逐项验证。失败时保留错误和原安装，不通过盲目升级或替换系统 Python 绕过。

</details>

<a id="troubleshooting"></a>

## 7. 常见问题

| 现象 | 先检查什么 |
| --- | --- |
| `python.exe` 找不到／找不到 requirements | PowerShell 是否在 Portable 外层；检查 `python_embeded/python.exe` 和内层 `ComfyUI`。实际包若使用另一目录名，按真实路径调整，不要改用系统 pip。 |
| `No module named gguf`／`sentencepiece`／`protobuf`、`IMPORT FAILED` | 用同一后端 Python 重跑 GGUF requirements 命令，查看第一条安装／导入错误；检查节点文件夹有无嵌套，正常重启后再试。 |
| 所选加载器／共享 Qwen 节点缺失 | GGUF 路线检查兼容 `UnetLoaderGGUF`；原生路线检查内置 `UNETLoader` 及 `weight_dtype=default`，无需补装 GGUF 包。两者都检查 `TextEncodeQwenImage21`／`QwenImage21Cache` 等共享节点。 |
| `Unknown model architecture!` | 核对实际权重与加载器的 Qwen 2.1 检测能力；见有日期的[GGUF 基线说明](#gguf-nodes)。换扩展名、自动换路线或重新提交不是兼容性修复。 |
| 窗口退出／端口被占用／浏览器没有自动打开 | 先手动访问 `http://127.0.0.1:8188`，复用健康服务；否则在 PowerShell 启动并保留错误，不要多开实例。 |
| CUDA／驱动错误或显存不足 | 核对官方 Portable GPU 构建与驱动，查看后端日志；减少候选／尺寸并关闭其他显存占用。16 GiB 是参考机器，不是保证。不要随意升级全部依赖来碰运气。 |
| 选择 16 位后缺少 `PS_AISavePNG16` | 首次测试改回默认 8 位，或按[可选 16 位](#output-depth)单独安装；该节点不属于默认路径。 |
| 浏览器能打开，插件连接失败 | 地址是否完整；代理是否转发 API；HTTPS 证书；Photoshop 是否被防火墙阻断。此前手动设置的“仅回环联网”规则会阻止 LAN／远程服务，需由管理员按实际需求调整。 |
| 扫描不到模型 | 检查搜索类别、相对名和后端启动日志；变更模型目录后按正常方式刷新／重启。 |
| 缺少 Qwen 节点或字段 | 对照固定提交和节点 schema；同名旧节点不一定兼容。 |
| 返回不同任务 ID／取消接口 404 | 后端不满足任务协议；保留原记录并核对版本，不要重复生成或使用全局中断。 |
| Text Encode 慢 | 模型首次加载、显存不足和 CPU 卸载都可能耗时。插件使用 `device=default`，实际设备由 ComfyUI 决定；先看后端日志，不要盲目把所有模型常驻 GPU。 |
| 采样前没有百分比 | 节点尚未上报采样步数。面板显示当前阶段，收到本任务进度后更新百分比。 |
| 候选尺寸不符 | 检查图像缩放和第一参考图尺寸；不要修改模板输出尺寸来绕过检查。 |
| 结果有白边、偏色 | 保透明只适用于保留原轮廓；检查 ICC、模型结果、主体对齐和上下文调色，必要时手工合成。 |
| 来源／参考图未标记色彩 | 按[色彩说明](../usage/USER_GUIDE.md#source-color)处理，必要时使用正确指定配置的副本。 |
