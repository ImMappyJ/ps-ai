<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">接入 OpenAI Images</h1>
<p align="center"><strong>简体中文</strong> · <a href="OPENAI.en.md">English</a></p>

**0.5.0**包含 OpenAI Images 适配器。**尚未使用真实 API Key 验证平台出图或 Photoshop 回填**；代码与离线测试不证明账号权限或输出质量。请按[README](../../README.md#安装发行包)使用匹配的 0.5.0 包或源码构建；v0.4.0 历史包不含此适配器。

## 从面板连接

完整步骤见[平台配置](../setup/PLATFORMS.md)。Windows 安装 Node.js 24+，打开“设置 → 模型与连接”，选择 **GPT Image**，输入 API Key，点“保存 Key”，允许 Photoshop 打开随包本地启动器。扫描并选择模型，保存配置后连接。自动管理地址为 `http://127.0.0.1:8193`。

Key 加密保存在 UXP secureStorage 中，本机中转只在内存使用；不会进入 JSON 导出、历史或日志。连接检查不生成图片，也不验证账号权限。点击生成后才向平台上传图片、参考和提示词，同时在本机私人目录保留。可以从面板停止本地服务，未完成任务仍按原 ID 保留。

## 手动服务（进阶）

需要其他系统、自选设置时，在源码目录运行 `npm ci`，然后用 PowerShell 启动一个平台。请选择自动管理范围 8191–8193 之外的空闲端口：

```powershell
$env:PSAI_PROVIDER = 'openai'
$platformSecureKey = Read-Host 'GPT Image API Key' -AsSecureString
$env:OPENAI_API_KEY = [Net.NetworkCredential]::new('', $platformSecureKey).Password
npm run gateway -- --port 8190
```

构建后可把最后一行换成 `node .\dist\gateway\ps-ai-gateway.mjs --port 8190`；环境工具包使用 `node .\backend\ps-ai-gateway.mjs --port 8190`，无需编译，但仍需要 Node 24。面板选择“手动适配服务（进阶）”，填 `http://localhost:8190`。Key 只从当前终端环境读取，修改后重启；省略 Key 可以读取能力，不能生成。默认目录 `~/.ps-ai/openai` 与自动服务独立，可用 `--data-dir` 指定。多个手动实例需要不同端口和目录。

## 模型与接口

| 模型 ID | 本适配器的尺寸处理 |
| --- | --- |
| `gpt-image-2.5-sunburst` | 灵活尺寸；边长对齐 16，像素不足时等比放大补边 |
| `gpt-image-2.5-flare` | 同上 |
| `gpt-image-1.5` | 选择 1024×1024、1536×1024 或 1024×1536 画布，等比补边 |

模型及参数依据 [官方 Images 指南](https://developers.openai.com/api/docs/guides/image-generation)。列表表示代码声明的适配范围，不等于账号权限或真实效果已经验收。

文字生图与纯文字素材调用 [生成接口](https://developers.openai.com/api/reference/resources/images/methods/generate)；编辑和参考当前图片与选区的素材调用 [编辑接口](https://developers.openai.com/api/reference/resources/images/methods/edit)。使用官方 JSON 图片引用、单张 PNG Base64 结果，固定 `quality: medium`、`n: 1`。特效／氛围素材显式请求透明背景，收到不含透明像素的结果会拒绝发布。其他模式请求不透明输出；“保留原透明轮廓”由插件最终合成处理。

来源是第一张图片，可选角色参考紧随其后。范围辅助转换为独立 API 蒙版：灰度白色变为可编辑透明 alpha，黑色变为保护的非透明 alpha，保留羽化；补边保持保护，不占角色参考图片编号。图片素材使用来源参考位置、尺度、透视、色调和光线，以蒙版指定独立透明素材的放置范围，不使用额外导入参考。见[素材输入与验收限制](../usage/USER_GUIDE.md#context-assets)。这条适配路径已实现，但真实输出未验收；最终回填边界仍由 Photoshop 选区与保护区约束。

目前协议请求上限为 2048² 像素。2.5 的请求比例限 1:3 至 3:1，画布至少 655,360 像素；1.5 可处理更窄长的请求，但有效模型像素会减少。来源与蒙版按同一规则补边，输出按同一坐标逆裁，再缩放到请求尺寸。不会直接把不同长宽比的图强行拉伸回选区。该几何处理不能保证模型不移动主体。

暂不开放采样步数、可设种子、16 位、流式预览、Responses 会话或第三方“兼容 OpenAI”的中转端点。每个候选单独调用平台，数量 1–4，按顺序处理。

## 结果、恢复与排错

默认只接受已标记 sRGB 的 8 位 PNG。确认平台实际输出本来就是 sRGB 后，才显式设置 `$env:PSAI_OPENAI_ASSUME_SRGB = '1'` 并重启。它只解释缺失标记，不转换未知 ICC、接受 JPEG／HDR 或绕过坏图检查。

Images 请求直接返回图片。本适配器没有可用于重取结果的远端任务 ID；本地 UUID 先落盘，再由后台发起一次请求。正常 Ctrl+C 会等待进行中的工作收尾；“停止后续候选”不会中断当前请求或保证停止计费，返回结果仍保存。

| 情况 | 处理 |
| --- | --- |
| 缺少 `OPENAI_API_KEY` | 在面板保存 Key；手动服务需在同一个终端配置后重启 |
| 401／403 | 核对项目 Key、权限和模型访问条件；错误响应不会回显凭据或原始平台消息 |
| 429 | 检查额度与频率限制；先处理已有任务 |
| HTTP 408、超时、断线或未读完响应 | 保留 `unknown`，不自动重发收费请求；核对平台记录 |
| 明确无图、非 PNG、尺寸／颜色／透明度不符 | 记录失败；已落盘原始结果留在服务 `raw/` |
| 窄长选区、准备后的输入超过 10 MiB | 调整选区／上下文或分辨率；不会在超出接口预算时继续提交 |
| 数据目录已加锁 | 先正常关闭旧实例；异常退出时确认记录的 PID 已结束后再清理遗留锁 |

原始及准备后的输入 PNG 每张最多 10 MiB，OpenAI 响应 JSON 最多 32 MiB。服务端对账与平台 ID 认领仍未实现；历史仅对 `unknown` 提供双步骤停止本地跟踪，保留原 ID 和全部数据，不取消任务或停止计费，新生成可能重复执行，见[用户指南](../usage/USER_GUIDE.md)。不要删除未知任务的元数据。原始结果已保存时，临时磁盘写入错误可按原 UUID 恢复。迁移要备份整个私人数据目录，不要上传到 Issue。

## 实际验收

拿到 Key 后需逐项测试：三种模型的权限与返回格式、十一种模式（含光影重塑与溶图）、范围辅助／参考组合、透明素材、颜色与坐标、保护区、原图层和一次撤销、多候选、停止与断线恢复、中英面板及 CCX／Portable 安装。完成后再更新截图、兼容清单与发版状态；离线模拟不是平台或宿主验收。

服务端接口与持久化开发约定见仓库的 `docs/development/BACKEND.md` 和 `AGENTS.md`。
