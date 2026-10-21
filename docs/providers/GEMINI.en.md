<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">Gemini / Nano Banana setup</h1>
<p align="center"><a href="GEMINI.md">简体中文</a> · <strong>English</strong></p>

Version **0.5.0** includes a Google Gemini adapter. **Live API output and Photoshop application have not been tested with a real key.** Use matching 0.5.0 packages or build the corresponding source as described in the [README](../README.en.md#install-a-release-package); historical v0.4.0 packages lack this feature. Nano Banana names the Gemini image-model family; this adapter calls Google's API directly.

## Connect from the panel

For 0.5.0, follow [platform setup](../setup/PLATFORMS.en.md). On Windows, install Node.js 24+, select **Nano Banana** in **Settings → Backend and models**, enter its API key and choose **Save key**. Allow Photoshop to open the bundled local launcher. Scan models, choose one, save and connect. The managed address is `http://127.0.0.1:8192`.

Keys are encrypted in UXP secureStorage and used only in local relay memory. Exports, history and logs exclude them. Connection checks do not call generation or verify account access. Images, references and prompts go to the platform only when generating, and remain in private local data. The relay can be stopped from the panel; pending jobs retain their original identity.

## Manual gateway (advanced)

For other systems or custom settings, run `npm ci` in a source clone, then start one provider from PowerShell. Use an available port outside the managed range 8191–8193:

```powershell
$env:PSAI_PROVIDER = 'gemini'
$platformSecureKey = Read-Host 'Nano Banana API key' -AsSecureString
$env:GEMINI_API_KEY = [Net.NetworkCredential]::new('', $platformSecureKey).Password
npm run gateway -- --port 8190
```

After a build, the last command can be `node .\dist\gateway\ps-ai-gateway.mjs --port 8190`; an environment archive uses `node .\backend\ps-ai-gateway.mjs --port 8190`. Both need Node 24, without source compilation for the archive. Choose **Manual gateway (advanced)** and `http://localhost:8190` in the panel. Keys come from this terminal's environment; restart to change them. Omitting the key permits discovery and blocks generation. Data defaults to `~/.ps-ai/gemini`, separate from managed plugin data; override with `--data-dir`. Concurrent instances need separate ports and directories.

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

Source and guide images are scaled proportionally and padded to 1024×1024. A matching square PNG is cropped using the same padding coordinates, then resized to the requested canvas. References retain their aspect ratio. Narrow selections get fewer effective model pixels; large requests may upscale a 1K result. Actual subject alignment still needs live acceptance; this is not a promise of pixel-perfect model editing.

Untagged PNGs are rejected by default. Only after confirming the provider's pixels are sRGB, set `$env:PSAI_GEMINI_ASSUME_SRGB = '1'` and restart. This interprets a missing tag; it does not convert unknown ICC profiles, handle HDR, accept JPEG or bypass corrupt-image checks.

## Interruptions and troubleshooting

This Gemini API returns an image directly. The adapter has no remote task ID for retrieving a lost result. The service persists a local UUID before making one background request; the plugin polls local state. A local UUID is not a Google task ID.

- **Stop remaining candidates** lets the current request continue; it does not guarantee billing stops. Returned results are saved.
- A timeout or process exit before output persistence can leave `unknown`. Automatic resubmission is prohibited. Check platform usage records; server reconciliation and platform-ID attachment remain unimplemented. Current 0.5.0 History supports explicit two-step local stop tracking for `unknown`, retaining the original ID and all data. It does not cancel work or stop billing; a new task may duplicate work. See the [user guide](../usage/USER_GUIDE.en.md).
- Once raw output is saved, transient output-write failures can recover using the same UUID. Normal Ctrl+C waits for current work; forced termination has no such guarantee.
- For 401/403, check credentials, model access, region and account. For 429, check quota/rate limits. Do not create repeated uncertain tasks.
- Refusals, missing images, non-PNG output and invalid dimensions/color produce errors. Do not bypass validation to force application.
- After a crash, remove a stale `gateway.lock` only after confirming its recorded process has exited. Data contains private images and prompts; keep it private.

With a key, validate all nine modes (text-to-image and eight edits, excluding the two transparent asset modes), both UI languages, color/alpha edges, selections/protection, apply/undo, multiple candidates, disconnects/restarts and both installation paths. Update compatibility, screenshots and release status only after acceptance. The repository’s `docs/development/BACKEND.en.md` and `AGENTS.md` document adapter and persistence contracts.
