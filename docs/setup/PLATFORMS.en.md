<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">Choose an image platform</h1>
<p align="center"><a href="PLATFORMS.md">简体中文</a> · <strong>English</strong> · <a href="../README.en.md">Home</a></p>

PS-AI 0.5.0 connects to local ComfyUI or a cloud image API. Cloud generation needs an API key and model access; the provider handles billing.

## Choose a backend

| Panel option | What you need | Connection |
| --- | --- | --- |
| [ComfyUI](COMFYUI.en.md) | Compatible backend, nodes and Qwen 2.1 models | Default `http://localhost:8188`; editable |
| [Nano Banana](../providers/GEMINI.en.md) | Google Gemini API key | `http://127.0.0.1:8192` |
| [GPT Image](../providers/OPENAI.en.md) | OpenAI API key | `http://127.0.0.1:8193` |
| [BaiLian](../providers/BAILIAN.en.md) | Model Studio key for the mainland China endpoint | `http://127.0.0.1:8191` |

ComfyUI connects directly. Cloud platforms use the bundled local relay and need **Node.js 24+**, with no local inference weights. A web subscription does not establish API access.

## Configure a platform in the panel

1. On Windows, install Node.js 24+, check `node --version`, then restart Photoshop.
2. Open **Settings → Backend and models** and choose a platform. Keep its automatically filled local address.
3. Enter the **API Key**, choose **Save key**, and allow Photoshop to open the local PS-AI launcher when prompted.
4. **Scan models**, select your model, then **Save settings** and **Connect**.
5. Return to Create and try one candidate. See the [user guide](../usage/USER_GUIDE.en.md) for source and selection requirements.

Scanning and connecting do not generate images or check upstream account access. Images, references and prompts upload when you generate and are also saved locally.

Keys are encrypted in UXP secureStorage and sent only after the local relay proves its identity. The relay uses them in memory; settings exports, history and logs exclude them. The field clears after saving. CCX and Portable keep separate data, so switching installations may require entering the key again.

Each platform retains its model choice. Switching back restores ComfyUI's address, models and depth. Resolve pending jobs using their original account before replacing or clearing a key.

## Modes and parameters

| Capability | ComfyUI | Nano Banana | GPT Image | BaiLian |
| --- | --- | --- | --- | --- |
| Text-to-image and edits, including relighting/blending | Supported workflow | Adapter implemented | Adapter implemented | Adapter implemented |
| Effects / atmosphere assets | Experimental | Disabled | Adapter implemented | Qwen 2.1 only |
| Steps / seed | Both configurable | Neither | Neither | Seed only |
| Output | 8-bit / optional SDR16 | 8-bit | 8-bit | 8-bit |
| Stop | Cancel by task ID | Stop future candidates | Stop future candidates | Stop future candidates |

Cloud adapters have offline tests; real API output and Photoshop application still need acceptance with real keys. Listed models may be unavailable to your account. Image-context ComfyUI assets failed visual acceptance in tested samples; inspect source residue, guide marks and alpha. See [asset limits](../usage/USER_GUIDE.en.md#context-assets). Inspect blending and relighting for subject, edge and detail changes before applying.

## Stop, recover and troubleshoot

- **Stop remaining candidates** lets the current cloud request finish. It does not cancel that call or guarantee billing stops. Recover the original task ID after a disconnect before generating again.
- **Stop local relay** drains current work and stops all three listeners. Closing Photoshop or switching to ComfyUI leaves it running; connecting to a platform restarts it.
- For launch failures, check Node, Photoshop launch permission and ports **8191–8193**. Run one CCX or Portable instance at a time.
- For 401/403, check the key, region and model access. For 429, check quota and rate limits.
- Untagged PNGs are rejected by default. Use a manual gateway's explicit sRGB policy only after confirming the output's color encoding.
- Managed tasks live in plugin data under `relay/<provider>/`. Back up the entire private directory when migrating. Remove a stale `gateway.lock` only after confirming its recorded process has exited.

## Manual gateways and other systems

Automatic launch supports Windows and requires Node on PATH. For other systems, custom ports, other Bailian regions or color settings, follow the provider guide and choose **Manual gateway (advanced)**. Manual gateways read keys from the terminal environment and keep separate data. Keep these local services off the public internet.
