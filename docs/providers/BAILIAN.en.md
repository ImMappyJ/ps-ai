<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">Connect Alibaba Cloud Model Studio (Bailian)</h1>
<p align="center"><a href="BAILIAN.md">简体中文</a> · <strong>English</strong></p>

**PS-AI 0.5.0** includes the BaiLian adapter. Real API output and Photoshop application still need testing with a real key. The model list below describes the implemented adapter.

## Connect from the panel

Install **Node.js 24+** on Windows and restart Photoshop. Open **Settings → Backend and models**, choose **BaiLian**, enter the API key and choose **Save key**. Allow the local launcher, then scan models, select one, save and connect. The managed address is `http://127.0.0.1:8191`.

Connection checks do not generate images or verify account access. Keys are encrypted in UXP secureStorage; settings exports, history and logs exclude them. Generating uploads images, references and prompts. See [platform setup](../setup/PLATFORMS.en.md) for storage, switching and stopping the relay.

## Manual gateway (advanced)

Run `npm ci` in a source clone, then start one provider in PowerShell. Choose a free port outside 8191–8193:

```powershell
$env:PSAI_PROVIDER = 'bailian'
$platformSecureKey = Read-Host 'BaiLian API key' -AsSecureString
$env:DASHSCOPE_API_KEY = [Net.NetworkCredential]::new('', $platformSecureKey).Password
npm run gateway -- --port 8190
```

Choose **Manual gateway (advanced)** and `http://localhost:8190` in the panel. After building, the last command can be `node .\dist\gateway\ps-ai-gateway.mjs --port 8190`; an environment tools archive uses `node .\backend\ps-ai-gateway.mjs --port 8190`. Both need Node 24. Restart after changing environment variables.

Data defaults to `~/.ps-ai/bailian`, separate from managed plugin data. Override with `PSAI_GATEWAY_DATA_DIR` or `--data-dir`; concurrent instances need separate ports and directories. Without a key you can check capabilities, but cannot generate.

The default upstream is `https://dashscope.aliyuncs.com/api/v1`. Key, region and model must match. To use a workspace endpoint, set this variable **before starting** the manual gateway, replacing `WORKSPACE_ID` with your actual ID:

```powershell
$env:DASHSCOPE_BASE_URL = 'https://WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/api/v1'
```

Other supported workspace regions include Singapore, US Virginia, China Hong Kong, Germany Frankfurt and Japan Tokyo. See the [official endpoint reference](https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference).

## Models and API

| Model | Implemented entry points | Validation |
| --- | --- | --- |
| `qwen-image-2.1-pro` (default), `qwen-image-2.1-turbo` | Text-to-image, editing/references, transparent assets | Documented capability mapping |
| `qwen-image-3.0`, `qwen-image-3.0-pro` | Text-to-image, editing/references | Transparent effect/atmosphere modes disabled |

Source-state checks, selections, protection, original layers and undo rules remain in Photoshop. Guides are visual references rather than strict model masks. Images, references and prompts upload to Bailian and remain in local plugin/gateway storage.

<a id="storage-troubleshooting-and-shutdown"></a>

<a id="acceptance-after-obtaining-a-key"></a>

## Tasks and results

Seeds are configurable; steps are platform-controlled. The service persists the local UUID and provider task ID. After disconnection, use **Recover task** on the original record. Download promptly: platform results expire and there is no downloader independent of plugin polling.

- **Stop remaining candidates** lets the current platform call finish and saves its result. It does not cancel that call or guarantee billing stops. Ctrl+C waits for current work before shutdown.
- For 401/403, check the key, region and model access; for 429, check quota/rate limits.
- Output must be sRGB8 PNG. Only after confirming untagged output is actually sRGB, set `$env:PSAI_BAILIAN_ASSUME_SRGB = '1'` before starting a manual gateway. This does not convert unknown ICC or accept JPEG, HDR or corrupt PNG.
- Keep uncertain jobs and their UUIDs. History's two-step local stop tracking for `unknown` does not cancel remote work; a new generation may duplicate it. Automatic reconciliation and manual platform-ID attachment are not implemented.
- Raw output saved in `raw/` can recover transient write failures by UUID. Back up the whole private data directory when migrating. Remove a stale `gateway.lock` only after confirming its recorded process has exited.

Bailian supports queued-task cancellation, but this adapter does not expose verified remote cancellation. See [task management](https://help.aliyun.com/zh/model-studio/manage-asynchronous-tasks). Output is 8-bit; applying it to a 16-bit document does not add generated detail.

For a first live check, generate one image, inspect dimensions/color/alpha, apply on a saved copy, undo once, then test original-ID recovery. Photoshop selections and protection define the final edit boundary. See the [user guide](../usage/USER_GUIDE.en.md) and [backend contract](../development/BACKEND.en.md).
