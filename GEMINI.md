<p align="center"><img src="assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">接入 Gemini / Nano Banana</h1>
<p align="center"><strong>简体中文</strong> · <a href="GEMINI.en.md">English</a></p>

当前开发分支包含 Google Gemini 适配器，**尚未使用真实 API Key 验证平台出图或 Photoshop 回填**。v0.4.0 发行包不包含这项功能。Nano Banana 是 Gemini 图像模型系列的名称，接入使用 Google 官方 API，不是网页账号或第三方中转。

## 启动本机服务

需要 Node.js 24+。从包含此功能的源码版本运行 `npm ci`，在 PowerShell 设置：

```powershell
$env:PSAI_PROVIDER = 'gemini'
$geminiSecureKey = Read-Host 'Gemini API Key' -AsSecureString
$env:GEMINI_API_KEY = [Net.NetworkCredential]::new('', $geminiSecureKey).Password
npm run gateway -- --port 8191
```

没有 Key 时可以省略输入 Key 的两行；服务仍可启动、读取能力，但不会生成。Key 需要有对应模型的权限和额度，网页订阅不等于 API 访问权限。变量只在当前终端及其子进程中生效，修改后重启本机服务。

后续发行的环境工具 ZIP 会包含独立服务，可把最后一行换成：

```powershell
node .\backend\ps-ai-gateway.mjs --port 8191
```

不需要编译插件源码或安装 ComfyUI，但仍需 Node.js 运行服务。也可以使用 8190 等其他空闲端口；同时运行百炼和 Gemini 时须使用不同端口。两者默认分别存储在 `~/.ps-ai/bailian` 与 `~/.ps-ai/gemini`，不要让两个实例共享同一数据目录。

## 在 Photoshop 中连接

开发测试先构建插件，按 [README](README.md) 用 UXP Developer Tool 加载。

1. 展开“模型与连接”，选择“平台适配服务（实验）”。
2. 地址填 `http://localhost:8191`，不要填 Google API 地址或 Key。
3. 点击“扫描模型”，选择有权限的模型，保存配置，再连接。也可以导入 [配置样例](config/settings.gemini.example.json)。
4. 先做一张文字生图，再在已保存的副本中选择腿部，尝试“给腿部穿上白色过膝袜，保留姿势和其他区域”。
5. 预览候选后再应用。选区、保护区、保留原透明轮廓、独立图层与一次撤销仍由插件处理。

图片、参考图和提示词会上传 Google，并保存在本机插件及适配服务的数据目录中。不要把 Key 放进插件设置、提示词、截图或 Git。

## 已实现的接口范围

适配 [Google GenerateContent 图像接口](https://ai.google.dev/gemini-api/docs/generate-content/image-generation)，使用 `x-goog-api-key` 请求头与内联 PNG，读取图文混合响应中的单张 PNG。可选模型：

| 模型 ID | 常用名称 |
| --- | --- |
| `gemini-nano-banana-2.1` | Nano Banana 2.1 |
| `gemini-3.1-flash-lite-image` | Nano Banana 2 Lite |
| `gemini-3.1-flash-image` | Nano Banana 2 |
| `gemini-3-pro-image` | Nano Banana Pro |
| `gemini-2.5-flash-image` | Nano Banana |

名称依据 [官方模型说明](https://ai.google.dev/gemini-api/docs/image-generation)。这是声明的适配列表，不表示账号已经开通或模型永久可用。

本轮只开放文字生图与六种编辑模式：物体／材质、移除、背景、服装／道具、角色参考、场景。不开放要求透明通道的特效／氛围素材；也不提供对话连续编辑、联网搜索、4K、可设种子或 16 位输出。步数和种子控件禁用，每张候选单独调用平台。

为保持回填坐标，来源图与范围辅助等比缩放、补边到 1024×1024。收到同尺寸方形 PNG 后，按相同补边坐标裁回原比例，再缩放到请求尺寸；参考图保留其比例。长条选区的有效模型像素较少，较大的请求可能只是放大 1K 结果。主体位置是否保持仍需实际效果验收，不能据此承诺像素级重绘精度。

默认拒绝未标记 sRGB 的 PNG。只有确认平台输出本来就是 sRGB 后，才显式设置 `$env:PSAI_GEMINI_ASSUME_SRGB = '1'` 并重启。这个开关只解释缺失标记，不会转换未知 ICC、修复 HDR、接受 JPEG 或忽略损坏图片。

## 中断与排错

Gemini 这条接口直接返回图片，没有可用于本适配器重取结果的平台任务 ID。本机服务先保存 UUID，再在后台发起一次请求，插件只查询本机状态。不要把本地 UUID 当作 Google 任务 ID。

- “停止后续候选”保留当前请求继续执行，不保证停止计费。已有结果会保存。
- 网络超时或进程退出发生在结果落盘前，可能留下 `unknown`。不会自动重发；需核对平台使用记录，当前没有自动对账或放弃跟踪界面。
- 原始结果已落盘时，临时文件写入失败可以用原 UUID 再次恢复。正常 Ctrl+C 会等待进行中的请求结束；强制结束没有这项保证。
- 401／403：检查 Key、模型权限、地区与账户；429：检查额度和频率。不要反复创建不确定的任务。
- 没有图片、安全拒绝、非 PNG、尺寸或颜色不符会报错。不要换成宽松解码强行回填。
- 异常退出遗留 `gateway.lock` 时，先确认记录的进程已结束，再移除锁。数据目录包含私人图片和提示词，不要公开。

拿到 Key 后，需逐项验收七种模式、中英界面、颜色／透明边缘、选区和保护区、回填与撤销、多个候选、断线与服务重启，以及两种插件安装路径。完成这些检查后再更新兼容清单、截图和发布状态。服务端抽象、重写与恢复约定见仓库根目录 `BACKEND.md` 和 `AGENTS.md`。
