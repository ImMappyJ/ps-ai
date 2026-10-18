# 构建与发布

[English](RELEASING.en.md) · [返回首页](../../README.md)

## 两条工作流

[Build packages](../../.github/workflows/build.yml) 保留 `main` push、PR 和手动构建；只有手动运行上传普通 Actions artifact，不写 GitHub Release。[Release](../../.github/workflows/release.yml) 处理 `v*` 标签 push，或默认分支上的手动请求。部署这些文件和发行脚本到 GitHub 默认分支后，自动发布才会生效。本地尚未提交或推送的代码不会进入远端构建。

Release 的构建任务只有 `contents: read`：解析已有远端标签、验证源码和版本、安装锁定依赖，再执行一次 `npm run package`（包含测试、类型检查和构建）。它校验专用输出目录内的归档并上传本次批次的 artifact。发布任务只有在非 dry run 时获得 `contents: write`，按构建输出的确切 artifact ID 下载同一批文件，复核后创建草稿、上传缺失附件、验证远端内容，最后公开草稿。发布任务不安装依赖或重新打包。

两个任务的控制脚本均直接固定到事件的 `github.workflow_sha`。手动运行必须从仓库默认分支选择工作流定义，并在任何 checkout 前校验；标签触发使用该标签的工作流定义，控制提交必须等于标签解析出的源码提交。解析器再检查控制提交属于默认分支历史、源码提交属于 `main` 历史，在独立目录构建精确源码 SHA。发布前再次核对标签对象和源码，标签漂移会失败。同一标签的运行与所有发布任务均设置不取消进行中任务的并发保护。

## 准备版本

标签格式为严格的 `vX.Y.Z`，例如 `v0.5.0`；不接受前导零、`beta` 或 `rc` 后缀。打标签前对齐并提交以下项目字段：

- `package.json` 的 `version`。
- `package-lock.json` 顶层 `version` 和 `packages[""].version`。
- `plugin/manifest.json` 的 `version`。

构建、CCX、Portable 内的 manifest 和发行文件名也必须一致。校验失败会报告字段，不会代为改版本。不要修改依赖、协议或工作流模板版本来凑发行号。

[config/release.json](../../config/release.json) 来自目标标签；格式为 `{"schemaVersion":1,"channel":"prerelease"}`。缺文件或省略 `channel` 时默认 `prerelease`，非法配置失败。只有显式 `stable` 才发布稳定通道；预发布不会成为 Latest，较旧稳定版不会把 Latest 倒退。两种通道均保留现有 `experimental` 文件名，通道选择不扩大宿主或图像质量验收范围。已发布 v0.4.0 的实验版事实及旧附件不受此流程改写。

在准备发行的源码上运行 `npm ci`、`npm run package`，检查三个归档、许可、校验和及兼容清单，并分别验证 CCX 和 Portable 安装。Photoshop 的色彩、透明度、16 位、撤销、控件及真实推理仍需人工验收；普通 CI 不运行 Photoshop、GPU 推理、大模型下载或付费平台。记录实际通过与未验证项，并维护[中英文发行说明模板](../../config/release-notes.md)。说明和指南来自目标标签，不读取更新的 `main` 来描述旧版。

本地测试会实际执行工作流的 PowerShell 守卫，需要 PowerShell 7，且 `pwsh` 位于 PATH；GitHub Windows runner 已提供它。

## 首次部署与以后发版

1. 先把工作流、发行脚本和指南提交并推送到默认分支，确认仓库允许 Actions 及该任务所需的内置令牌权限。
2. 准备下一个版本的字段、通道和说明，完成离线检查及所需人工验收。
3. 提交并推送完整发行代码，使待发提交位于 `main` 历史。
4. 核对目标提交后创建明确版本标签并推送该标签。新标签 push 会立即请求真实发布。
5. 在 Actions 检查构建和发布结果，再核对 Release 的源码、通道和附件。

这些是维护者未来执行的操作；本地合并、修改版本或生成测试包不会创建远端标签或 Release。不要移动已公开标签。代码或发行内容需要修复时，提交修复并准备新版本。

## 手动试运行

在 **Actions → Release → Run workflow** 选择默认分支，填写已存在的远端 `tag`，保留 `dry_run=true`。它执行同样的源码、版本、归档检查并保存 Actions artifact，不创建草稿、不上传 Release 附件、不生成需要写权限的 GitHub 自动说明，也不修改 Latest。只有明确设置 `dry_run=false` 才进入发布任务。

首次远端 dry run 应选择**已存在、可信、尚未公开为 Release 且包含新工具的标签**，或使用隔离测试仓库。为了试运行而推送新匹配标签会先触发真实发布；本地标签不满足远端已存在的要求。不要用旧公开版测试附件覆盖。选择非默认分支的手动工作流会被拒绝。

## 附件与完整性

每个版本 `X.Y.Z` 发布以下文件：

| 文件 | 用途 |
| --- | --- |
| `ps-ai-X.Y.Z-experimental.ccx` | CCX 插件安装包 |
| `ps-ai-X.Y.Z-portable-experimental.zip` | 含 `PS-AI-FOR-ME` 的 Portable 包 |
| `ps-ai-X.Y.Z-environment-experimental.zip` | 环境工具、配置、使用指南与独立网关 |
| 上述每个包的同名 `.sha256` | 各包的 SHA256 校验文件 |
| `release-manifest.json` | 源码、控制脚本、通道、原始构建批次及各文件的大小和 SHA256 |

清单不自我哈希；其哈希由构建输出与草稿身份共同绑定。普通 SHA256 和清单是完整性校验，不是签名或构建证明。远端校验要求文件集合、大小及摘要完全匹配，摘要不可用时下载该附件核对字节。Actions artifact 的外层 ZIP 只是传输容器。

本地 `npm run package` 仍输出到 `release/`。设置 `PSAI_RELEASE_DIR` 可选择新的专用目录；显式目录非空会失败，不会删除旧包。自动发行以源码 SHA 设置 `PSAI_SOURCE_REF`，使环境包中指向仓库开发指南的链接固定到该版本源码。

## 失败恢复

- 构建失败且未创建草稿：修复原因后重新验证；版本源码改变时使用新版本。
- 发布中断并留下本流程草稿：打开**原始成功构建所属的运行**，只重新运行失败的发布任务，保留其原始 artifact ID、清单哈希和构建 attempt。只有全部身份及已上传字节一致才补传缺失文件。
- 不要用 Re-run all jobs、另一次运行或相同提交重新打包的字节恢复草稿。ZIP 时间戳等可使同源码的包不同；批次不匹配会失败。
- 原始 artifact 过期、删除或在重跑时不可访问：流程安全失败并保留草稿，不选择其他运行或偷偷重建。维护者先处理原始失败和草稿归属；无法恢复同一批字节时准备新版本，不能混合附件。
- 来源不明、手工草稿、未知附件、身份或哈希不符：停止，维护者核查；流程不会接管、删除或覆盖。
- 已公开 Release：证据完整时只报告已完成；冲突时失败并要求新版本。流程不修改已公开说明、通道或附件，不使用 `--clobber`。

仅具体查询的已确认 404 可表示不存在；鉴权、403/429 限流、网络及服务错误会失败，不会据此创建另一个 Release。查看日志中的安全阶段分类，避免公开令牌、原始响应或下载签名 URL。

## 权限与验收记录

使用内置 `GITHUB_TOKEN`，仅 API 步骤接收 `GH_TOKEN`；checkout 不保留凭据，PR 没有发布权限。通常不需要 PAT 或额外服务。如果组织/仓库禁止所需写权限，或目标提交的工作流变更触发 GitHub 额外权限限制，应处理仓库策略并停止受限发布；不使用长期 PAT 绕过。可选不可变 Release 与先草稿、齐附件、后公开的流程兼容。

本地测试、工作流静态检查、GitHub dry run、真实发布和 Photoshop 人工验收是不同证据。首次上线前没有在线执行记录；本地通过不能标成在线或宿主通过。按目标版本指南列出真实限制，使用已保存副本测试安装、生成、应用和撤销。
