# 服务端协议与适配开发

中文 | [English](BACKEND.en.md)

本文面向准备重写服务端、接入其他平台或修改任务存储的开发者。启动步骤见 [百炼](../providers/BAILIAN.md)、[Gemini / Nano Banana](../providers/GEMINI.md) 与 [OpenAI Images](../providers/OPENAI.md)。现有 ComfyUI 配置见 [COMFYUI.md](../setup/COMFYUI.md)。

## 两条后端路径

<a id="relighting-workbench"></a>

结构化光源状态、本地示意与语义请求映射见[光影重塑工作台](RELIGHT.md)。布光参数保存于本地任务元数据，不增加供应商协议的未知字段。

| 设置 | 请求方式 | 实现 |
| --- | --- | --- |
| `backend` 省略或 `comfyui` | ComfyUI 节点图、节点 schema、模型文件名 | [src/infrastructure/backends/client.ts](../../src/infrastructure/backends/client.ts)、[src/generation/workflow.ts](../../src/generation/workflow.ts) |
| `backend: gateway` | `ps-ai/1` 语义请求与模型能力清单 | [src/infrastructure/backends/gateway-client.ts](../../src/infrastructure/backends/gateway-client.ts)、[src/infrastructure/backends/gateway-protocol.ts](../../src/infrastructure/backends/gateway-protocol.ts) |

新协议不要求服务端安装 ComfyUI 或提供虚构的 GGUF 节点。插件负责捕获、选区、保护区、预览和安全回填；适配服务负责平台鉴权、参数转换、任务身份与结果文件。

当前实现百炼、Gemini 与 OpenAI Images 三个适配器，真实平台与宿主验收均待 API Key。插件只理解任务和能力，不理解各家的请求字段。FLUX 是扩展方向，尚未实现。

| 平台 | 接口特点 | 本轮状态 |
| --- | --- | --- |
| [百炼 Qwen Image](https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference) | 异步创建、平台任务 ID、轮询、结果 URL | BailianProvider，按平台 ID 恢复 |
| [Google Gemini / Nano Banana](https://ai.google.dev/gemini-api/docs/generate-content/image-generation) | generateContent 原生图文内容、内联图片 | GeminiProvider，本机后台执行同步请求 |
| [OpenAI Images](https://developers.openai.com/api/docs/guides/image-generation) | 分开的生成、编辑端点 | OpenAIImagesProvider，JSON 图片与原生蒙版；未接入 Responses |
| [Black Forest Labs / FLUX](https://docs.bfl.ai/quick_start/generating_images) | 返回轮询地址，异步取图 | 已调研，未实现 |

不能把“OpenAI 兼容”、相同端点名或可填写模型 ID 当作图像编辑兼容。Google Interactions 是另一套协议，本适配器尚未采用，不能用它的恢复能力描述 GenerateContent。

<a id="server-architecture"></a>

## 服务端结构

`server` 按职责拆分，根目录只留启动入口。启动命令仍为 `npm run gateway`，构建输出仍为 `dist/gateway/ps-ai-gateway.mjs`。

```text
server/
├── main.ts                   # 参数、环境配置、组装依赖、监听与退出
├── runtime/
│   └── managed-relay.ts       # 自动中转、平台监听与凭据身份
├── http/
│   ├── gateway.ts            # 路由、HTTP 状态、Host/Origin、连接生命周期
│   └── messages.ts           # 有预算的请求体与 JSON 响应
├── application/
│   └── jobs.ts               # 提交、去重、查询、恢复、串行操作与后台任务
├── persistence/
│   └── job-store.ts          # 作业记录、原子写入、输入/输出文件与目录锁
├── providers/
│   ├── contract.ts           # ImageProvider，task/inline 的共同接口
│   ├── bailian.ts
│   ├── gemini.ts
│   └── openai.ts
└── shared/
    ├── errors.ts             # 可安全返回的错误及不确定结果标记
    ├── images.ts             # PNG 输入校验与默认输出归一化
    └── io.ts                 # 平台响应的有界读取
```

HTTP 调用作业服务，作业服务调用持久化与 `ImageProvider` 接口。具体平台由 `main.ts` 注入，作业服务不导入百炼、Gemini 或 OpenAI 类。平台实现不访问作业目录，也不写入 HTTP 响应；失败抛出统一的 `ServiceError`，由 HTTP 层序列化。`shared` 不导入上层模块。插件与服务共同使用 `src/infrastructure/backends/gateway-protocol.ts` 和已有像素工具，不复制一套协议，也不把 Node 模块打进 UXP。

作业服务负责 UUID、状态和后台工作；HTTP 层负责停止接入并等待仍在落盘的 handlers。正常退出严格按 **handlers → workers → 串行写入 → store 锁** 收尾。不能为了目录拆分先释放锁，否则断线请求仍可能启动工作。`gateway.store` 仍指向同一实例，便于原有诊断和故障注入；运行时只通过作业服务读写结果。

新增平台只需在 `providers` 实现统一接口、在 `main.ts` 显式注册并补能力／请求／恢复测试。当前只有一种文件存储，不为目录整齐额外引入数据库接口、依赖注入容器或框架。文件迁移不改变 HTTP 协议、环境变量、持久化格式及任务恢复规则。

## 自动中转与凭据

面板操作见 [平台配置](../setup/PLATFORMS.md)。可选字段 `platform: bailian|gemini|openai` 选择自动管理，`connections` 保存各连接的模型与配置。原有 `backend: gateway` 不带 platform 时仍是手动服务；省略 backend 仍直连 ComfyUI。自动服务固定使用与监听一致的 IPv4 127.0.0.1，避免 localhost 解析到其他地址；旧的自动管理 localhost 配置会迁移，ComfyUI 与手动模式不变。对应端口为 8191／8192／8193。模型和普通连接字段可导出，Key 与本机令牌不能导出。

UXP 把插件 relay/ 中的独立服务及固定启动器复制到插件私人数据目录。Windows 通过声明 launchProcess 的 shell.openPath 打开 .cmd，由 Photoshop 请求授权；UXP 不直接创建 Node 子进程或传命令参数。启动器固定入口和数据路径，以隐藏窗口启动 Node 24，不拼接 Key、提示词或模型名。其他系统保留手动服务入口。启动、连接和保存配置都不创建生图任务；ComfyUI 不启动中转，切回 ComfyUI 也不关闭已运行的中转。

[自动服务组合](../../server/runtime/managed-relay.ts) 管理三个提供方及各自 relay/provider 数据目录。私人 relay-session.json 保存 Node 生成的令牌与端口。发送 Bearer 或 Key 之前，[RelayController](../../src/infrastructure/backends/relay-controller.ts) 先验证绑定平台和本次 nonce 的 HMAC 服务端证明。[relay-auth.ts](../../src/infrastructure/backends/relay-auth.ts) 在 UXP 使用锁定版本的 @noble/hashes，不把 Node crypto 引入插件。握手检查 Host／Origin，不需要 Bearer，也不返回令牌；其余接口要求 Bearer。所有请求拒绝重定向。这是本机配对，不是 TLS，也不隔离有同一系统账户和私人文件访问权的软件。

| 自动服务专用接口 | 契约 |
| --- | --- |
| GET /psai/v1/handshake | X-PSAI-Challenge nonce，返回平台与 HMAC 证明，不返回令牌或 Key |
| POST /psai/v1/configure | Bearer；JSON 只含 apiKey，空字符串清除。最多 2 KiB，不返回／记录 Key |
| POST /psai/v1/shutdown | Bearer；停止三个监听，等待 handlers、workers、写入后释放目录锁 |

Key 按平台加密保存在 UXP secureStorage，服务只在内存持有。credential-id.json 保存不可还原 Key 的带密钥摘要；迁移任务时连同会话文件一起保留。存在未完成任务时，更换或清除 Key 即使重启服务也会拒绝；允许恢复原 Key。已有未完成任务却缺少凭据身份记录时明确拒绝，不能猜测账户。安全存储丢失时重新输入，不回退到明文。已经保存的输出或原始结果转换不需要上游 Key；进一步查询平台才需要。停止会等待当前工作收尾，关闭 Photoshop 不自动结束独立进程。

手动模式继续从进程环境读 Key，使用 ~/.ps-ai/provider 或 --data-dir，支持现有地域和显式色彩策略。自动模式目前使用固定官方默认端点及严格带标记输出；其他地域或无标记 sRGB 策略走手动模式。新增提供方需要同时在 main.ts 和 runtime/managed-relay.ts 显式注册，并补平台描述、界面和恢复测试。

## ps-ai/1 接口

全部路径相对于服务根地址，JSON 使用 UTF-8。参考实现只绑定本机 `127.0.0.1`，不提供多人账户、网关登录或公网部署。

| 方法与路径 | 内容 |
| --- | --- |
| `GET /psai/v1/capabilities` | 公开协议版本、提供方、凭据是否配置及模型能力；不返回凭据 |
| `PUT /psai/v1/uploads/{id}-{role}.png` | 原始 PNG 字节，`Content-Type: image/png`，返回 `{"name":"..."}` |
| `POST /psai/v1/jobs` | 接收下方作业信封，返回 HTTP 202 与相同的 `id` |
| `GET /psai/v1/jobs/{id}` | 返回该作业的状态、错误或结果描述 |
| `GET /psai/v1/outputs/{id}.png` | 仅提供已完成作业的校验后 PNG，不直接暴露平台临时 URL |
| `POST /psai/v1/jobs/{id}/cancel` | 返回真实的 `cancelled` 布尔值。当前三个适配器均为 false |

`id`、`clientId` 是插件生成并保存的小写 UUID。上传角色是 `source`、`guide`、`reference`；不接受任意文件路径、外部图片 URL 或其他作业的输入。相同文件名不能覆盖为不同内容。

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "clientId": "00000000-0000-4000-8000-000000000002",
  "request": {
    "model": "qwen-image-2.1-pro",
    "kind": "edit",
    "mode": "edit",
    "prompt": "给腿部穿上白色过膝袜，保留姿势和其他区域。",
    "seed": 42,
    "width": 768,
    "height": 768,
    "outputDepth": 8,
    "source": "00000000-0000-4000-8000-000000000001-source.png"
  }
}
```

`kind` 为 `t2i`、`edit`、`asset`。`mode` 沿用插件的十一种模式，`relight` 和 `blend` 均属于 `edit`。编辑必须提供来源图；范围辅助与参考图按需加入。发给平台的顺序固定为来源、辅助、参考，缺省项不占位置。平台意图不自动写入图片编号，由适配器绑定实际角色。百炼／Gemini 以灰度辅助图提示范围；OpenAI 将它转为独立 mask（alpha=255-gray），images 只保留来源和参考。最终范围仍由 Photoshop 选区与保护区约束。

**0.6.0 主体素材：** `kind: asset`、`mode: effect`、`assetContext: subject-v1` 要求 3 个同坐标输入：source（来源）、guide（原始主体 S）、reference（有效放置 E，非用户外部参考）。平台必须声明 subject-v1 且 maxInputImages >= 3，否则上传前拒绝。OpenAI 把 3 图送入 images，用 reference 放置图而非主体 guide 生成原生 mask；补边仍受保护。

params 保存 `assetPlacement: {version: subject-v1, scope: context|document, occlusion: front|behind}`。冻结区域 R 为主体外接矩形加边距或整张画布；R 内 front 的 E=1-P，behind 的 E=(1-S)*(1-P)，R 外为零。subject-mask.bin 保存 S，protection-mask.bin 保存 P，mask.bin 保存 E；读回逐像素校验，不推断旧历史的新权限。`purpose: subject-asset` 即使选全画布也要求主体选区，不是 Relight 的无选区 document scope。保留输出 alpha，不乘原图 alpha、不对齐或匹配上下文色彩；层蒙版应用 E 一次。最长边 1280px 合成预览不能成为应用或导出数据。新路径仅有离线验证；下述原生和真实样本证据属于 selection-v1，不代表新三图模型质量／安装面板验收。

旧选区参考素材保留 `kind: asset`，增加 `assetContext: selection-v1`，必须同时携带 source 和 guide，禁止额外 reference。模型的可选 `assetContexts` 必须声明该版本；未声明、未知版本或在其他 kind 使用均在上传前拒绝。无标记素材保持纯文字含义，不得夹带图像。新捕获将原生位深来源与 sRGB8 送模图分开，保存原始选区、保护区及有效蒙版。回填保留输出自身 alpha，只施加一次原生有效蒙版，重新核对保存的 UUID，不重新提交。

ComfyUI 按来源、范围图排序，保留现有 LoadImage 倒置 MASK 到 alpha 的直接连接。百炼 2.1 发送两图及独立素材语义；百炼 3.0 与 Gemini 不声明该能力。OpenAI 使用 edits，images 中为来源，范围图转独立原生蒙版 alpha=255-gray；来源与蒙版同变换、补边受保护，显式透明输出并逆裁。离线测试覆盖请求几何、原始输出保留和原 UUID 恢复。真实 ComfyUI 样本出现来源残留或范围图被画入，视觉验收未通过；平台真实验收等待 API Key。存在透明像素只是必要条件，不能证明素材质量。

本轮六个 PS27 sRGB 合成 API 用例通过 RGB8/16 素材捕获、原生灰度平面、单次有效蒙版、alpha／羽化／保护、单步撤销和注入故障回滚；两个大图用例实际走 `edit-analysis`，并验证写入两条带后取消的完整恢复。外侧／保护区的可见颜色与 alpha 差异为零，透明像素下隐藏 RGB 不属于该证明。保存 UUID 的读取在这些用例中使用内存夹具，不是磁盘持久化、重启或已安装素材控件验收。五个真实 Qwen 样本（四种场景及一次提示词对照）仍为视觉失败，不能用原生 API 通过替代效果验收。

另有已安装 291c1d40 的小 RGB8 受控后端流程：真实来源／灰度图预览、两次上传与一次 POST、透明素材独立图层及可编辑蒙版、一次原生撤销、磁盘 History 按同一 UUID 读回并再次应用均通过；后续读回／应用没有新增请求，重复提交为零。此证据不扩大为安装大图／RGB16、重启持久性或真实模型质量通过。

能力清单至少包含 `protocol: ps-ai/1`、`provider`、`configured`、`cancellation: none`、`progress: stages` 和 `models`。每个模型给出 `id`、`label`、`operations`、`maxInputImages`、`outputDepths`、`seedMax`、`minPixels`、`maxPixels`、`maxAspectRatio`。`seedMax: 0` 表示没有可设种子，信封只接受占位值 0，不向平台传种子；未知参数会被拒绝。本协议版本只支持 8 位输出、阶段进度和不保证中断的取消语义；需要真实步数、更多参数或其他取消保证时，应先扩展客户端和协议版本，不能伪造字段。

状态是 `queued`、`running`、`ready`、`failed`、`cancelled` 或 `unknown`。只有 `ready` 才提供：

```json
{"state":"ready","images":[{"filename":"00000000-0000-4000-8000-000000000001.png","subfolder":"","type":"output"}]}
```

## 持久化是接口的一部分

作业编排见 [application/jobs.ts](../../server/application/jobs.ts)，落盘实现见 [persistence/job-store.ts](../../server/persistence/job-store.ts)，传输入口见 [http/gateway.ts](../../server/http/gateway.ts)。更换数据库或语言时仍须保持以下顺序：

1. 校验请求和输入，计算包含 `clientId` 与规范化请求的摘要。
2. **先保存本地 UUID、请求摘要、提供方身份、平台端点和 `submitting` 状态，再创建平台任务。**
3. 异步平台成功后原子保存 `providerTaskId` 与 `queued`，只查询这个 ID。同步平台只在本机后台调用一次，不伪造远程任务 ID；先保存原始结果，再校验和发布。
4. 同 UUID、同请求返回已有记录；不同请求返回 409。不得重复调用上游创建接口。
5. 响应丢失、超时或重启时，有平台 ID 就继续查；没有平台 ID 的提交窗口记为 `unknown`，不自动重试，也不假称失败或已取消。
6. 平台完成后下载原始 PNG，再校验并保存可供插件读取的结果。校验失败保留原始文件和明确错误；临时磁盘错误不当作图片损坏。已有原始结果可按本地 UUID 重试转换与写入，即使平台 URL 已过期。

默认存储在当前账户的 `~/.ps-ai/bailian`、`~/.ps-ai/gemini` 或 `~/.ps-ai/openai`，可用 `PSAI_GATEWAY_DATA_DIR` 指定目录。结构为 `jobs/` 元数据、`inputs/` 输入、`raw/` 原始输出、`outputs/` 校验结果及 `gateway.lock`。元数据通过临时文件、flush 与原子 rename 写入；同作业操作串行，数据目录只允许一个实例。输入、提示词和结果都会保存在这里，不自动清理。

正常退出释放锁。异常终止后，先核实记录中的 PID 已退出，再人工移除遗留 `gateway.lock`；不能在另一实例仍运行时删锁。损坏的作业文件会阻止启动，不静默变成空历史。当前保障针对进程重启，不宣称所有文件系统故障或断电场景都可恢复。

没有平台 ID 的 `unknown` 任务需要人工核对平台记录；服务端自动对账和人工认领平台 ID 仍未实现。插件历史仅对 `unknown` 记录提供绑定 UUID 的双步骤**停止本地跟踪**，保留状态、原 ID、端点及全部数据，只增加插件本地 `tracking: detached` 元数据，将该记录移出生成阻塞集合。它不改变服务端记录，不取消请求、停止计费或证明失败；另开新任务可能重复执行。恢复会先清除本地停止跟踪标记，再查询原 UUID，绝不重提交。不能删除服务端元数据或伪造终态，其他仍跟踪的未完成任务继续保留重复提交保护。

插件另行提供需要确认的**本地历史清除**，空闲时也可选择遗留的未确认记录。它移除所选插件记录及其所属的本地来源、蒙版和候选文件，清除对应内存候选并解除本地生成阻挡。持久清除标记防止迟到保存或重启让记录复活；中断的清理会显示并可重试。共享文件或无法证明归属的文件会保留并提示。此操作不向适配服务发送请求，不改变服务端存储、不取消平台任务、不停止计费，也不证明远端状态。Photoshop 文档、已应用图层、外部导出、设置、凭据、文件授权和布光草稿保留。服务端对账和远端数据清理仍是另外的未实现功能。

提供方身份与平台端点随作业保存，不能换到另一平台查询旧任务。更换地域／业务空间后，旧作业需要恢复原端点才能查询；更换 Key 也必须保证原任务的访问权限。输入与输出都要保留到任务恢复完成，不要只迁移 JSON。

## 实现新的提供方

实现 [server/providers/contract.ts](../../server/providers/contract.ts) 的 `ImageProvider`：声明 `id`、`execution`（`task` 或 `inline`）、`baseUrl`，提供 `capabilities()` 与 `submit()`。异步适配返回 `{taskId}`，实现 `poll()` 与 `download()`；同步适配返回 `{image}`，不能捏造平台 ID。可选 `normalizeOutput()` 必须产出请求尺寸的 sRGB8 PNG，所有几何变换须有明确的逆映射。参考 [百炼](../../server/providers/bailian.ts)、[Gemini](../../server/providers/gemini.ts) 与 [OpenAI](../../server/providers/openai.ts)，在 [server/main.ts](../../server/main.ts) 的显式注册点选择，不使用任意模块或外部 URL 动态加载。平台请求与 SDK 留在服务端，面板 Key 只通过认证的本机配置入口进入服务内存。

错误返回只包含脱敏的 `code`、`message`。别原样回显平台响应、请求 Header、图片 Base64、提示词或签名 URL。提交是否确定失败必须与“未确认是否已接受”区分；后者保留 unknown，不能自动重发。

手动服务由 `PSAI_PROVIDER=bailian|gemini|openai` 选择，一个实例对应一个平台；同时运行要用不同端口与数据目录。百炼使用异步任务与短轮询。Gemini／OpenAI Images 的同步请求在本机后台执行，POST 立即返回本地 ID；断线后工作继续，但结果落盘前的进程崩溃或超时只能保留 unknown。当前按插件查询下载结果；平台记录和 URL 有时效，需要及时恢复与下载。没有后台巡检、自动清理、用量统计、SDK 自动重试或跨账户路由。

## 图像与服务边界

- 输入是插件生成的 sRGB8 PNG，每张最多 10 MiB；JSON 请求最多 64 KiB，百炼 JSON 最多 1 MiB、Gemini 内联响应最多 16 MiB、OpenAI 响应最多 32 MiB，结果下载最多 32 MiB。像素解码继续使用现有预算和严格 PNG 检查。
- 结果必须是符合请求尺寸的真实 8 位 PNG；百炼要求原尺寸。Gemini 明确使用 1024 方形补边：等比缩放来源和辅助，按同一补边坐标裁回原比例再缩放；较大请求可能只是 1K 放大，不宣称原始分辨率或精准保持主体。OpenAI 2.5 按16倍数和最低像素预算规划画布，1.5使用固定画布，来源和蒙版同变换、输出按同坐标逆裁并缩放；2.5 请求比例限1:3至3:1，素材显式请求 transparent。透明素材必须包含透明像素，仍需人工检查效果。
- 默认拒绝未标记色彩的输出。服务只有显式设置对应的 `PSAI_BAILIAN_ASSUME_SRGB=1` 、`PSAI_GEMINI_ASSUME_SRGB=1` 或 `PSAI_OPENAI_ASSUME_SRGB=1` 才按 sRGB 解释无标记 PNG；这不是色彩转换，不适用于未知 ICC／HDR。客户端始终要求网关返回带标记的 sRGB。
- 百炼结果下载不携带 Key，只允许受信 HTTPS OSS 主机。Gemini／OpenAI 只调用各自固定官方 HTTPS 端点，不下载响应中的任意 URL；只接受内联 PNG。三个适配器均拒绝重定向。
- 本机服务限制 Host／跨站请求、文件名与输入归属。公网部署还需单独设计认证、账户隔离、限流和存储权限；当前实现不能直接作为公开多租户服务。

## 验证与后续维护

运行 `npm test`、`npm run typecheck`、`npm run build`。`tests/application-jobs.test.ts` 不启动 HTTP，直接校验提交前落盘、去重、排空与原始结果恢复；`tests/bailian.test.ts` 、`tests/gemini.test.ts` 与 `tests/openai.test.ts` 校验平台请求与结果，`tests/gateway-server.test.ts` 校验真实本地 HTTP 和持久化，`tests/gateway-panel.test.ts` 校验面板流程。模拟平台不能证明实际权限、速度、效果、颜色、透明度或原生宿主 UI 已通过。

拿到 Key 后按 [百炼](../providers/BAILIAN.md)、[Gemini](../providers/GEMINI.md) 与 [OpenAI Images](../providers/OPENAI.md) 的清单完成平台与 Photoshop 验收，再更新 [兼容清单](../../config/compatibility.json)、两种语言的指南及 [AGENTS.md](../../AGENTS.md)。发布时必须让测试结果对应实际代码与发行包；现有 v0.4.0 附件不包含本轮尚未发布的能力。
