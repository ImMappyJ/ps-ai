<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">Connect Alibaba Cloud Model Studio (Bailian)</h1>
<p align="center"><a href="BAILIAN.md">简体中文</a> · <strong>English</strong></p>

The development branch includes a Bailian gateway. **Live platform and Photoshop acceptance have not been completed with an API key.** Existing v0.4.0 release assets do not contain this work. This guide covers development testing and future release acceptance; existing ComfyUI installations can continue unchanged.

## 1. Start the local gateway

Use Node.js 24 or later. Photoshop connects to the local gateway, which calls Bailian. Platform generation does not require local GPU inference or ComfyUI.

From source:

```powershell
git clone https://github.com/ImMappyJ/ps-ai.git
cd ps-ai
# Switch to a revision containing the Bailian adapter first.
npm ci
$env:PSAI_PROVIDER = 'bailian'
npm run gateway -- --port 8190
```

Without a key, startup reports `key configured=false`. Capability discovery works, but generation is blocked before any platform task is created:

```powershell
Invoke-RestMethod http://localhost:8190/psai/v1/capabilities
```

When using a future environment-tool archive containing this feature, run the bundled server directly after extraction, without npm or compilation:

```powershell
node .\backend\ps-ai-gateway.mjs --port 8190
```

## 2. Configure a server-side key

In the PowerShell terminal that starts the gateway, enter the key. Do not put it in the Photoshop address field, plugin settings JSON or Git files.

```powershell
$bailianSecureKey = Read-Host 'Bailian API key' -AsSecureString
$env:DASHSCOPE_API_KEY = [Net.NetworkCredential]::new('', $bailianSecureKey).Password
$env:DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'
$env:PSAI_PROVIDER = 'bailian'
npm run gateway -- --port 8190
```

For the standalone bundle, replace the last line with the `node` command above. Variables apply to this terminal and child processes only; set them again in a new terminal. Restart the gateway after changing its key or endpoint.

The key, endpoint region and model access must match. For a workspace-specific endpoint, replace `WORKSPACE_ID` with the real ID:

```powershell
$env:DASHSCOPE_BASE_URL = 'https://WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/api/v1'
```

Supported workspace regions also include Singapore, US Virginia, China Hong Kong, Germany Frankfurt and Japan Tokyo. Consult the [official endpoint reference](https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference). The gateway catalog describes its implemented mappings, not models enabled for the account.

## 3. Configure the panel

For development, run `npm run build` and load `dist/plugin/manifest.json` through UXP Developer Tool, following the [README](../README.en.md).

1. Expand **Backend and models**.
2. Choose **Platform gateway (experimental)**.
3. Enter `http://localhost:8190`; match the server port if customized.
4. Choose **Scan models**, select an enabled model, then **Save settings** and **Connect**. Alternatively import the [Bailian settings example](../../config/settings.bailian.example.json).
5. Start with one text-to-image candidate, then a selected local edit. Example: add white over-knee stockings while preserving the pose and unselected regions.

There are no GGUF, encoder or VAE fields in platform mode. Sampling steps are platform-controlled and output is currently 8-bit. “Connected” confirms the local configuration check; live model access still requires a generation request.

| Model | Implemented entry points | Validation |
| --- | --- | --- |
| `qwen-image-2.1-pro` (default), `qwen-image-2.1-turbo` | Text-to-image, editing/references, transparent assets | Documented capability mapping; live results pending |
| `qwen-image-3.0`, `qwen-image-3.0-pro` | Text-to-image, editing/references | Transparent effect/atmosphere modes disabled; live results pending |

Source-state checks, selections, protection, original layers and undo rules remain in Photoshop. Guides are visual references rather than strict model masks. Images, references and prompts upload to Bailian and remain in local plugin/gateway storage.

## 4. Tasks and results

- The server persists the local UUID and provider task ID. Use **Recover task** after disconnection rather than repeatedly generating.
- **Stop remaining candidates** keeps the current platform task running and retains its eventual result. Bailian supports cancelling queued tasks only; this adapter does not claim that unverified cancellation integration. [Official task management](https://help.aliyun.com/zh/model-studio/manage-asynchronous-tasks)
- Progress shows actual stages without invented steps or timing. Candidates run sequentially as separate platform calls.
- PNG, color, depth, dimensions and asset transparency are checked. Mismatched edit dimensions block application; raw output stays in server `raw/`.
- Output is 8-bit. It can be applied to a 16-bit source document, but that does not create true 16-bit generated detail. ComfyUI SDR16 remains a separate path.
- Platform results expire. Recover and download promptly; the service currently has no background downloader independent of plugin polling.

## 5. Storage, troubleshooting and shutdown

The default directory is the current account's `~/.ps-ai/bailian`. Override it through `PSAI_GATEWAY_DATA_DIR` or `--data-dir`. Stop normally with Ctrl+C; this does not stop ComfyUI.

| Symptom | Action |
| --- | --- |
| `key configured=false` / missing key | Set `DASHSCOPE_API_KEY` in the same terminal, then restart |
| 401 / 403 | Check key, region, workspace and model access; the server never echoes the key |
| 429 | Check platform quota/rate limits; query existing task IDs first |
| Untagged sRGB output | Establish the PNG's real color encoding first. Only then opt into `PSAI_BAILIAN_ASSUME_SRGB=1` and restart; it does not convert unknown ICC profiles |
| Wrong canvas or missing transparency | Inspect raw output, mode and model. Do not force a stretched image or fabricate alpha |
| `unknown` without a platform ID | Reconcile manually with platform records. Automatic reconciliation and abandonment UI are not implemented; do not delete metadata and recreate the task |
| Locked data directory | Stop the old instance. After abnormal termination, confirm the PID in `gateway.lock` has exited before removing a stale lock |

The server listens locally and is not an authenticated public service. For migration, stop it normally and back up the whole directory. It contains private images/prompts and must not be uploaded to Git or Issues. Server rewriting, persistence ordering and fields are documented in `BACKEND.en.md` and `AGENTS.md` in a source clone.

## 6. Acceptance after obtaining a key

- [ ] Verify region, access and model ID with one real text-to-image result.
- [ ] Use the same demonstration image for local edits, outfits/props, removal, backgrounds, references, scenes, effects and atmosphere; save genuine screenshots for each.
- [ ] Inspect dimensions, sRGB, alpha edges, outside-mask/protection pixels, original layers and one-step undo.
- [ ] Check batches, stopping remaining candidates, plugin reload, normal service restart and recovery by the original ID after a lost response.
- [ ] Check both panel languages, CCX/Portable installation and final package contents before updating the compatibility manifest and feature status.

Offline contracts and a local fake provider do not complete these checks. Publish the new feature after live acceptance.
