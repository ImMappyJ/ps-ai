<p align="center"><img src="assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">接入 OpenAI Images</h1>
<p align="center"><strong>简体中文</strong> · <a href="OPENAI.en.md">English</a></p>

开发分支已加入 OpenAI Images 适配器。**尚未使用真实 API Key 验证平台出图或 Photoshop 回填**，已发布的 v0.4.0 包不包含这项功能。现有 ComfyUI、百炼和 Gemini 路径可以继续使用。

## 启动服务

需要 Node.js 24+。在包含此功能的源码版本执行 `npm ci`，然后在仓库目录的 PowerShell 中运行：

```powershell
$env:PSAI_PROVIDER = 'openai'
$openaiSecureKey = Read-Host 'OpenAI API Key' -AsSecureString
$env:OPENAI_API_KEY = [Net.NetworkCredential]::new('', $openaiSecureKey).Password
npm run gateway -- --port 8192
```

没有 Key 时省略输入凭据的两行即可。服务仍能启动、读取能力，生成会在本机被阻止。变量只对当前终端和子进程生效；修改 Key 后重启服务。需要对应 API 项目的模型权限和可用额度。

构建后也可用 `node .\dist\gateway\ps-ai-gateway.mjs --port 8192` 启动。后续环境工具 ZIP 会包含独立文件，无需编译或 npm：

```powershell
node .\backend\ps-ai-gateway.mjs --port 8192
```

服务只监听 127.0.0.1，默认数据在 `~/.ps-ai/openai`。可用 `--data-dir` 或 `PSAI_GATEWAY_DATA_DIR` 修改。若同时运行其他平台，端口和数据目录均需独立。没有本机模型推理，不要求安装 ComfyUI；Photoshop 自身的系统要求仍然适用。

## 连接插件

开发测试先 `npm run build`，按 [README](README.md) 使用 UXP Developer Tool 加载构建后的插件。

1. 展开“模型与连接”，后端类型选择“平台适配服务（实验）”。
2. 地址填 `http://localhost:8192`，不要填 OpenAI API 地址或 Key。
3. 扫描模型，选择已开通的模型，再保存配置和连接。也可导入 [配置样例](config/settings.openai.example.json)。
4. 先测试一张文字生图，再在已保存的副本上建立腿部选区，尝试“给腿部穿上白色过膝袜，保留姿势和其他区域”。
5. 需要模型侧范围提示时开启范围辅助；使用角色参考时再选择参考图。预览后应用为独立图层，检查边缘与颜色。

图像、范围辅助、参考和提示词会上传 OpenAI，也会保存在插件及本机服务的数据目录。Key 只在服务环境中配置，不进入插件配置、历史记录或仓库。

## 模型与接口

| 模型 ID | 本适配器的尺寸处理 |
| --- | --- |
| `gpt-image-2.5-sunburst`（默认） | 灵活尺寸；边长对齐 16，像素不足时等比放大补边 |
| `gpt-image-2.5-flare` | 同上 |
| `gpt-image-1.5` | 选择 1024×1024、1536×1024 或 1024×1536 画布，等比补边 |

模型及参数依据 [官方 Images 指南](https://developers.openai.com/api/docs/guides/image-generation)。列表表示代码声明的适配范围，不等于账号权限或真实效果已经验收。

文字生图与素材调用 [生成接口](https://developers.openai.com/api/reference/resources/images/methods/generate)，编辑调用 [编辑接口](https://developers.openai.com/api/reference/resources/images/methods/edit)。使用官方 JSON 图片引用、单张 PNG Base64 结果，固定 `quality: medium`、`n: 1`。特效／氛围素材显式请求透明背景，收到不含透明像素的结果会拒绝发布。其他模式请求不透明输出；“保留原透明轮廓”由插件最终合成处理。

来源是第一张图片，角色参考紧随其后。范围辅助转换为独立 API 蒙版：灰度白色对应可编辑的透明 alpha，黑色对应保护的非透明 alpha，羽化灰度保留；补边区域保持保护。它不会占用角色参考的图片编号。模型可能偏离范围提示，最终编辑边界仍由 Photoshop 选区和保护区约束。

目前协议请求上限为 2048² 像素。2.5 的请求比例限 1:3 至 3:1，画布至少 655,360 像素；1.5 可处理更窄长的请求，但有效模型像素会减少。来源与蒙版按同一规则补边，输出按同一坐标逆裁，再缩放到请求尺寸。不会直接把不同长宽比的图强行拉伸回选区。该几何处理不能保证模型不移动主体。

暂不开放采样步数、可设种子、16 位、流式预览、Responses 会话或第三方“兼容 OpenAI”的中转端点。每个候选单独调用平台，数量 1–4，按顺序处理。

## 结果、恢复与排错

默认只接受已标记 sRGB 的 8 位 PNG。确认平台实际输出本来就是 sRGB 后，才显式设置 `$env:PSAI_OPENAI_ASSUME_SRGB = '1'` 并重启。它只解释缺失标记，不转换未知 ICC、接受 JPEG／HDR 或绕过坏图检查。

Images 请求直接返回图片。本适配器没有可用于重取结果的远端任务 ID；本地 UUID 先落盘，再由后台发起一次请求。正常 Ctrl+C 会等待进行中的工作收尾；“停止后续候选”不会中断当前请求或保证停止计费，返回结果仍保存。

| 情况 | 处理 |
| --- | --- |
| 缺少 `OPENAI_API_KEY` | 在启动服务的同一个终端配置后重启 |
| 401／403 | 核对项目 Key、权限和模型访问条件；错误响应不会回显凭据或原始平台消息 |
| 429 | 检查额度与频率限制；先处理已有任务 |
| HTTP 408、超时、断线或未读完响应 | 保留 `unknown`，不自动重发收费请求；核对平台记录 |
| 明确无图、非 PNG、尺寸／颜色／透明度不符 | 记录失败；已落盘原始结果留在服务 `raw/` |
| 窄长选区、准备后的输入超过 10 MiB | 调整选区／上下文或分辨率；不会在超出接口预算时继续提交 |
| 数据目录已加锁 | 先正常关闭旧实例；异常退出时确认记录的 PID 已结束后再清理遗留锁 |

原始及准备后的输入 PNG 每张最多 10 MiB，OpenAI 响应 JSON 最多 32 MiB。未知结果尚无自动对账或放弃跟踪界面；不要删元数据并重复生成。原始结果已保存时，临时磁盘写入错误可按原 UUID 恢复。迁移要备份整个私人数据目录，不要上传到 Issue。

## 实际验收

拿到 Key 后需逐项测试：三种模型的权限与返回格式、九种模式、范围辅助／参考组合、透明素材、颜色与坐标、保护区、原图层和一次撤销、多候选、停止与断线恢复、中英面板及 CCX／Portable 安装。完成后再更新截图、兼容清单与发版状态；离线模拟不是平台或宿主验收。

服务端接口与持久化开发约定见仓库根目录 `BACKEND.md` 和 `AGENTS.md`。
