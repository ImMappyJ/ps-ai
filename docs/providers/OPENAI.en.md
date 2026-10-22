<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">OpenAI Images setup</h1>
<p align="center"><a href="OPENAI.md">简体中文</a> · <strong>English</strong></p>

**PS-AI 0.5.0** includes the GPT Image adapter. Real API output and Photoshop application still need testing with a real key. The model list below describes the implemented adapter.

## Connect from the panel

Install **Node.js 24+** on Windows and restart Photoshop. Open **Settings → Backend and models**, choose **GPT Image**, enter the API key and choose **Save key**. Allow the local launcher, then scan models, select one, save and connect. The managed address is `http://127.0.0.1:8193`.

Connection checks do not generate images or verify account access. Keys are encrypted in UXP secureStorage; settings exports, history and logs exclude them. Generating uploads images, references and prompts. See [platform setup](../setup/PLATFORMS.en.md) for storage, switching and stopping the relay.

## Manual gateway (advanced)

Run `npm ci` in a source clone, then start one provider in PowerShell. Choose a free port outside 8191–8193:

```powershell
$env:PSAI_PROVIDER = 'openai'
$platformSecureKey = Read-Host 'GPT Image API key' -AsSecureString
$env:OPENAI_API_KEY = [Net.NetworkCredential]::new('', $platformSecureKey).Password
npm run gateway -- --port 8190
```

Choose **Manual gateway (advanced)** and `http://localhost:8190` in the panel. After building, the last command can be `node .\dist\gateway\ps-ai-gateway.mjs --port 8190`; an environment tools archive uses `node .\backend\ps-ai-gateway.mjs --port 8190`. Both need Node 24. Restart after changing environment variables.

Data defaults to `~/.ps-ai/openai`, separate from managed plugin data. Override with `PSAI_GATEWAY_DATA_DIR` or `--data-dir`; concurrent instances need separate ports and directories. Without a key you can check capabilities, but cannot generate.

## Models and API

| Model ID | Adapter sizing |
| --- | --- |
| `gpt-image-2.5-sunburst` | Flexible canvas; align edges to 16, enlarge and pad proportionally when needed |
| `gpt-image-2.5-flare` | Same |
| `gpt-image-1.5` | Choose 1024×1024, 1536×1024 or 1024×1536, then pad proportionally |

Models and parameters follow the [official Images guide](https://developers.openai.com/api/docs/guides/image-generation). The list declares adapter scope, not account access or accepted live quality.

Text-to-image and text-only assets use [generations](https://developers.openai.com/api/reference/resources/images/methods/generate); edits and assets using the current image and selection use [edits](https://developers.openai.com/api/reference/resources/images/methods/edit). Requests use JSON image references and receive one Base64 PNG, with fixed `quality: medium` and `n: 1`. Effects/atmosphere explicitly request transparency; fully opaque assets fail validation. Other modes request opaque output; the plugin handles **Preserve source transparency** during final composition.

The source is the first image and an optional reference follows it. The guide becomes a separate API mask: white grayscale becomes editable transparent alpha, black becomes protected opaque alpha, with feathering retained and padding protected. It does not occupy a reference-image slot. Image-context assets use the source for placement, scale, perspective, color and lighting, with the mask marking where to place the independent transparent asset; imported references are not used. See [asset input and acceptance limits](../usage/USER_GUIDE.en.md#context-assets). Photoshop selections and protection enforce the final application boundary.

Protocol requests are limited to 2048² pixels. For 2.5, requested ratios range from 1:3 to 3:1 and the planned canvas contains at least 655,360 pixels. Version 1.5 accepts narrower requested crops with fewer effective model pixels. Source and mask share padding; output crops the same coordinates, then resizes to requested dimensions. Different aspect ratios are not blindly stretched. Geometry handling does not guarantee that the model keeps the subject in place.

Each original/prepared input PNG is capped at 10 MiB; response JSON at 32 MiB. Adjust selection/context or resolution if inputs exceed the limit.

Steps, configurable seeds, 16-bit output, streaming previews, Responses conversations and third-party OpenAI-compatible relays are not exposed. Each of 1–4 sequential candidates is a separate platform call.

<a id="live-acceptance"></a>

## Results, recovery and troubleshooting

The API returns an image directly, so there is no remote task ID for retrieving a lost response. The local UUID is saved before sending. A timeout or forced exit before output is saved can leave `unknown`; check platform records before starting another job.

- **Stop remaining candidates** lets the current platform call finish and saves its result. It does not cancel that call or guarantee billing stops. Ctrl+C waits for current work before shutdown.
- For 401/403, check the key, region and model access; for 429, check quota/rate limits.
- Output must be sRGB8 PNG. Only after confirming untagged output is actually sRGB, set `$env:PSAI_OPENAI_ASSUME_SRGB = '1'` before starting a manual gateway. This does not convert unknown ICC or accept JPEG, HDR or corrupt PNG.
- Keep uncertain jobs and their UUIDs. History's two-step local stop tracking for `unknown` does not cancel remote work; a new generation may duplicate it. Automatic reconciliation and manual platform-ID attachment are not implemented.
- Raw output saved in `raw/` can recover transient write failures by UUID. Back up the whole private data directory when migrating. Remove a stale `gateway.lock` only after confirming its recorded process has exited.

For a first live check, generate one image, inspect dimensions/color/alpha, apply on a saved copy, undo once, then test original-ID recovery. Photoshop selections and protection define the final edit boundary. See the [user guide](../usage/USER_GUIDE.en.md) and [backend contract](../development/BACKEND.en.md).
