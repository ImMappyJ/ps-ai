<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">接入阿里云百炼</h1>
<p align="center"><strong>简体中文</strong> · <a href="BAILIAN.en.md">English</a></p>

**PS-AI 0.5.0** 已包含 BaiLian 适配。真实 API 出图与 Photoshop 应用仍待使用真实 Key 实测，下方模型列表表示代码已实现的适配范围。

## 从面板连接

Windows 安装 **Node.js 24+** 后重启 Photoshop。打开“设置 → 模型与连接”，选择 **BaiLian**，输入 API Key 并点“保存 Key”。允许本地启动器运行，再扫描模型、选择模型、保存并连接。自动地址为 `http://127.0.0.1:8191`。

连接检查不生成图片，也不核验账号权限。Key 加密保存在 UXP secureStorage 中，不进入配置导出、历史或日志。生成时会上传图片、参考图和提示词。保存、切换和停止本地服务见[平台配置](../setup/PLATFORMS.md)。

## 手动服务（进阶）

在源码目录运行 `npm ci`，再用 PowerShell 启动一个平台。请选择 8191–8193 之外的空闲端口：

```powershell
$env:PSAI_PROVIDER = 'bailian'
$platformSecureKey = Read-Host 'BaiLian API Key' -AsSecureString
$env:DASHSCOPE_API_KEY = [Net.NetworkCredential]::new('', $platformSecureKey).Password
npm run gateway -- --port 8190
```

面板选择“手动适配服务（进阶）”，填 `http://localhost:8190`。构建后可将最后一行换成 `node .\dist\gateway\ps-ai-gateway.mjs --port 8190`；环境工具包使用 `node .\backend\ps-ai-gateway.mjs --port 8190`，都需要 Node 24。修改环境变量后重启。

默认目录 `~/.ps-ai/bailian` 与自动服务独立，可用 `PSAI_GATEWAY_DATA_DIR` 或 `--data-dir` 指定。多个实例需要不同端口和目录。不提供 Key 可以查看能力，不能生成。

默认上游为 `https://dashscope.aliyuncs.com/api/v1`。Key、地域和模型需匹配。使用业务空间端点时，在启动手动服务**之前**设置以下变量，并将 `WORKSPACE_ID` 替换为实际 ID：

```powershell
$env:DASHSCOPE_BASE_URL = 'https://WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/api/v1'
```

其他已支持的业务空间地域包括新加坡、美国弗吉尼亚、中国香港、德国法兰克福和日本东京，见[官方端点说明](https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference)。

## 模型与接口

| 模型 | 适配入口 | 状态 |
| --- | --- | --- |
| `qwen-image-2.1-pro`（默认）、`qwen-image-2.1-turbo` | 文字生图、编辑／参考、透明素材 | 官方能力映射 |
| `qwen-image-3.0`、`qwen-image-3.0-pro` | 文字生图、编辑／参考 | 透明特效／氛围素材入口禁用 |

生成仍会先捕获来源状态；选区、保护区、原图层与撤销约束沿用本地路径。平台的范围辅助属于视觉提示，不能当作严格模型遮罩。图片、参考图与提示词将上传百炼，并保存在本机插件／服务的数据目录中。

<a id="存储排错与退出"></a>

<a id="有-key-后的验收清单"></a>

## 任务与结果

种子可设，步数由平台控制。服务同时保存本地 UUID 和平台任务 ID。断线后在原记录上点“恢复任务”。平台结果会过期，应及时下载；服务没有独立于插件轮询的下载器。

- “停止后续候选”让当前平台请求继续完成并保存结果，不会取消该请求或保证停止计费。Ctrl+C 会等待当前工作收尾后退出。
- 401/403 检查 Key、地域和模型权限；429 检查额度和限流。
- 输出须为 sRGB8 PNG。只有确认无标签输出实际为 sRGB 后，才在启动手动服务前设置 `$env:PSAI_BAILIAN_ASSUME_SRGB = '1'`；这不会转换未知 ICC，也不会接受 JPEG、HDR 或损坏 PNG。
- 保留状态不明的任务和 UUID。历史中对 `unknown` 的两步“停止本地追踪”不会取消远端工作；重新生成可能重复计费。暂不支持自动对账或手动补绑平台 ID。
- `raw/` 中已保存的原始输出可按 UUID 恢复临时写盘失败。迁移时备份整个私人数据目录；确认 `gateway.lock` 对应进程退出后，才移除残留锁。

百炼支持取消排队任务，但本适配未开放经过实测的远端取消，见[任务说明](https://help.aliyun.com/zh/model-studio/manage-asynchronous-tasks)。输出为 8 位，应用到 16 位文档不会增加生成精度。

首次实测先生成一张，检查尺寸、色彩与透明度，在已保存的副本上应用、撤销一次，再测试原 ID 恢复。最终编辑边界由 Photoshop 选区和保护区控制。详见[使用指南](../usage/USER_GUIDE.md)和[后端约定](../development/BACKEND.en.md)。
