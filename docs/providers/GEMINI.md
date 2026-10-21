<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">接入 Gemini / Nano Banana</h1>
<p align="center"><strong>简体中文</strong> · <a href="GEMINI.en.md">English</a></p>

**0.5.0**包含 Google Gemini 适配器，**尚未使用真实 API Key 验证平台出图或 Photoshop 回填**。请按[README](../../README.md#安装发行包)使用匹配的 0.5.0 包或对应源码构建；v0.4.0 历史包不含此功能。Nano Banana 是 Gemini 图像模型系列的名称，接入使用 Google 官方 API，不是网页账号或第三方中转。

## 从面板连接

0.5.0 的完整步骤见 [平台配置](../setup/PLATFORMS.md)。Windows 安装 Node.js 24+，打开“设置 → 模型与连接”，选择 **Nano Banana**，输入该平台的 API Key，点“保存 Key”，允许 Photoshop 打开随包提供的本地启动器。扫描并选择模型，保存配置后连接。自动管理的地址是 `http://127.0.0.1:8192`。

Key 加密保存在 UXP secureStorage 中，本机中转只在内存使用；不会进入 JSON 导出、历史或日志。连接检查不生成图片，也不验证账号权限。点击生成后才向平台上传图片、参考和提示词，同时在本机私人目录保留。可以从面板停止本地服务，未完成任务仍按原 ID 保留。

## 手动服务（进阶）

需要其他系统、自选设置时，在源码目录运行 `npm ci`，然后用 PowerShell 启动一个平台。请选择自动管理范围 8191–8193 之外的空闲端口：

```powershell
$env:PSAI_PROVIDER = 'gemini'
$platformSecureKey = Read-Host 'Nano Banana API Key' -AsSecureString
$env:GEMINI_API_KEY = [Net.NetworkCredential]::new('', $platformSecureKey).Password
npm run gateway -- --port 8190
```

构建后可把最后一行换成 `node .\dist\gateway\ps-ai-gateway.mjs --port 8190`；环境工具包使用 `node .\backend\ps-ai-gateway.mjs --port 8190`，无需编译，但仍需要 Node 24。面板选择“手动适配服务（进阶）”，填 `http://localhost:8190`。Key 只从当前终端环境读取，修改后重启；省略 Key 可以读取能力，不能生成。默认目录 `~/.ps-ai/gemini` 与自动服务独立，可用 `--data-dir` 指定。多个手动实例需要不同端口和目录。

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

本轮只开放文字生图与八种编辑模式：物体／材质、移除、背景、服装／道具、角色参考、场景、光影重塑、溶图。不开放要求透明通道的特效／氛围素材；也不提供对话连续编辑、联网搜索、4K、可设种子或 16 位输出。步数和种子控件禁用，每张候选单独调用平台。

为保持回填坐标，来源图与范围辅助等比缩放、补边到 1024×1024。收到同尺寸方形 PNG 后，按相同补边坐标裁回原比例，再缩放到请求尺寸；参考图保留其比例。长条选区的有效模型像素较少，较大的请求可能只是放大 1K 结果。主体位置是否保持仍需实际效果验收，不能据此承诺像素级重绘精度。

默认拒绝未标记 sRGB 的 PNG。只有确认平台输出本来就是 sRGB 后，才显式设置 `$env:PSAI_GEMINI_ASSUME_SRGB = '1'` 并重启。这个开关只解释缺失标记，不会转换未知 ICC、修复 HDR、接受 JPEG 或忽略损坏图片。

## 中断与排错

Gemini 这条接口直接返回图片，没有可用于本适配器重取结果的平台任务 ID。本机服务先保存 UUID，再在后台发起一次请求，插件只查询本机状态。不要把本地 UUID 当作 Google 任务 ID。

- “停止后续候选”保留当前请求继续执行，不保证停止计费。已有结果会保存。
- 网络超时或进程退出发生在结果落盘前，可能留下 `unknown`。不会自动重发；需核对平台使用记录，服务端对账与平台 ID 认领仍未实现。0.5.0 历史仅对 `unknown` 提供双步骤停止本地跟踪，保留原 ID 和全部数据；不取消任务或停止计费，新任务可能重复执行，见[用户指南](../usage/USER_GUIDE.md)。
- 原始结果已落盘时，临时文件写入失败可以用原 UUID 再次恢复。正常 Ctrl+C 会等待进行中的请求结束；强制结束没有这项保证。
- 401／403：检查 Key、模型权限、地区与账户；429：检查额度和频率。不要反复创建不确定的任务。
- 没有图片、安全拒绝、非 PNG、尺寸或颜色不符会报错。不要换成宽松解码强行回填。
- 异常退出遗留 `gateway.lock` 时，先确认记录的进程已结束，再移除锁。数据目录包含私人图片和提示词，不要公开。

拿到 Key 后，需逐项验收九种模式（文字生图与八种编辑，不含两种透明素材）、中英界面、颜色／透明边缘、选区和保护区、回填与撤销、多个候选、断线与服务重启，以及两种插件安装路径。完成这些检查后再更新兼容清单、截图和发布状态。服务端抽象、重写与恢复约定见仓库的 `docs/development/BACKEND.md` 和 `AGENTS.md`。
