<p align="center"><img src="assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">Gemini / Nano Banana setup</h1>
<p align="center"><a href="GEMINI.md">简体中文</a> · <strong>English</strong></p>

The development branch includes a Google Gemini adapter. **Live API output and Photoshop application have not been tested with a real key.** Published v0.4.0 packages do not contain this feature. Nano Banana names the Gemini image-model family; this adapter calls Google's API directly.

## Start the local service

Install Node.js 24+. Run `npm ci` from a source revision containing the adapter, then use PowerShell:

```powershell
$env:PSAI_PROVIDER = 'gemini'
$geminiSecureKey = Read-Host 'Gemini API Key' -AsSecureString
$env:GEMINI_API_KEY = [Net.NetworkCredential]::new('', $geminiSecureKey).Password
npm run gateway -- --port 8191
```

Without a key, omit the two key-entry lines. Capability checks work; generation is blocked. The key needs model access and available quota; a web subscription does not establish API access. Variables apply to this terminal and child processes. Restart the local service after changing them.

Future environment-tool archives will include a standalone service. Replace the last line with:

```powershell
node .\backend\ps-ai-gateway.mjs --port 8191
```

Node.js is still required; ComfyUI and source compilation are not. Another free port, such as 8190, works too. Concurrent Bailian and Gemini instances need different ports. Default storage is `~/.ps-ai/bailian` and `~/.ps-ai/gemini` respectively; do not share one data directory between instances.

## Connect Photoshop

For development, build the plugin and load it through UXP Developer Tool as described in the [README](README.en.md).

1. Open **Backend and models**, then choose **Platform gateway (experimental)**.
2. Enter `http://localhost:8191`, not the Google API URL or an API key.
3. Scan models, select an authorized model, save settings and connect. A [settings example](config/settings.gemini.example.json) is available.
4. Start with one text-to-image result. Then use a saved image copy, select the legs and try: “Add white over-the-knee socks; preserve the pose and other areas.”
5. Inspect the candidate before applying it. The plugin still controls selections, protection, source transparency, independent layers and one-step undo.

Images, references and prompts are uploaded to Google and stored in the plugin and local service data directories. Keep keys out of plugin settings, prompts, screenshots and Git.

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

Text-to-image and six edit modes are exposed: objects/materials, removal, background, outfits/props, references and scenes. Transparent effects/atmosphere assets are disabled. Multi-turn conversations, search, 4K, configurable seeds and 16-bit output are not exposed. Steps and seed controls are disabled. Each candidate is a separate platform call.

Source and guide images are scaled proportionally and padded to 1024×1024. A matching square PNG is cropped using the same padding coordinates, then resized to the requested canvas. References retain their aspect ratio. Narrow selections get fewer effective model pixels; large requests may upscale a 1K result. Actual subject alignment still needs live acceptance; this is not a promise of pixel-perfect model editing.

Untagged PNGs are rejected by default. Only after confirming the provider's pixels are sRGB, set `$env:PSAI_GEMINI_ASSUME_SRGB = '1'` and restart. This interprets a missing tag; it does not convert unknown ICC profiles, handle HDR, accept JPEG or bypass corrupt-image checks.

## Interruptions and troubleshooting

This Gemini API returns an image directly. The adapter has no remote task ID for retrieving a lost result. The service persists a local UUID before making one background request; the plugin polls local state. A local UUID is not a Google task ID.

- **Stop remaining candidates** lets the current request continue; it does not guarantee billing stops. Returned results are saved.
- A timeout or process exit before output persistence can leave `unknown`. Automatic resubmission is prohibited. Check platform usage records; automatic reconciliation and an abandon-tracking UI are not implemented.
- Once raw output is saved, transient output-write failures can recover using the same UUID. Normal Ctrl+C waits for current work; forced termination has no such guarantee.
- For 401/403, check credentials, model access, region and account. For 429, check quota/rate limits. Do not create repeated uncertain tasks.
- Refusals, missing images, non-PNG output and invalid dimensions/color produce errors. Do not bypass validation to force application.
- After a crash, remove a stale `gateway.lock` only after confirming its recorded process has exited. Data contains private images and prompts; keep it private.

With a key, validate all seven modes, both UI languages, color/alpha edges, selections/protection, apply/undo, multiple candidates, disconnects/restarts and both installation paths. Update compatibility, screenshots and release status only after acceptance. The repository-root `BACKEND.en.md` and `AGENTS.md` document adapter and persistence contracts.
