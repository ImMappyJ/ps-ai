<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">Choose an image platform</h1>
<p align="center"><a href="PLATFORMS.md">简体中文</a> · <strong>English</strong> · <a href="../README.en.md">Home</a></p>

Version **0.5.0 (experimental prerelease)** offers ComfyUI, Nano Banana, GPT Image and BaiLian. Use matching packages from [Releases](https://github.com/ImMappyJ/ps-ai/releases); if no 0.5.0 assets are available, [build from source](../README.en.md#build-from-source). Historical v0.4.0 lacks platform selection and relighting. ComfyUI has real inference and limited Photoshop evidence; cloud adapters have offline tests only, with live keys and platform host acceptance pending.

## Choose a backend

| Panel option | Inference | Prepare | Local connection |
| --- | --- | --- | --- |
| ComfyUI | Your ComfyUI | Compatible backend, nodes and models | Default `http://localhost:8188`; host and port are editable |
| Nano Banana | Google Gemini API | Project API key and model access | `http://127.0.0.1:8192`, managed automatically |
| GPT Image | OpenAI Images API | Project API key and model access | `http://127.0.0.1:8193`, managed automatically |
| BaiLian | Alibaba Cloud Model Studio API | Key for the mainland China endpoint and model access | `http://127.0.0.1:8191`, managed automatically |

ComfyUI connects directly and never launches a platform relay. Each platform has a separate key and task directory. Platform generation needs no local inference weights, but requires **Node.js 24+** on this computer. A web subscription does not establish API access.

## Configure a platform in the panel

1. Install Node.js 24 or later on Windows. Check `node --version`, then restart Photoshop so it receives the updated PATH.
2. Open **Settings → Backend and models**, then choose the platform under **Backend type**. Its local address is filled and locked; do not enter the upstream API URL.
3. Enter the platform's **API Key** and choose **Save key**. Photoshop requests permission to open the local PS-AI launcher on first use. A denied launch can be retried by connecting again.
4. Choose **Scan models**, select a model available to the account, then **Save settings** and **Connect**. Scanning and connecting create no images and do not validate upstream account access.
5. Return to **Create** and prepare the source/range for the selected mode. Removal needs no prompt; relighting opens its workbench for explicit generation. Other modes use **Generate**. Images and prompts are uploaded when generating. Inspect one candidate first. See the [mode requirements](../usage/USER_GUIDE.en.md).

The password field clears after saving; **Key saved (encrypted)** indicates storage. UXP secureStorage encrypts keys per plugin. A key is sent only to the authenticated local relay and used in its memory. JSON exports, task history and stage logs exclude keys. CCX and Portable keep separate data. Uninstallation, clearing plugin data or damaged account credentials can require re-entry.

Each platform retains its model choice. ComfyUI restores its previous address, model mapping and depth. Configuration controls lock during generation. Recover unfinished jobs by their original ID before replacing or clearing a key; the running relay rejects those changes for pending jobs. After a relay restart, use the original job's account.

## Modes and parameters

| Feature | ComfyUI | Nano Banana | GPT Image | BaiLian |
| --- | --- | --- | --- | --- |
| Text to image, local edits, clothing, references, scenes, relighting, blending | Corresponding workflow | Edit adapter implemented | Edit adapter implemented | Edit adapter implemented |
| Text-only effects / atmosphere | Implemented; inspect alpha/residue | Disabled | Adapter implemented | Qwen 2.1 models only |
| Assets from current image + selection | Experimental; real samples failed visual acceptance | Disabled | Adapter implemented | Qwen 2.1 models only |
| Sampling steps | Configurable | Platform-controlled | Platform-controlled | Platform-controlled |
| Seed | Configurable | Disabled | Disabled | Configurable |
| Output depth | 8-bit / optional SDR16 | 8-bit | 8-bit | 8-bit |
| Progress / stopping | Stages and actual steps; task cancellation | Stages / stop future candidates | Stages / stop future candidates | Stages / stop future candidates |

An implemented adapter is not accepted output quality. Assets default to the current image and selection; text-only is an explicit alternative. Five real pinned ComfyUI image-context samples retained source content or painted guide boundaries and failed visual acceptance. Transparent pixels alone do not establish a usable asset. See [asset limits](../usage/USER_GUIDE.en.md#context-assets). Blending has limited illustration/portrait comparisons and a small controlled RGB8 installed flow; photographic quality and broader native acceptance remain pending. Capabilities constrain operations, seeds, inputs, pixel count and aspect ratio; unsupported combinations fail before upload. See [Bailian](../providers/BAILIAN.en.md), [Gemini](../providers/GEMINI.en.md) and [OpenAI](../providers/OPENAI.en.md) for model and geometry details.

## Stop, recover and troubleshoot

- **Stop remaining candidates** lets the current platform request finish. It does not guarantee interrupted inference or billing. Recover the original ID rather than creating it again.
- Switching to ComfyUI leaves an existing relay running. **Stop local relay** stops all three local listeners and drains current work. Connect to a platform to restart it. Closing Photoshop does not terminate the independent Node process.
- Launch failure: check Node, Photoshop's launch consent and ports **8191–8193**. Keep only one CCX or Portable instance active; separate installations conflict on the managed ports.
- Missing key: save it for the selected platform. For 401/403, check account, region and model access; for 429, check quota and rate limits.
- PNG/color rejection: retain raw output and preserve strict decoding. Untagged output is rejected by default. After confirming its color interpretation, use a manual gateway with an explicit `PSAI_*_ASSUME_SRGB` policy.
- After an abnormal exit, jobs remain under `relay/<provider>/` in plugin data. Confirm the PID recorded in `gateway.lock` is dead before removing a stale lock. Back up the complete directory, including images, rather than JSON alone. Keep it out of Issues.

## Manual gateways and other systems

Automatic launching currently supports Windows. Node itself is not bundled. For other systems, custom ports, other Bailian regions/workspaces or explicit color policy, start a gateway using its provider guide and choose **Manual gateway (advanced)** in the panel. Enter its local address. Manual gateways read keys from the process environment and do not use the panel's key buttons. They have separate data from the managed relay.

The local token authenticates this plugin on this computer; it is not a public account system. Do not expose or forward these ports to the internet.
