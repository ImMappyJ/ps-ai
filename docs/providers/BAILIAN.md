<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">接入阿里云百炼</h1>
<p align="center"><strong>简体中文</strong> · <a href="BAILIAN.en.md">English</a></p>

当前开发分支已加入百炼适配服务，**尚未用真实 API Key 完成平台与 Photoshop 验收**。现有 v0.4.0 Release 不包含本轮功能；本页用于开发测试及后续发行验收。已有 ComfyUI 可以继续使用，不需要卸载或改配置。

## 1. 先启动本机适配服务

需要 Node.js 24 或更高版本。插件连接本机适配服务，由服务调用百炼；模型推理由平台执行，不要求本机 GPU 承担推理或安装 ComfyUI。

从源码测试：

```powershell
git clone https://github.com/ImMappyJ/ps-ai.git
cd ps-ai
# 切到包含百炼适配代码的版本后：
npm ci
$env:PSAI_PROVIDER = 'bailian'
npm run gateway -- --port 8190
```

没有 Key 也能启动。终端会显示 `key configured=false`，此时只能检查能力清单，生成会被阻止，不会发起平台任务：

```powershell
Invoke-RestMethod http://localhost:8190/psai/v1/capabilities
```

后续使用包含此功能的环境工具 ZIP 时，可解压后直接运行内置服务，不需要 npm 或编译：

```powershell
node .\backend\ps-ai-gateway.mjs --port 8190
```

## 2. 拿到 Key 后配置服务端

在启动服务的 PowerShell 中输入 Key。不要填到 Photoshop 地址栏、插件配置 JSON 或 Git 文件中：

```powershell
$bailianSecureKey = Read-Host '百炼 API Key' -AsSecureString
$env:DASHSCOPE_API_KEY = [Net.NetworkCredential]::new('', $bailianSecureKey).Password
$env:DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'
$env:PSAI_PROVIDER = 'bailian'
npm run gateway -- --port 8190
```

使用独立文件时，把最后一行换成上一节的 `node` 命令。变量只对当前终端和子进程生效；关闭终端后需要重新配置。服务启动后修改 Key 或地址，需要重启适配服务。

Key、模型与服务地域要匹配。使用业务空间专属域名时，将 `WORKSPACE_ID` 替换为实际 ID，例如：

```powershell
$env:DASHSCOPE_BASE_URL = 'https://WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/api/v1'
```

其他已支持的业务空间地域包括新加坡、美国弗吉尼亚、中国香港、德国法兰克福和日本东京。按 [官方地域与接口说明](https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference) 选择实际端点。模型列表是代码声明的适配范围，不证明当前账户已经开通这些模型。

## 3. 在插件中选择

开发测试先运行 `npm run build`，通过 UXP Developer Tool 加载 `dist/plugin/manifest.json`，完整加载步骤见 [README](../../README.md)。

1. 展开“模型与连接”。
2. 后端类型选择“平台适配服务（实验）”。
3. 地址填 `http://localhost:8190`；自定义端口时两处保持一致。
4. 点击“扫描模型”，选择已开通的模型，再“保存配置”和“连接”。也可导入 [百炼配置样例](../../config/settings.bailian.example.json)。
5. 先用文字生图生成一张候选，再测试有选区的局部编辑。描述示例：给腿部穿上白色过膝袜，保留姿势和未选区域。

平台模式下不配置 GGUF、编码器或 VAE；步数由平台控制，输出目前固定 8 位。即使显示“已连接”，也只表示服务与配置检查通过，实际权限和出图仍须调用验证。

| 模型 | 适配入口 | 状态 |
| --- | --- | --- |
| `qwen-image-2.1-pro`（默认）、`qwen-image-2.1-turbo` | 文字生图、编辑／参考、透明素材 | 官方能力映射，真实效果待验收 |
| `qwen-image-3.0`、`qwen-image-3.0-pro` | 文字生图、编辑／参考 | 透明特效／氛围素材入口禁用，真实效果待验收 |

生成仍会先捕获来源状态；选区、保护区、原图层与撤销约束沿用本地路径。平台的范围辅助属于视觉提示，不能当作严格模型遮罩。图片、参考图与提示词将上传百炼，并保存在本机插件／服务的数据目录中。

## 4. 任务与结果

- 服务保存本地 UUID 和平台任务 ID。断线后用“恢复任务”，不要反复点击生成。
- 目前按钮为“停止后续候选”：当前平台任务仍继续，完成后保留候选。百炼只允许取消尚未开始的排队任务，本适配尚未完成该接口实测，因此没有声明真正中断能力。[官方任务说明](https://help.aliyun.com/zh/model-studio/manage-asynchronous-tasks)
- 显示排队／生成等阶段，不虚构采样步数或剩余时间。候选按顺序生成，每张都是独立平台调用。
- 结果检查尺寸、PNG、颜色、位深与素材透明度。编辑尺寸不一致会拒绝回填，原始结果留在服务端 `raw/`。
- 输出只有 8 位。可以回填 16 位来源文档，但生成区域不会因此获得真实 16 位细节；原有 ComfyUI 的 SDR16 仍独立可用。
- 平台结果有时效，及时恢复并下载；当前服务没有脱离插件查询的后台下载巡检。

## 5. 存储、排错与退出

默认数据目录是当前账户的 `~/.ps-ai/bailian`。用 `PSAI_GATEWAY_DATA_DIR` 指定目录，或使用 `--data-dir`。正常用 Ctrl+C 退出，不会停止 ComfyUI。

| 情况 | 处理 |
| --- | --- |
| `key configured=false`／提示缺 Key | 在同一个终端配置 `DASHSCOPE_API_KEY` 后重启服务 |
| 401／403 | 核对 Key、地域、业务空间及模型权限；服务不会回显 Key |
| 429 | 检查平台配额和频率限制；已有任务先按 ID 查询 |
| 输出未标记 sRGB | 先确认平台 PNG 的实际颜色约定。只有确认其本就是 sRGB 时，才显式设置 `PSAI_BAILIAN_ASSUME_SRGB=1` 后重启；此选项不会转换未知 ICC |
| 画布尺寸或透明度不符 | 检查原始输出、所选模式和模型；不要强行拉伸或伪造透明通道 |
| `unknown` 且没有平台 ID | 人工核对平台记录，当前没有自动对账或放弃跟踪界面；不要删除元数据并重复创建 |
| 数据目录已加锁 | 先关闭原服务；异常终止时，确认 `gateway.lock` 中的 PID 已退出后才移除遗留锁 |

服务只监听本机，不是带账户认证的公共服务。需要迁移时，正常停止后备份整个数据目录；它包含提示词和图片，不要上传到仓库或 Issue。服务端重写、持久化顺序及接口字段见 [后端开发文档](../development/BACKEND.md) 与 [AGENTS.md](../../AGENTS.md)。

## 6. 有 Key 后的验收清单

- [ ] 核对地域、账户权限和模型 ID，成功完成一张文字生图。
- [ ] 用同一演示图验证局部编辑、服装／道具、移除、背景、角色参考、场景、特效和氛围，逐项保存真实截图。
- [ ] 检查尺寸、sRGB、透明边缘、选区／保护区外像素、原图层和一次撤销。
- [ ] 验证多个候选、停止后续候选、插件重载、服务正常重启和丢失响应后的原 ID 恢复。
- [ ] 分别检查中英文面板、CCX／Portable 安装和最终发行包内容，再更新兼容清单与功能状态。

离线测试与本机假平台通过不等于以上实测通过。完成后再发布包含百炼功能的新版本。
