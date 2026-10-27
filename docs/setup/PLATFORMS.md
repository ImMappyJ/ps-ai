<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">选择生图平台</h1>
<p align="center"><strong>简体中文</strong> · <a href="PLATFORMS.en.md">English</a> · <a href="../../README.md">返回首页</a></p>

PS-AI 0.5.1 可以连接本地 ComfyUI，也可以调用云端图片 API。云端生成需要 API Key 和模型权限，费用由平台收取。

## 选择哪条路径

| 面板选项 | 需要准备 | 连接地址 |
| --- | --- | --- |
| [ComfyUI](COMFYUI.md) | 兼容后端、节点和 Qwen 2.1 模型 | 默认 `http://localhost:8188`，可修改 |
| [Nano Banana](../providers/GEMINI.md) | Google Gemini API Key | `http://127.0.0.1:8192` |
| [GPT Image](../providers/OPENAI.md) | OpenAI API Key | `http://127.0.0.1:8193` |
| [BaiLian](../providers/BAILIAN.md) | 中国内地端点对应的百炼 Key | `http://127.0.0.1:8191` |

ComfyUI 直接连接。云平台通过随包附带的本地中转连接，需要 **Node.js 24+**，无需本地推理模型。网页会员不代表已开通 API。

## 在面板中配置平台

1. Windows 安装 Node.js 24+，用 `node --version` 检查版本，然后重启 Photoshop。
2. 打开“设置 → 模型与连接”，选择平台，保留自动填入的本地地址。
3. 输入 **API Key**，点“保存 Key”；Photoshop 询问时，允许打开 PS-AI 本地启动器。
4. 点“扫描模型”，选择模型，再“保存配置”和“连接”。
5. 回到创作页面，先生成一个候选。来源图和选区要求见[使用指南](../usage/USER_GUIDE.md)。

扫描和连接不会生成图片，也不会核验上游账号权限。点击生成后，图片、参考图和提示词会上传平台，并在本机保存。

Key 加密保存在 UXP secureStorage 中，只有本地服务通过身份校验后才会接收，并在内存使用；配置导出、历史和日志不含 Key。保存后输入框会清空。CCX 和 Portable 数据独立，切换安装方式后可能需要重新输入。

插件分别记住各平台的模型；切回 ComfyUI 会恢复原地址、模型和位深。更换或清除 Key 前，先用原账号处理未完成任务。

## 模式和参数限制

| 能力 | ComfyUI | Nano Banana | GPT Image | BaiLian |
| --- | --- | --- | --- | --- |
| 文字生图和编辑，含重打光、融合 | 对应工作流支持 | 已实现适配 | 已实现适配 | 已实现适配 |
| 特效／氛围素材 | 实验性 | 不支持 | 已实现适配 | 仅 Qwen 2.1 |
| 步数／种子 | 均可设置 | 均不可设置 | 均不可设置 | 仅种子 |
| 输出 | 8 位／可选 SDR16 | 8 位 | 8 位 | 8 位 |
| 停止 | 按 ID 取消任务 | 停止后续候选 | 停止后续候选 | 停止后续候选 |

云平台适配已有离线测试，真实 API 出图与 Photoshop 应用仍待实测；列表中的模型不一定对你的账号开放。ComfyUI 带图素材在已有测试中未通过视觉验收，使用前需检查原图残留、辅助边界和透明度，详见[素材限制](../usage/USER_GUIDE.md#context-assets)。融合和重打光也需检查主体、边缘与细节后再应用。

## 停止、恢复和排错

- “停止后续候选”让当前云端请求继续完成，不会取消这一请求或保证停止计费。断线后先按原任务 ID 恢复，再决定是否重新生成。
- “停止本地服务”等待当前工作收尾，再关闭三个监听端口。关闭 Photoshop 或切回 ComfyUI 不会停止服务；连接平台可重新启动。
- 启动失败时检查 Node、Photoshop 启动许可和 **8191–8193** 端口。同一时间只运行一套 CCX 或 Portable。
- 401/403 检查 Key、地域和模型权限；429 检查额度和限流。
- 默认拒绝未标记色彩的 PNG。只有确认输出实际为 sRGB 后，才在手动服务中开启明确的 sRGB 策略。
- 自动服务任务位于插件数据的 `relay/<provider>/`。迁移时备份整个私人目录；只有确认 `gateway.lock` 记录的进程已退出，才删除残留锁。

## 手动服务与其他系统

自动启动目前支持 Windows，要求 Node 已加入 PATH。其他系统、自选端口、百炼其他地域或色彩策略请按平台指南启动服务，再选择“手动适配服务（进阶）”。手动服务从终端环境读取 Key，数据独立。不要把这些本地服务暴露到公网。
