<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">接入 Gemini / Nano Banana</h1>
<p align="center"><strong>简体中文</strong> · <a href="GEMINI.en.md">English</a></p>

**当前 PS-AI 源码**已包含 Nano Banana 适配。真实 API 出图与 Photoshop 应用仍待使用真实 Key 实测，下方模型列表表示代码已实现的适配范围。

## 从面板连接

Windows 安装 **Node.js 24+** 后重启 Photoshop。打开“设置 → 模型与连接”，选择 **Nano Banana**，输入 API Key 并点“保存 Key”。允许本地启动器运行，再扫描模型、选择模型、保存并连接。自动地址为 `http://127.0.0.1:8192`。

连接检查不生成图片，也不核验账号权限。Key 加密保存在 UXP secureStorage 中，不进入配置导出、历史或日志。生成时会上传图片、参考图和提示词。保存、切换和停止本地服务见[平台配置](../setup/PLATFORMS.md)。

## 手动服务（进阶）

在源码目录运行 `npm ci`，再用 PowerShell 启动一个平台。请选择 8191–8193 之外的空闲端口：

```powershell
$env:PSAI_PROVIDER = 'gemini'
$platformSecureKey = Read-Host 'Nano Banana API Key' -AsSecureString
$env:GEMINI_API_KEY = [Net.NetworkCredential]::new('', $platformSecureKey).Password
npm run gateway -- --port 8190
```

面板选择“手动适配服务（进阶）”，填 `http://localhost:8190`。构建后可将最后一行换成 `node .\dist\gateway\ps-ai-gateway.mjs --port 8190`；环境工具包使用 `node .\backend\ps-ai-gateway.mjs --port 8190`，都需要 Node 24。修改环境变量后重启。

默认目录 `~/.ps-ai/gemini` 与自动服务独立，可用 `PSAI_GATEWAY_DATA_DIR` 或 `--data-dir` 指定。多个实例需要不同端口和目录。不提供 Key 可以查看能力，不能生成。

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

为保持回填坐标，来源图与范围辅助等比缩放、补边到 1024×1024。收到同尺寸方形 PNG 后，按相同补边坐标裁回原比例，再缩放到请求尺寸；参考图保留其比例。长条选区的有效模型像素较少，较大的请求可能只是放大 1K 结果。应用前仍需检查主体位置。

## 中断与排错

此 API 直接返回图片，没有用于找回丢失响应的远端任务 ID。本地 UUID 在发送前保存。超时或保存前强制退出可能留下 `unknown`，需核对平台记录后再决定是否创建新任务。

- “停止后续候选”让当前平台请求继续完成并保存结果，不会取消该请求或保证停止计费。Ctrl+C 会等待当前工作收尾后退出。
- 401/403 检查 Key、地域和模型权限；429 检查额度和限流。
- 输出须为 sRGB8 PNG。只有确认无标签输出实际为 sRGB 后，才在启动手动服务前设置 `$env:PSAI_GEMINI_ASSUME_SRGB = '1'`；这不会转换未知 ICC，也不会接受 JPEG、HDR 或损坏 PNG。
- 保留状态不明的任务和 UUID。历史中对 `unknown` 的两步“停止本地追踪”不会取消远端工作；重新生成可能重复计费。暂不支持自动对账或手动补绑平台 ID。
- `raw/` 中已保存的原始输出可按 UUID 恢复临时写盘失败。迁移时备份整个私人数据目录；确认 `gateway.lock` 对应进程退出后，才移除残留锁。

首次实测先生成一张，检查尺寸、色彩与透明度，在已保存的副本上应用、撤销一次，再测试原 ID 恢复。最终编辑边界由 Photoshop 选区和保护区控制。详见[使用指南](../usage/USER_GUIDE.md)和[后端约定](../development/BACKEND.en.md)。
