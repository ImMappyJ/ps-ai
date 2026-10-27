<p align="center"><img src="../assets/brand/avatar.png" width="72" alt="PS-AI"></p>
<h1 align="center">PS-AI</h1>
<p align="center"><a href="../README.md">简体中文</a> · <strong>English</strong></p>

Select an area in Photoshop, describe a change, generate candidates and apply one as a new layer. PS-AI supports local edits, background replacement, clothing and props, relighting, blending and text-to-image generation.

**Current version: 0.5.0, an experimental prerelease.** Connect to local ComfyUI / Qwen-Image 2.1, or configure Nano Banana (Gemini), GPT Image (OpenAI Images) or BaiLian. Cloud services require your own API key; generation with real cloud accounts has not been validated.

[Download 0.5.0](https://github.com/ImMappyJ/ps-ai/releases/tag/v0.5.0) · [User guide](usage/USER_GUIDE.en.md) · [ComfyUI setup](setup/COMFYUI.en.md) · [Platform setup](setup/PLATFORMS.en.md)

## What it does

- **Local edit:** change objects and materials, remove distractions or replace a background.
- **Portrait:** edit clothing and props, use a character reference, replace scenes, relight, blend a subject into its surroundings or generate effect and atmosphere assets.
- **Generate:** create images from text, save PNGs or open results in new documents.

Generate 1–4 candidates, compare them, then apply. Results use new layers with editable masks; original layers remain intact. One Photoshop Undo reverses one application. History lets you browse saved candidates, reuse parameters and recover interrupted tasks.

![PS-AI Create panel and demonstration image](../assets/guide/050-create-zh.png)

Relighting changes brightness, light color and direction. Arrange lights in the workbench, generate an AI reference, then layer the estimated lighting changes over the original. Select a candidate to adjust Light fidelity for strength and Detail protection for smoother fine changes, without generating again. Full-image redraw is also available.

![Relighting: source, AI reference and lighting-layer composite preview](../assets/guide/050-result-relight.png)

Left to right: source, real AI reference, local lighting-layer composite preview, with warm light on the left and cool light on the right. The source combines `3F3F3F.webp` with a previously generated room background. Settings: Light fidelity 1 / Detail protection 0.65. This comparison is not a Photoshop application screenshot. See the [relighting guide](usage/USER_GUIDE.en.md#relight). Interface screenshots show 0.5.0 Portable in Photoshop 27. Click an image to view it at full size.

## Requirements

- **Photoshop:** Windows Photoshop 2026 / 27.0+. Tested on 27.0; macOS is untested.
- **Local generation:** a compatible ComfyUI installation, Qwen-Image 2.1 GGUF models and required nodes, installed separately. The test machine has an RTX 5080 with 16 GiB VRAM and about 48 GB RAM; minimum requirements have not been established.
- **Cloud generation:** a key and model access for your chosen provider. Automatic relay startup requires Windows, Node.js 24+ and Photoshop's permission to launch it.

ComfyUI uses a fixed Qwen 2.1 workflow; SD, SDXL and Flux are not interchangeable replacements. Model files total about 14.63 GB, plus space for the backend, dependencies and caches. See the [compatibility manifest](../config/compatibility.json) for versions.

## Install a release package

Choose a plugin package from the [0.5.0 release](https://github.com/ImMappyJ/ps-ai/releases/tag/v0.5.0) and check its matching `.sha256` file. The environment-tools archive contains instructions and setup scripts, not ComfyUI or model weights.

### Option 1: CCX

1. Install the Adobe Creative Cloud desktop app.
2. Double-click `ps-ai-0.5.0-experimental.ccx` and follow Adobe's installation prompts.
3. Restart Photoshop and open **Plugins → PS-AI**.

If double-clicking does nothing, extract `ps-ai-0.5.0-environment-experimental.zip` and run this from its folder:

```powershell
$package = Read-Host 'Full path to the CCX file'
powershell.exe -NoProfile -File .\scripts\install-ccx.ps1 -PackagePath $package
```

CCX installation is managed by Adobe. Do not open it as a Photoshop document or copy it into Plug-ins.

### Option 2: Portable folder

1. Save your documents and fully quit Photoshop.
2. Extract `ps-ai-0.5.0-portable-experimental.zip` and copy the entire `PS-AI-FOR-ME` folder into Photoshop's `Plug-ins` directory.
3. Check that `manifest.json` is directly inside `Plug-ins/PS-AI-FOR-ME`, without an extra nested folder.
4. Restart and open **Plugins → PS-AI (Portable)**.

Portable has been loaded and used on Windows PS 27.0. Other host versions and loading with developer mode disabled are untested. If it is not recognized, use CCX or [build from source](#build-from-source).

**Quit Photoshop before updating, and back up settings and any PNGs you need.** Replace only this plugin's folder for Portable; remove that folder to uninstall it. Manage CCX through Creative Cloud. The two installation types have separate data and do not migrate history automatically. Removing program files does not clear history data.

## First edit

1. **Connect a backend.** Under **Settings → Backend and models**, choose a platform. For ComfyUI, enter its address, such as `http://localhost:8188`, scan and select the generation model, encoder and VAE, then save and connect. For cloud services, follow [platform setup](setup/PLATFORMS.en.md).
2. **Prepare an image.** Open a saved copy and choose a workspace and mode. Select what you want to edit. For background replacement, select the subject to keep, without inverting. To protect details, select them and choose **Set protection** first.
3. **Describe and generate.** Enter your request, use **Preview selection** to check the range, then generate candidates. Removal uses a built-in instruction. Relighting generates from its workbench.
4. **Inspect and apply.** Check structure, edges and color. Apply as a new layer, save a PNG or open a new document. Keep the source unchanged during generation.

After a disconnection, select the original task in History and choose **Recover task**. This queries its original ID without submitting again. See the [illustrated user guide](usage/USER_GUIDE.en.md) for all eleven modes.

## Limitations and precautions

- **Inspect every result.** The model can change faces, text, linework and texture. Character references do not guarantee identity. Routine skin smoothing, blemish removal and skin-tone retouching are outside scope.
- **Relighting and blending remain experimental.** Lighting layers keep the original as the content base, but cannot perfectly separate lighting from redraw. Large offsets in the reference may leave lighting patches; hard shadows and narrow rim lights may weaken. Blending changes on photographic portraits may still be weak.
- **Image-context assets do not yet meet the quality target.** Effects and atmosphere may retain people, backgrounds or guide boundaries. Check transparency and residue; consider text-only assets or manual cleanup.
- **Color and size have limits.** Sources must be RGB/Grayscale 8/16-bit with a known color space. Model input is sRGB8; SDR16 saving does not mean native 16-bit generation or HDR. Documents are limited to 45 million pixels and 30,000 per side. Plugin exports may use a working raster's dimensions; apply to the source and export through Photoshop for original-size delivery.
- **Work on copies.** CMYK, Lab, Indexed, Multichannel and 32-bit HDR are unsupported. Unknown color or unsafe translucent multilayer sources need a suitable copy. Modified, closed or previous-session sources cannot receive stale candidates; those candidates remain exportable.
- **Check data handling and licenses.** Images and prompts go to the chosen backend; local services also retain inputs and outputs. Qwen 2.1 weights are limited to noncommercial research/evaluation; commercial use needs separate authorization. See the [model license](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE).

## Documentation

- [User guide](usage/USER_GUIDE.en.md): selections, modes, candidates and history.
- [ComfyUI setup](setup/COMFYUI.en.md): local backend, models and connection troubleshooting.
- [Platform setup](setup/PLATFORMS.en.md): cloud connections, with [BaiLian](providers/BAILIAN.en.md), [Gemini](providers/GEMINI.en.md) and [OpenAI](providers/OPENAI.en.md) details.
- [Development guide](../AGENTS.md), [backend contract](development/BACKEND.en.md) and [relighting implementation](development/RELIGHT.en.md): source and server development.
- [Release guide](development/RELEASING.en.md): building and packaging.

## Build from source

Use Node.js 24 and PowerShell 7, with `pwsh` on PATH:

```powershell
git clone https://github.com/ImMappyJ/ps-ai.git
cd ps-ai
npm ci
npm test
npm run build
```

Enable developer mode under Photoshop's **Preferences → Plugins**, restart, then load `dist/plugin/manifest.json` through [UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/).

`npm run package` runs tests, type checking and builds, then creates CCX, Portable and environment-tool archives with SHA256 files. Main-branch pushes trigger a build; version tags trigger a release. Published tags identify fixed source revisions; documentation on main may be newer.

## Feedback and license

Report problems in [Issues](https://github.com/ImMappyJ/ps-ai/issues) with your OS, Photoshop/plugin versions, backend, model, reproduction steps and redacted error. Pull requests are welcome; read [AGENTS.md](../AGENTS.md) and run the checks first. Keep private images, keys, local logs and full crash dumps out of public reports.

Code is [GPL-3.0-only](../LICENSE). Distributing modified versions or binaries requires the corresponding source, build scripts and license. Models, cloud services and screenshot materials have their own terms. This is not an Adobe product.

Thanks to [Adobe UXP](https://developer.adobe.com/photoshop/uxp/), [ComfyUI](https://github.com/Comfy-Org/ComfyUI), [Qwen](https://huggingface.co/Qwen), [ComfyUI-GGUF](https://github.com/leejet/ComfyUI-GGUF), [UPNG.js](https://github.com/photopea/UPNG.js), [@noble/hashes](https://github.com/paulmillr/noble-hashes) and [pako](https://github.com/nodeca/pako). Architecture and interaction drew inspiration from [OpenLayer](https://github.com/MehranMarxian/OpenLayer) and [Geekatplay ComfyUI-Photoshop](https://github.com/GeekatplayStudio/ComfyUI-Photoshop); neither project's source was copied. Runtime dependency notices ship with the packages.
