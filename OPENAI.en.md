<p align="center"><img src="assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">OpenAI Images setup</h1>
<p align="center"><a href="OPENAI.md">简体中文</a> · <strong>English</strong></p>

The development branch includes an OpenAI Images adapter. **Live output and Photoshop application have not been validated with a real API key.** Published v0.4.0 packages do not contain it. Existing ComfyUI, Bailian and Gemini paths remain available.

## Start the service

Install Node.js 24+. Run `npm ci` from a revision containing the adapter, then use PowerShell in the repository directory:

```powershell
$env:PSAI_PROVIDER = 'openai'
$openaiSecureKey = Read-Host 'OpenAI API Key' -AsSecureString
$env:OPENAI_API_KEY = [Net.NetworkCredential]::new('', $openaiSecureKey).Password
npm run gateway -- --port 8192
```

Without a key, omit the two credential-entry lines. Capability discovery works; generation is blocked locally. Variables apply to this terminal and its child processes. Restart after changing the key. The API project needs model access and available quota.

After building, `node .\dist\gateway\ps-ai-gateway.mjs --port 8192` works too. Future environment-tool archives include a standalone file, without npm or compilation:

```powershell
node .\backend\ps-ai-gateway.mjs --port 8192
```

The service binds only 127.0.0.1. Default data is `~/.ps-ai/openai`; override with `--data-dir` or `PSAI_GATEWAY_DATA_DIR`. Concurrent providers need separate ports and data directories. Inference runs on the platform, so ComfyUI is not required; Photoshop's own system requirements still apply.

## Connect the plugin

For development, run `npm run build` and load the built plugin through UXP Developer Tool as described in the [README](README.en.md).

1. Open **Backend and models**, then select **Platform gateway (experimental)**.
2. Enter `http://localhost:8192`, not the OpenAI API URL or key.
3. Scan models, select an authorized model, save and connect. A [settings example](config/settings.openai.example.json) is available.
4. Try one text-to-image result. Then work on a saved copy, select the legs and try: “Add white over-the-knee socks; preserve the pose and other areas.”
5. Enable edit guidance for a model-side mask. Add a reference image when needed. Preview before applying a separate layer, then inspect edges and color.

Images, guides, references and prompts are uploaded to OpenAI and stored in plugin/service data. Keys belong only in the service environment, outside plugin settings, history and Git.

## Models and API

| Model ID | Adapter sizing |
| --- | --- |
| `gpt-image-2.5-sunburst` (default) | Flexible canvas; align edges to 16, enlarge and pad proportionally when needed |
| `gpt-image-2.5-flare` | Same |
| `gpt-image-1.5` | Choose 1024×1024, 1536×1024 or 1024×1536, then pad proportionally |

Models and parameters follow the [official Images guide](https://developers.openai.com/api/docs/guides/image-generation). The list declares adapter scope, not account access or accepted live quality.

Text-to-image and assets use [generations](https://developers.openai.com/api/reference/resources/images/methods/generate); edits use [edits](https://developers.openai.com/api/reference/resources/images/methods/edit). Requests use JSON image references and receive one Base64 PNG, with fixed `quality: medium` and `n: 1`. Effects/atmosphere explicitly request transparency; fully opaque assets fail validation. Other modes request opaque output; the plugin handles **Preserve source transparency** during final composition.

The source is the first image and the reference follows it. The guide becomes a separate API mask: white grayscale becomes editable transparent alpha, black becomes protected opaque alpha, and feathered values are retained. Padding stays protected. The guide does not take a reference image slot. Model guidance can drift; Photoshop selections and protection enforce the final edit boundary.

Protocol requests are limited to 2048² pixels. For 2.5, requested ratios range from 1:3 to 3:1 and the planned canvas contains at least 655,360 pixels. Version 1.5 accepts narrower requested crops with fewer effective model pixels. Source and mask share padding; output crops the same coordinates, then resizes to requested dimensions. Different aspect ratios are not blindly stretched. Geometry handling does not guarantee that the model keeps the subject in place.

Steps, configurable seeds, 16-bit output, streaming previews, Responses conversations and third-party OpenAI-compatible relays are not exposed. Each of 1–4 sequential candidates is a separate platform call.

## Results, recovery and troubleshooting

Output must be tagged sRGB8 PNG. Only after confirming that untagged platform pixels are sRGB, set `$env:PSAI_OPENAI_ASSUME_SRGB = '1'` and restart. This interprets a missing tag; it does not convert unknown ICC, accept JPEG/HDR or bypass corrupt-image checks.

Images returns the image directly; this adapter has no remote task ID for retrieving a lost result. A local UUID is persisted before one background request. Normal Ctrl+C waits for active work. **Stop remaining candidates** does not interrupt the current call or guarantee billing stops; returned output is retained.

| Situation | Action |
| --- | --- |
| Missing `OPENAI_API_KEY` | Configure it in the service terminal and restart |
| 401/403 | Check project credentials and model access; raw platform errors and credentials are not echoed |
| 429 | Check quota/rate limits; resolve existing jobs first |
| HTTP 408, timeout, disconnect or incomplete response | Keep `unknown`, never automatically resubmit a possibly billable request; reconcile platform records |
| Definite missing image, non-PNG, invalid dimensions/color/alpha | Record failure; raw output already persisted remains in `raw/` |
| Narrow crop or prepared PNG over 10 MiB | Adjust the selection/context or resolution; over-budget inputs are not submitted |
| Locked data directory | Stop the old instance; remove a stale lock only after confirming its recorded PID has exited |

Each original or prepared input PNG is capped at 10 MiB; OpenAI response JSON at 32 MiB. Automatic reconciliation and an abandon-tracking UI are not implemented. Do not delete uncertain job records and generate again. Saved raw output can recover transient disk-write failures by UUID. Back up the whole private data directory when migrating; keep it out of Issues.

## Live acceptance

With a key, validate model access/output for all three models, nine modes, guide/reference combinations, transparent assets, color/coordinates, protection, original layers/undo, multiple candidates, stopping/recovery, both UI languages and CCX/Portable installation. Update screenshots, compatibility and release status afterwards. Offline mocks do not establish platform or host acceptance.

The repository-root `BACKEND.en.md` and `AGENTS.md` define server and persistence contracts.
