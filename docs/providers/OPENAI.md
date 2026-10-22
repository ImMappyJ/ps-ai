<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">接入 OpenAI Images</h1>
<p align="center"><strong>简体中文</strong> · <a href="OPENAI.en.md">English</a></p>

**PS-AI 0.5.0** 已包含 GPT Image 适配。真实 API 出图与 Photoshop 应用仍待使用真实 Key 实测，下方模型列表表示代码已实现的适配范围。

## 从面板连接

Windows 安装 **Node.js 24+** 后重启 Photoshop。打开“设置 → 模型与连接”，选择 **GPT Image**，输入 API Key 并点“保存 Key”。允许本地启动器运行，再扫描模型、选择模型、保存并连接。自动地址为 `http://127.0.0.1:8193`。

连接检查不生成图片，也不核验账号权限。Key 加密保存在 UXP secureStorage 中，不进入配置导出、历史或日志。生成时会上传图片、参考图和提示词。保存、切换和停止本地服务见[平台配置](../setup/PLATFORMS.md)。

## 手动服务（进阶）

在源码目录运行 `npm ci`，再用 PowerShell 启动一个平台。请选择 8191–8193 之外的空闲端口：

```powershell
$env:PSAI_PROVIDER = 'openai'
$platformSecureKey = Read-Host 'GPT Image API Key' -AsSecureString
$env:OPENAI_API_KEY = [Net.NetworkCredential]::new('', $platformSecureKey).Password
npm run gateway -- --port 8190
```

面板选择“手动适配服务（进阶）”，填 `http://localhost:8190`。构建后可将最后一行换成 `node .\dist\gateway\ps-ai-gateway.mjs --port 8190`；环境工具包使用 `node .\backend\ps-ai-gateway.mjs --port 8190`，都需要 Node 24。修改环境变量后重启。

默认目录 `~/.ps-ai/openai` 与自动服务独立，可用 `PSAI_GATEWAY_DATA_DIR` 或 `--data-dir` 指定。多个实例需要不同端口和目录。不提供 Key 可以查看能力，不能生成。

## 模型与接口

| 模型 ID | 本适配器的尺寸处理 |
| --- | --- |
| `gpt-image-2.5-sunburst` | 灵活尺寸；边长对齐 16，像素不足时等比放大补边 |
| `gpt-image-2.5-flare` | 同上 |
| `gpt-image-1.5` | 选择 1024×1024、1536×1024 或 1024×1536 画布，等比补边 |

模型及参数依据 [官方 Images 指南](https://developers.openai.com/api/docs/guides/image-generation)。列表表示代码声明的适配范围，不等于账号权限或真实效果已经验收。

文字生图与纯文字素材调用 [生成接口](https://developers.openai.com/api/reference/resources/images/methods/generate)；编辑和参考当前图片与选区的素材调用 [编辑接口](https://developers.openai.com/api/reference/resources/images/methods/edit)。使用官方 JSON 图片引用、单张 PNG Base64 结果，固定 `quality: medium`、`n: 1`。特效／氛围素材显式请求透明背景，收到不含透明像素的结果会拒绝发布。其他模式请求不透明输出；“保留原透明轮廓”由插件最终合成处理。

来源是第一张图片，可选角色参考紧随其后。范围辅助转换为独立 API 蒙版：灰度白色变为可编辑透明 alpha，黑色变为保护的非透明 alpha，保留羽化；补边保持保护，不占角色参考图片编号。图片素材使用来源参考位置、尺度、透视、色调和光线，以蒙版指定独立透明素材的放置范围，不使用额外导入参考。见[素材输入与验收限制](../usage/USER_GUIDE.md#context-assets)。Photoshop 的选区和保护区控制最终应用边界。

目前协议请求上限为 2048² 像素。2.5 的请求比例限 1:3 至 3:1，画布至少 655,360 像素；1.5 可处理更窄长的请求，但有效模型像素会减少。来源与蒙版按同一规则补边，输出按同一坐标逆裁，再缩放到请求尺寸。不会直接把不同长宽比的图强行拉伸回选区。该几何处理不能保证模型不移动主体。

每张原始／准备后的输入 PNG 上限 10 MiB，响应 JSON 上限 32 MiB。输入超限时，请调整选区、上下文或分辨率。

暂不开放采样步数、可设种子、16 位、流式预览、Responses 会话或第三方“兼容 OpenAI”的中转端点。每个候选单独调用平台，数量 1–4，按顺序处理。

<a id="实际验收"></a>

## 结果、恢复与排错

此 API 直接返回图片，没有用于找回丢失响应的远端任务 ID。本地 UUID 在发送前保存。超时或保存前强制退出可能留下 `unknown`，需核对平台记录后再决定是否创建新任务。

- “停止后续候选”让当前平台请求继续完成并保存结果，不会取消该请求或保证停止计费。Ctrl+C 会等待当前工作收尾后退出。
- 401/403 检查 Key、地域和模型权限；429 检查额度和限流。
- 输出须为 sRGB8 PNG。只有确认无标签输出实际为 sRGB 后，才在启动手动服务前设置 `$env:PSAI_OPENAI_ASSUME_SRGB = '1'`；这不会转换未知 ICC，也不会接受 JPEG、HDR 或损坏 PNG。
- 保留状态不明的任务和 UUID。历史中对 `unknown` 的两步“停止本地追踪”不会取消远端工作；重新生成可能重复计费。暂不支持自动对账或手动补绑平台 ID。
- `raw/` 中已保存的原始输出可按 UUID 恢复临时写盘失败。迁移时备份整个私人数据目录；确认 `gateway.lock` 对应进程退出后，才移除残留锁。

首次实测先生成一张，检查尺寸、色彩与透明度，在已保存的副本上应用、撤销一次，再测试原 ID 恢复。最终编辑边界由 Photoshop 选区和保护区控制。详见[使用指南](../usage/USER_GUIDE.md)和[后端约定](../development/BACKEND.en.md)。
