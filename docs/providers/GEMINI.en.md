<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">Gemini / Nano Banana setup</h1>
<p align="center"><a href="GEMINI.md">简体中文</a> · <strong>English</strong></p>

**PS-AI 0.5.0** includes the Nano Banana adapter. Real API output and Photoshop application still need testing with a real key. The model list below describes the implemented adapter.

## Connect from the panel

Install **Node.js 24+** on Windows and restart Photoshop. Open **Settings → Backend and models**, choose **Nano Banana**, enter the API key and choose **Save key**. Allow the local launcher, then scan models, select one, save and connect. The managed address is `http://127.0.0.1:8192`.

Connection checks do not generate images or verify account access. Keys are encrypted in UXP secureStorage; settings exports, history and logs exclude them. Generating uploads images, references and prompts. See [platform setup](../setup/PLATFORMS.en.md) for storage, switching and stopping the relay.

## Manual gateway (advanced)

Run `npm ci` in a source clone, then start one provider in PowerShell. Choose a free port outside 8191–8193:

```powershell
$env:PSAI_PROVIDER = 'gemini'
$platformSecureKey = Read-Host 'Nano Banana API key' -AsSecureString
$env:GEMINI_API_KEY = [Net.NetworkCredential]::new('', $platformSecureKey).Password
npm run gateway -- --port 8190
```

Choose **Manual gateway (advanced)** and `http://localhost:8190` in the panel. After building, the last command can be `node .\dist\gateway\ps-ai-gateway.mjs --port 8190`; an environment tools archive uses `node .\backend\ps-ai-gateway.mjs --port 8190`. Both need Node 24. Restart after changing environment variables.

Data defaults to `~/.ps-ai/gemini`, separate from managed plugin data. Override with `PSAI_GATEWAY_DATA_DIR` or `--data-dir`; concurrent instances need separate ports and directories. Without a key you can check capabilities, but cannot generate.

## Implemented API scope

The adapter uses Google's [GenerateContent image API](https://ai.google.dev/gemini-api/docs/generate-content/image-generation), the `x-goog-api-key` header, inline PNG inputs and one PNG from a mixed response. Declared model IDs:

| Model ID | Common name |
| --- | --- |
| `gemini-nano-banana-2.1` | Nano Banana 2.1 |
| `gemini-3.1-flash-lite-image` | Nano Banana 2 Lite |
| `gemini-3.1-flash-image` | Nano Banana 2 |
| `gemini-3-pro-image` | Nano Banana Pro |
| `gemini-2.5-flash-image` | Nano Banana |

Names follow the [official model guide](https://ai.google.dev/gemini-api/docs/image-generation). This list declares adapter scope, not account access or permanent model availability.

Text-to-image and eight edit modes are exposed: objects/materials, removal, background, outfits/props, references, scenes, relighting and image blending. Transparent effects/atmosphere assets are disabled. Multi-turn conversations, search, 4K, configurable seeds and 16-bit output are not exposed. Steps and seed controls are disabled. Each candidate is a separate platform call.

Source and guide images are scaled proportionally and padded to 1024×1024. A matching square PNG is cropped using the same padding coordinates, then resized to the requested canvas. References retain their aspect ratio. Narrow selections get fewer effective model pixels; large requests may upscale a 1K result. Inspect subject alignment before applying.

## Interruptions and troubleshooting

The API returns an image directly, so there is no remote task ID for retrieving a lost response. The local UUID is saved before sending. A timeout or forced exit before output is saved can leave `unknown`; check platform records before starting another job.

- **Stop remaining candidates** lets the current platform call finish and saves its result. It does not cancel that call or guarantee billing stops. Ctrl+C waits for current work before shutdown.
- For 401/403, check the key, region and model access; for 429, check quota/rate limits.
- Output must be sRGB8 PNG. Only after confirming untagged output is actually sRGB, set `$env:PSAI_GEMINI_ASSUME_SRGB = '1'` before starting a manual gateway. This does not convert unknown ICC or accept JPEG, HDR or corrupt PNG.
- Keep uncertain jobs and their UUIDs. History's two-step local stop tracking for `unknown` does not cancel remote work; a new generation may duplicate it. Automatic reconciliation and manual platform-ID attachment are not implemented.
- Raw output saved in `raw/` can recover transient write failures by UUID. Back up the whole private data directory when migrating. Remove a stale `gateway.lock` only after confirming its recorded process has exited.

For a first live check, generate one image, inspect dimensions/color/alpha, apply on a saved copy, undo once, then test original-ID recovery. Photoshop selections and protection define the final edit boundary. See the [user guide](../usage/USER_GUIDE.en.md) and [backend contract](../development/BACKEND.en.md).
