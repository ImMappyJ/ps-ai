<p align="center">
  <img src="../assets/brand/avatar.png" width="72" alt="PS-AI">
</p>
<h1 align="center">PS-AI</h1>
<p align="center"><a href="../README.md">简体中文</a> · <strong>English</strong></p>

PS-AI is a Photoshop image-generation and editing plugin with four adapter paths: ComfyUI / Qwen-Image 2.1, Nano Banana (Gemini), GPT Image (OpenAI Images) and BaiLian (Alibaba Cloud Model Studio). It offers local edits, portrait outfits and props, relighting, blending and text-to-image generation. Preview candidates, export them or apply them in Photoshop.

This page describes **0.5.0 (experimental test build, prerelease channel)**, with a separate Git build identifier for each revision. ComfyUI has real inference and limited Photoshop 27 acceptance records. The three cloud adapters have code and offline tests, with no real API-key output or platform host acceptance. The main-interface capture below is a **0.5.0 UI-operation sample**; the mode-configuration captures also show the current version. These images do not establish all current controls or model quality. Results may need manual cleanup; use saved copies. Routine skin smoothing, blemish removal and skin-tone retouching are not included.

Upgrading from 0.3.0 changes the panel name from `PS-AI FOR ME` to `PS-AI` and introduces the Morph Frame identity. Plugin IDs and the `PS-AI-FOR-ME` installation directory stay the same.

Settings retains separate platform model choices and encrypted keys, with an on-demand local relay. Portrait offers a [relighting workbench](usage/USER_GUIDE.en.md#relight): edit multiple-light intent, explicitly generate, then choose an experimental lighting-layer group or a full-image redraw as a masked layer. The local illustration is not an AI result. Lighting layers are estimated influence fields; real-photo detail fidelity still needs acceptance. See [platform setup](setup/PLATFORMS.en.md) and the [Bailian](providers/BAILIAN.en.md), [Gemini / Nano Banana](providers/GEMINI.en.md) and [OpenAI Images](providers/OPENAI.en.md) adapter guides.

[Saved source color resolution](usage/USER_GUIDE.en.md#source-color) can create an unmerged working copy for an untagged static WebP or explicitly sRGB PNG after exact original-file authorization and verified sRGB declarations. An existing document ICC takes priority. WebP8 identity application, PNG8 capture and limited installed recovery have separate records; reference import, persistent access and broader interactions remain pending.

[Background](usage/USER_GUIDE.en.md#background-fix) and scene replacement select the subject to keep and generate a full background. Prompt-free removal and [Image Blending](usage/USER_GUIDE.en.md#blend) are also available. Background has one stage-scene inference/application record. Blending has a small RGB8 controlled installed flow and limited real Qwen comparisons; photographic portrait changes remained weak. These records do not establish all new controls, large images, 16-bit or platform quality. Historical v0.4.0 packages do not contain these later changes.

## Documentation

| Purpose | Guide |
| --- | --- |
| Eleven modes and current interface examples | [Illustrated user guide](usage/USER_GUIDE.en.md) |
| Local backend, models and troubleshooting | [ComfyUI setup](setup/COMFYUI.en.md) |
| Platform selection and API keys | [Platform setup](setup/PLATFORMS.en.md) |
| Adapter details and validation limits | [Bailian](providers/BAILIAN.en.md) · [Gemini / Nano Banana](providers/GEMINI.en.md) · [OpenAI Images](providers/OPENAI.en.md) |
| Contributing and server extensions | [Source map and development guide](../AGENTS.md#source-map) · [Backend and persistence contract](development/BACKEND.en.md) |

## Current interface

These are actual Photoshop 27 captures of installed Portable **0.5.0 c3adef56**, using an independent sRGB8 copy of `3F3F3F.webp`. Foreground pixels/alpha are retained over a separate neutral-gray background. All demonstration images now use current host captures.

| Create and source copy | Relighting workbench |
| --- | --- |
| ![0.5.0 Create, Chinese UI](../assets/guide/050-create-zh.png) | ![0.5.0 relighting workbench, local illustration](../assets/guide/050-relight-zh.png) |

The workbench, candidate and layer images use a controlled local lighting response (`127.0.0.1:8194`), not real model quality. New mode-configuration captures submit no generation; the model configuration image separately scans an actual local ComfyUI catalog. See the [illustrated user guide](usage/USER_GUIDE.en.md) for all eleven mode entries, selection requirements, steps and new images. Real-model and API-key acceptance limits remain separately documented.

## What it does

- **Local editing:** change objects and materials, remove clutter, replace backgrounds. Ordinary edits preserve pixels outside the selection and inside protected areas; background modes select the subject to keep.
- **Portrait:** repair outfits and props, edit scenes, use one character reference image; relighting and blending use the whole scene. Reference guidance is experimental and does not guarantee an exact likeness or outfit.
- **Images and assets:** text to image, effects and atmosphere assets, PNG export and new documents. Assets default to the current image and selection; text-only is an explicit choice. Current real ComfyUI image-context samples failed visual acceptance, retaining people, scenery or guide boundaries. See [asset limits](usage/USER_GUIDE.en.md#context-assets).
- **Candidates:** 1–4 sequential candidates, history and disconnect recovery. ComfyUI provides actual sampling steps and cancellation by task ID; platform adapters show stages and stop remaining candidates. Apply with an editable mask and one-step undo.
- **Transparency and color:** preserve the source silhouette, optionally align the subject and match small context color shifts. RGB / Grayscale 8/16-bit round trips have been tested in Photoshop; model input remains sRGB 8-bit.
- **Settings and language:** save the host, port and ComfyUI model mapping or platform model ID, import / export JSON, switch between Simplified Chinese and English.

ComfyUI uses a fixed **Qwen-Image 2.1 GGUF workflow**; SD, SDXL and Flux cannot be substituted directly. See [ComfyUI setup](setup/COMFYUI.en.md). Source documents are limited to 45,000,000 pixels and 30,000 per side. Large areas use budgeted working rasters and native-coordinate strip application; this is not native 45MP model generation. Model input is sRGB8; ComfyUI optionally saves SDR16. Native 16-bit document handling is not native 16-bit model generation. Plugin PNG/new-document output may use working or analysis dimensions; apply to the source and save/export through Photoshop for full-resolution delivery.

## Requirements

| Component | Requirements and tested scope |
| --- | --- |
| OS / host | Windows, Photoshop 2026 / 27.0+; only 27.0 tested. macOS is unverified. |
| Backend | Local inference needs compatible ComfyUI/GGUF nodes; cloud adapters need API keys and model access, with live-key acceptance pending. See the [compatibility manifest](../config/compatibility.json). |
| Local inference GPU / memory | Tested with NVIDIA RTX 5080 16 GiB and about 48 GB RAM. Minimum hardware requirements have not been established. |
| Local model storage | About 14.63 GB for preset weights, plus backend, dependencies, cache and images. |
| Source builds | Node.js 24.21.0 / npm 11.19.0 tested. ComfyUI plugin packages need no Node.js. The optional platform service requires Node.js 24+. |

ComfyUI can run here or on another reachable machine. Images and prompts go to the configured address. Use a backend you trust. Platform access uses a separate local gateway, with keys encrypted in the plugin and used in relay memory. Do not enter a platform API URL as a ComfyUI address. Other authenticated services or URL subpaths are unverified.

## Install a release package

Use [Releases](https://github.com/ImMappyJ/ps-ai/releases) to choose plugin and environment packages matching this page’s **0.5.0** version, and verify their versions and SHA256 hashes. If no 0.5.0 assets are available, [build the corresponding source](#build-from-source); historical v0.4.0 packages cannot run the newer features. Release tags identify matching source; main may contain later changes.

### Option 1: CCX

1. Install Adobe Creative Cloud desktop. Double-click `ps-ai-0.5.0-experimental.ccx` and follow Adobe's installer.
2. Restart Photoshop and open **Plugins → PS-AI**.
3. If double-clicking does nothing, extract the matching `ps-ai-0.5.0-environment-experimental.zip`, open PowerShell there and run:

   ```powershell
   $package = Read-Host 'Full path to the CCX file'
   powershell.exe -NoProfile -File .\scripts\install-ccx.ps1 -PackagePath $package
   ```

If double-clicking still fails after associating CCX files with UPIA, use the script above to supply the installation arguments and check the result. Photoshop **File → Open** cannot install a plugin.

### Option 2: Portable folder

1. Save your work and quit Photoshop completely.
2. Extract `ps-ai-0.5.0-portable-experimental.zip`. Copy the entire `PS-AI-FOR-ME` folder into your installed Photoshop **Plug-ins** directory.
3. Check the layout: `Plug-ins/PS-AI-FOR-ME/manifest.json`. Avoid an extra nested folder.
4. Restart and open **Plugins → PS-AI (Portable)**.

Portable needs no CCX installer. Folder loading and image round trips have been tested on Windows PS 27.0. Other versions and loading with developer mode disabled have not been tested. If Photoshop cannot find the folder, use CCX or the source-build method below.

CCX and Portable keep separate data. Export settings and save PNGs before switching; history is not migrated. Quit Photoshop before replacing only this plugin folder or installing a new CCX. Remove the Portable folder to uninstall it; manage CCX through Creative Cloud. Settings, candidates and history stay in Photoshop's data directory rather than moving with program files.

## Choose a platform

ComfyUI connects directly. Other platforms use a bundled launcher to start the local relay after saving a key. This requires Windows, Node.js 24+ and Photoshop launch consent. Addresses and models are retained separately; JSON exports exclude keys. See [platform setup](setup/PLATFORMS.en.md) for steps and limits.

## Connect ComfyUI

The [ComfyUI setup guide](setup/COMFYUI.en.md) covers installation, models, versions and troubleshooting. An existing backend does not need reinstalling:

1. Start ComfyUI and check its page in a browser.
2. Open **Settings → Backend and models**, choose ComfyUI and enter `http://localhost:8188`, `http://localhost:8199` or an address such as `http://192.168.1.20:8188`.
3. **Scan models**, then choose a compatible diffusion model, vision / text encoder and VAE.
4. **Save settings**, then **Connect**. The address, models and language survive reloads.
5. Run **Diagnostics → Image round-trip check**, then try one generation on a saved test image.

Export settings as JSON and import them on the other machine, then check its address and model availability. Settings store the backend origin and relative model filenames, without absolute paths to local weights. After switching backends, recover or cancel old tasks at their original address.

## First edit

1. Configure a platform in **Settings → Backend and models**, return to **Create**, choose a workspace and mode, and prepare a saved source copy. For protection, first select the details to preserve and choose **Protect selection**, then prepare the actual range.
2. Ordinary edits, removal, clothing and character references select the area to change. Background/scene modes select the subject to keep. Blending selects the foreground subject to fit the whole scene. Character reference also needs an imported reference image. Removal uses a built-in instruction without a prompt field; blending’s extra description is optional.
3. For relighting, choose **Current selection** or **Entire image**, open the workbench, edit lights and explicitly choose **Generate AI result**. Effects/atmosphere default to the current image and selection. Text-only assets and text-to-image need no image selection.
4. In other modes, enter a description as needed, preview the range and choose **Generate**. ComfyUI sampling shows actual steps; cloud adapters show stages. After disconnection, **Recover task** queries the original ID instead of submitting again.
5. Review structure, edges and color, then apply a masked layer or lighting-layer group, open a new document or **Save PNG**. Stale sources and unsafe results retain export but cannot be forced into the document.

Background/scene modes automatically disable source-transparency preservation, subject alignment and color matching; ComfyUI also disables the guide. For ordinary removal or silhouette expansion, turn off Preserve source transparency as needed. Alignment uses alpha bounds and can change proportions; color matching corrects only small overall shifts.

## Limitations and precautions

- Test on saved copies. Do not use the only unsaved original. Keep the source unchanged during generation; capture again after edits, closing it or reloading the plugin.
- The model may alter text, faces, hands and clothing inside the selection. The guide is a visual reference; the final mask enforces pixel protection.
- CMYK, Lab, Indexed, Bitmap, Multichannel and 32-bit HDR are unsupported. Work in an RGB copy. Output defaults to 8-bit; optional 16-bit SDR requires the save node and a 16-bit destination. A 16-bit file does not imply a full 16 bits of effective model precision.
- Translucent multilayer composites may lack a safe clipping base. If prompted, merge visible layers in a copy and generate again, or export PNG and composite manually.
- Preserve the current document ICC. Untagged sources can use a working copy only after exact original-file authorization and supported sRGB declarations are verified. Otherwise confirm the true color space and assign it to a copy. The model also changes lighting and colors; check seams.
- Photoshop has also exited unexpectedly without this plugin loaded. These stability issues are still being investigated and may affect both CCX and Portable installations.
- The plugin, ComfyUI or local relay retain history, inputs and outputs. Cloud generation also sends images, references and prompts to the selected provider. Remove private images, prompts and paths before sharing reports. Use material you have permission to process.
- The preset Qwen 2.1 license permits non-commercial research / evaluation; commercial use needs separate permission. Open-source code does not change model licensing. [Model license](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE)

## Build from source

```powershell
git clone https://github.com/ImMappyJ/ps-ai.git
cd ps-ai
npm ci
npm test
npm run build
```

Enable developer mode in Photoshop **Preferences → Plugins**, then restart. Add `dist/plugin/manifest.json` in [Adobe UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/) and choose **Load**. Backend setup is the same as for release packages.

`npm run package` runs tests, type checking and builds, then writes CCX, Portable ZIP, environment-tool ZIP and SHA256 checksums to `release/`. Prepare ComfyUI and models separately.

**Actions → Build packages** retains ordinary CI and manual builds. Once the release workflow is deployed, pushing a strict `vX.Y.Z` tag validates, packages and publishes it. **Actions → Release** can process an existing remote tag from the default branch with `dry_run` enabled by default. The channel defaults to prerelease; local unpushed code is absent from remote builds. See [Build and release](development/RELEASING.en.md) for version preparation, first deployment, permissions and original-batch recovery. Passing CI does not establish Photoshop acceptance.

## Feedback and contributions

Open an [Issue](https://github.com/ImMappyJ/ps-ai/issues) with OS, Photoshop / plugin / ComfyUI versions, models, GPU, reproduction steps and sanitized errors. Share only comparisons you may publish. Do not upload full crash dumps or private photos.

PRs are welcome; keep each change focused on one problem. After cloning, read the [source map and development guide](../AGENTS.md#source-map). The [backend contract](development/BACKEND.en.md) defines server-rewrite and provider contracts. Run `npm ci`, `npm test` and `npm run build` before submitting. Update the compatibility manifest and both language versions when changing workflows. Use a separate branch and discuss changes in Issues / PRs. Keep handoff notes, debugging records and machine reports local.

## License and thanks

Code: [GNU GPL v3.0](../LICENSE), GPL-3.0-only. Distributing modified versions or binaries requires corresponding source, build scripts and the license. Weights have separate terms and are not included. Screenshots do not grant rights to third-party characters or artwork.

Thanks to these projects for their tools and inspiration:

| Project | Project URL |
| --- | --- |
| Adobe UXP | <https://developer.adobe.com/photoshop/uxp/> |
| ComfyUI | <https://github.com/Comfy-Org/ComfyUI> |
| Qwen | <https://huggingface.co/Qwen> |
| ComfyUI-GGUF | <https://github.com/leejet/ComfyUI-GGUF> |
| UPNG.js | <https://github.com/photopea/UPNG.js> |
| @noble/hashes | <https://github.com/paulmillr/noble-hashes> |
| pako | <https://github.com/nodeca/pako> |
| OpenLayer | <https://github.com/MehranMarxian/OpenLayer> |
| Geekatplay ComfyUI-Photoshop | <https://github.com/GeekatplayStudio/ComfyUI-Photoshop> |

Packages include runtime dependency notices. Architecture and interaction were informed by OpenLayer and Geekatplay ComfyUI-Photoshop; their source was not copied. This is not an official Adobe product.
