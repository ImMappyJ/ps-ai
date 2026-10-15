# ComfyUI 配置与模型适配

**简体中文** · [English](COMFYUI.en.md) · [返回首页](README.md)

插件不包含推理后端和模型。已有 ComfyUI 能运行下面的工作流，就可以直接接入，不必重装环境。下面的标准针对插件 0.3.0 的 `qwen21-local-v2-rgba` 模板。

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

## 2. 模型放在哪里

预设使用以下三个文件。可以使用 ComfyUI 自己的 `models` 目录，也可以在 `extra_model_paths.yaml` 配置已有目录。插件只保存加载器返回的相对文件名，不读取权重的绝对路径。

| 搜索类别 | 预设文件 | 约占磁盘 |
| --- | --- | ---: |
| `diffusion_models` | [qwen-image-2.1-Q4_K_M.gguf](https://huggingface.co/Janchan123/Qwen-Image-2.1-Uncensored-GGUF/resolve/2a9f9f126b8cad42b48f8b1ac3c89bb884eeeee4/qwen-image-2.1-Q4_K_M.gguf) | 4.60 GB |
| `text_encoders` | [qwen3vl_8b_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/df94239739eef7205973a145ffa6f441f7b64e84/text_encoders/qwen3vl_8b_int8_convrot.safetensors) | 9.35 GB |
| `vae` | [qwen_image_2.1_vae_bf16.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/df94239739eef7205973a145ffa6f441f7b64e84/vae/qwen_image_2.1_vae_bf16.safetensors) | 0.68 GB |

这是测试组合，不代表推荐所有用途。生成模型是第三方量化版本，使用前阅读它的模型卡以及上游 [Qwen 许可](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE)：当前许可限定非商业研究／评估，商业用途需另行授权。权重不随插件分发。

精确字节数、固定来源版本和 SHA256 位于 [compatibility.json](config/compatibility.json)。已有同一文件不必重新下载。用环境检查脚本可以验证文件大小和哈希；自选模型会标为“需要自行验证”，不会冒充已测试组合。

## 3. 插件地址与配置格式

在“模型与连接”输入完整的 **HTTP(S) 服务根地址**：

```text
http://localhost:8188
http://localhost:8199
http://192.168.1.20:8188
https://comfy.example.com
```

本机后端通常监听 `127.0.0.1`。另一台机器需要监听可访问的网卡地址，并由后端管理者配置防火墙和可信网络。插件不更改这些设置。不支持地址中的用户名、密码、查询参数或 `/comfy` 这样的子路径；反向代理要在根路径转发 HTTP 和 WebSocket，HTTPS 需要有效证书。插件不提供 API Key 登录。

点“扫描模型”，选择三个兼容文件，保存并连接。扫描使用当前输入的地址；“连接”会保存当前配置后检查。切换界面语言会单独保存语言，不会提交尚未保存的地址。配置示例：

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

为允许用户填写不同主机，UXP 清单声明了网络访问 `domains: "all"`。运行代码只向配置的 ComfyUI 发请求，不带遥测。远程后端会收到上传的图片、参考图和提示词，也会保存它们；不要把服务直接裸露到不可信网络。

## 4. 自己的模型怎样适配

这版开放的是 **当前工作流内的模型映射**。模型必须属于兼容的 Qwen-Image 2.1 架构，并能被这些加载器以这些选项正确加载：

| 角色 | 节点与参数 | 约定 |
| --- | --- | --- |
| 生成模型 | `UnetLoaderGGUF.unet_name` | `.gguf`，兼容 Qwen 2.1 的模型结构和采样链 |
| 编码器 | `CLIPLoader.clip_name` | `.safetensors`，`type=qwen_image`，`device=default` |
| VAE | `VAELoader.vae_name` | `.safetensors`，与模型 latent 格式匹配 |
| 编码／参考 | `TextEncodeQwenImage21` | `prompt`、`negative_prompt`、`resolution`；多图字段 `images.image_1` 至 `images.image_3`，有图时接受 `vae` |
| 模型包装 | `QwenImage21Cache` | `model`、`device=auto`、`dtype=default` |
| 输出 | `KSampler → VAEDecode → SaveImage` | `euler`／`simple`，`cfg=1`，`denoise=1`，输出节点 ID 固定为 `8` |

其他必需节点：`LoadImage`、`JoinImageWithAlpha`。模型扫描验证的是文件可见性，不验证权重内部架构。即使扩展名和节点检查都通过，仍须实际完成文字生图和局部编辑；量化方式、显存占用、效果和许可由适配者核对。

输入／输出约定：

- 工作流生成代码在 [src/workflow.ts](src/workflow.ts)，提交的是 ComfyUI API 图，不是带节点坐标的 UI 工作流 JSON。
- 编辑输入为预缩放后的 sRGB 8-bit RGBA PNG。`image_1` 是原图，范围辅助启用时占 `image_2`；角色参考放下一槽。`JoinImageWithAlpha` 从 `LoadImage` 的反向 MASK 还原 alpha。
- 编辑时 `resolution=0`，输出尺寸由第一张输入决定，必须完全一致；插件发现尺寸变化会拒绝回填。文字生图使用所选分辨率。
- 范围辅助是视觉提示，不是 latent inpaint 遮罩。最终选区和保护区由 Photoshop 回填蒙版约束。
- 输出读取节点 `8` 的 `images`。编辑后插件还会按所选设置处理透明轮廓、对齐和颜色，浏览器里直接跑图的原始输出可能不同。

SD、SDXL、Flux、其他 Qwen 架构和任意工作流导入不在当前支持范围。适配这些模型需要独立模板、节点校验、尺寸／蒙版约定及真机回填验证，不能只修改下拉框文件名。

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
