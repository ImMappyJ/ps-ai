<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">OpenAI Images setup</h1>
<p align="center"><a href="OPENAI.md">简体中文</a> · <strong>English</strong></p>

The development branch includes an OpenAI Images adapter. **Live output and Photoshop application have not been validated with a real API key.** Published v0.4.0 packages do not contain it. Existing ComfyUI, Bailian and Gemini paths remain available.

## Connect from the panel

For the development build, follow [platform setup](../setup/PLATFORMS.en.md). On Windows, install Node.js 24+, select **GPT Image** in **Backend and models**, enter its API key and choose **Save key**. Allow Photoshop to open the bundled local launcher. Scan models, choose one, save and connect. The managed address is `http://127.0.0.1:8193`.

Keys are encrypted in UXP secureStorage and used only in local relay memory. Exports, history and logs exclude them. Connection checks do not call generation or verify account access. Images, references and prompts go to the platform only when generating, and remain in private local data. The relay can be stopped from the panel; pending jobs retain their original identity.

## Manual gateway (advanced)

For other systems or custom settings, run `npm ci` in a source clone, then start one provider from PowerShell. Use an available port outside the managed range 8191–8193:

```powershell
$env:PSAI_PROVIDER = 'openai'
$platformSecureKey = Read-Host 'GPT Image API key' -AsSecureString
$env:OPENAI_API_KEY = [Net.NetworkCredential]::new('', $platformSecureKey).Password
npm run gateway -- --port 8190
```

After a build, the last command can be `node .\dist\gateway\ps-ai-gateway.mjs --port 8190`; an environment archive uses `node .\backend\ps-ai-gateway.mjs --port 8190`. Both need Node 24, without source compilation for the archive. Choose **Manual gateway (advanced)** and `http://localhost:8190` in the panel. Keys come from this terminal's environment; restart to change them. Omitting the key permits discovery and blocks generation. Data defaults to `~/.ps-ai/openai`, separate from managed plugin data; override with `--data-dir`. Concurrent instances need separate ports and directories.

## Models and API

| Model ID | Adapter sizing |
| --- | --- |
| `gpt-image-2.5-sunburst` | Flexible canvas; align edges to 16, enlarge and pad proportionally when needed |
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
| Missing `OPENAI_API_KEY` | Save it in the panel; for a manual gateway configure the terminal and restart |
| 401/403 | Check project credentials and model access; raw platform errors and credentials are not echoed |
| 429 | Check quota/rate limits; resolve existing jobs first |
| HTTP 408, timeout, disconnect or incomplete response | Keep `unknown`, never automatically resubmit a possibly billable request; reconcile platform records |
| Definite missing image, non-PNG, invalid dimensions/color/alpha | Record failure; raw output already persisted remains in `raw/` |
| Narrow crop or prepared PNG over 10 MiB | Adjust the selection/context or resolution; over-budget inputs are not submitted |
| Locked data directory | Stop the old instance; remove a stale lock only after confirming its recorded PID has exited |

Each original or prepared input PNG is capped at 10 MiB; OpenAI response JSON at 32 MiB. Server reconciliation and platform-ID attachment remain unimplemented. Development History permits explicit two-step local stop tracking only for `unknown`, retaining the original ID and all data; this does not cancel work or stop billing, and a new generation may duplicate work. See the [user guide](../usage/USER_GUIDE.en.md). Do not delete uncertain job records. Saved raw output can recover transient disk-write failures by UUID. Back up the whole private data directory when migrating; keep it out of Issues.

## Live acceptance

With a key, validate model access/output for all three models, eleven modes (including relighting and image blending), guide/reference combinations, transparent assets, color/coordinates, protection, original layers/undo, multiple candidates, stopping/recovery, both UI languages and CCX/Portable installation. Update screenshots, compatibility and release status afterwards. Offline mocks do not establish platform or host acceptance.

The repository’s `docs/development/BACKEND.en.md` and `AGENTS.md` define server and persistence contracts.
