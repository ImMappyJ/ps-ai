<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">接入阿里云百炼</h1>
<p align="center"><strong>简体中文</strong> · <a href="BAILIAN.en.md">English</a></p>

当前开发分支已加入百炼适配服务，**尚未用真实 API Key 完成平台与 Photoshop 验收**。现有 v0.4.0 Release 不包含本轮功能；本页用于开发测试及后续发行验收。已有 ComfyUI 可以继续使用，不需要卸载或改配置。

## 从面板连接

开发版的完整步骤见 [平台配置](../setup/PLATFORMS.md)。Windows 安装 Node.js 24+，展开“模型与连接”，选择 **BaiLian**，输入该平台的 API Key，点“保存 Key”，允许 Photoshop 打开随包提供的本地启动器。扫描并选择模型，保存配置后连接。自动管理的地址是 `http://127.0.0.1:8191`。

Key 加密保存在 UXP secureStorage 中，本机中转只在内存使用；不会进入 JSON 导出、历史或日志。连接检查不生成图片，也不验证账号权限。点击生成后才向平台上传图片、参考和提示词，同时在本机私人目录保留。可以从面板停止本地服务，未完成任务仍按原 ID 保留。

## 手动服务（进阶）

需要其他系统、自选设置时，在源码目录运行 `npm ci`，然后用 PowerShell 启动一个平台。请选择自动管理范围 8191–8193 之外的空闲端口：

```powershell
$env:PSAI_PROVIDER = 'bailian'
$platformSecureKey = Read-Host 'BaiLian API Key' -AsSecureString
$env:DASHSCOPE_API_KEY = [Net.NetworkCredential]::new('', $platformSecureKey).Password
npm run gateway -- --port 8190
```

构建后可把最后一行换成 `node .\dist\gateway\ps-ai-gateway.mjs --port 8190`；环境工具包使用 `node .\backend\ps-ai-gateway.mjs --port 8190`，无需编译，但仍需要 Node 24。面板选择“手动适配服务（进阶）”，填 `http://localhost:8190`。Key 只从当前终端环境读取，修改后重启；省略 Key 可以读取能力，不能生成。默认目录 `~/.ps-ai/bailian` 与自动服务独立，可用 `--data-dir` 指定。多个手动实例需要不同端口和目录。

Key、模型与服务地域要匹配。使用业务空间专属域名时，将 `WORKSPACE_ID` 替换为实际 ID，例如：

```powershell
$env:DASHSCOPE_BASE_URL = 'https://WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/api/v1'
```

其他已支持的业务空间地域包括新加坡、美国弗吉尼亚、中国香港、德国法兰克福和日本东京。按 [官方地域与接口说明](https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference) 选择实际端点。模型列表是代码声明的适配范围，不证明当前账户已经开通这些模型。


Key、模型与服务地域要匹配。使用业务空间专属域名时，将 `WORKSPACE_ID` 替换为实际 ID，例如：

```powershell
$env:DASHSCOPE_BASE_URL = 'https://WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/api/v1'
```

其他已支持的业务空间地域包括新加坡、美国弗吉尼亚、中国香港、德国法兰克福和日本东京。按 [官方地域与接口说明](https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference) 选择实际端点。模型列表是代码声明的适配范围，不证明当前账户已经开通这些模型。

## 模型与接口

| 模型 | 适配入口 | 状态 |
| --- | --- | --- |
| `qwen-image-2.1-pro`（默认）、`qwen-image-2.1-turbo` | 文字生图、编辑／参考、透明素材 | 官方能力映射，真实效果待验收 |
| `qwen-image-3.0`、`qwen-image-3.0-pro` | 文字生图、编辑／参考 | 透明特效／氛围素材入口禁用，真实效果待验收 |

生成仍会先捕获来源状态；选区、保护区、原图层与撤销约束沿用本地路径。平台的范围辅助属于视觉提示，不能当作严格模型遮罩。图片、参考图与提示词将上传百炼，并保存在本机插件／服务的数据目录中。

## 任务与结果

- 服务保存本地 UUID 和平台任务 ID。断线后用“恢复任务”，不要反复点击生成。
- 目前按钮为“停止后续候选”：当前平台任务仍继续，完成后保留候选。百炼只允许取消尚未开始的排队任务，本适配尚未完成该接口实测，因此没有声明真正中断能力。[官方任务说明](https://help.aliyun.com/zh/model-studio/manage-asynchronous-tasks)
- 显示排队／生成等阶段，不虚构采样步数或剩余时间。候选按顺序生成，每张都是独立平台调用。
- 结果检查尺寸、PNG、颜色、位深与素材透明度。编辑尺寸不一致会拒绝回填，原始结果留在服务端 `raw/`。
- 输出只有 8 位。可以回填 16 位来源文档，但生成区域不会因此获得真实 16 位细节；原有 ComfyUI 的 SDR16 仍独立可用。
- 平台结果有时效，及时恢复并下载；当前服务没有脱离插件查询的后台下载巡检。

## 存储、排错与退出

默认数据目录是当前账户的 `~/.ps-ai/bailian`。用 `PSAI_GATEWAY_DATA_DIR` 指定目录，或使用 `--data-dir`。正常用 Ctrl+C 退出，不会停止 ComfyUI。

| 情况 | 处理 |
| --- | --- |
| `key configured=false`／提示缺 Key | 面板模式保存 Key；手动模式在同一个终端配置 `DASHSCOPE_API_KEY` 后重启 |
| 401／403 | 核对 Key、地域、业务空间及模型权限；服务不会回显 Key |
| 429 | 检查平台配额和频率限制；已有任务先按 ID 查询 |
| 输出未标记 sRGB | 先确认平台 PNG 的实际颜色约定。只有确认其本就是 sRGB 时，才显式设置 `PSAI_BAILIAN_ASSUME_SRGB=1` 后重启；此选项不会转换未知 ICC |
| 画布尺寸或透明度不符 | 检查原始输出、所选模式和模型；不要强行拉伸或伪造透明通道 |
| `unknown` 且没有平台 ID | 人工核对平台记录，当前没有自动对账或放弃跟踪界面；不要删除元数据并重复创建 |
| 数据目录已加锁 | 先关闭原服务；异常终止时，确认 `gateway.lock` 中的 PID 已退出后才移除遗留锁 |

服务只监听本机，不是带账户认证的公共服务。需要迁移时，正常停止后备份整个数据目录；它包含提示词和图片，不要上传到仓库或 Issue。服务端重写、持久化顺序及接口字段见 [后端开发文档](../development/BACKEND.md) 与 [AGENTS.md](../../AGENTS.md)。

## 有 Key 后的验收清单

- [ ] 核对地域、账户权限和模型 ID，成功完成一张文字生图。
- [ ] 用同一演示图验证局部编辑、服装／道具、移除、背景、角色参考、场景、特效和氛围，逐项保存真实截图。
- [ ] 检查尺寸、sRGB、透明边缘、选区／保护区外像素、原图层和一次撤销。
- [ ] 验证多个候选、停止后续候选、插件重载、服务正常重启和丢失响应后的原 ID 恢复。
- [ ] 分别检查中英文面板、CCX／Portable 安装和最终发行包内容，再更新兼容清单与功能状态。

离线测试与本机假平台通过不等于以上实测通过。完成后再发布包含百炼功能的新版本。
