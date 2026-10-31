<p align="center">
  <img src="../../assets/brand/avatar.png" width="72" alt="PS-AI">
</p>
<h1 align="center">Configure ComfyUI from zero</h1>
<p align="center"><a href="COMFYUI.md">简体中文</a> · <strong>English</strong> · <a href="../README.en.md">README</a></p>

PS-AI connects directly to your ComfyUI. The plugin includes no backend or weights. This page covers environment selection on Windows with NVIDIA through the first result. For cloud APIs, see [platform setup](PLATFORMS.en.md).

> **Check your build first:** Use [0.6.0 stable](https://github.com/ImMappyJ/ps-ai/releases/tag/v0.6.0) for GGUF and compatible native `.safetensors` routes. See the [tested example](#native-tested) for the exact INT8 evidence and limits. The user reported successful candidate testing and approved release; this does not establish every installation method or model. Older 0.5.2 packages remain GGUF-only and cannot gain native loading through settings changes.

Setup order: choose an existing or new environment → choose a GGUF or native route supported by your build → prepare its nodes and three model roles → start and connect → generate, inspect the new layer and undo.

<a id="beginner"></a>

## Before starting: what you need

Make two choices before downloading:

| Choice | Next step |
| --- | --- |
| Existing compatible ComfyUI | Keep the installation and weights, check [model compatibility](#model-compatibility), then [scan and connect](#connection); a running service can also use the [configuration tools](#environment-tools) |
| New ComfyUI installation | Follow [backend preparation](#backend) for official Portable matching your hardware, then add only the nodes/models missing for your chosen route |
| GGUF diffusion weights | Available in 0.5.2 and 0.6.0; requires `UnetLoaderGGUF` capable of recognizing Qwen 2.1; see the [GGUF node baseline](#gguf-nodes) |
| Native Safetensors diffusion weights | Available from 0.6.0; built-in `UNETLoader` needs no GGUF extension package but still requires shared Qwen nodes, a matching encoder and RGBA VAE; see the [tested combination](#native-tested) |

1. **Photoshop 27.0 or later.** The recorded host is Windows Photoshop 27.0. Follow the [README installation steps](../README.en.md#install-a-release-package) for the PS-AI CCX or Portable package, then open PS-AI from Photoshop's Plugins menu. PS-AI Portable is the plugin; ComfyUI Portable below is a separate inference backend.
2. **A compatible NVIDIA GPU, working driver and enough disk space.** The reference machine has an RTX 5080 with 16 GiB VRAM and about 48 GB RAM; these are not established minimum requirements. Tested examples total about 14.63 GB for GGUF or 17.28 GB for native INT8, sharing the same encoder/VAE. Assess disk, VRAM and operator support for other combinations. Allow additional space for Portable, extraction, dependencies, download caches and images. Other GPUs, CPU and macOS lack equivalent validation.
3. **Match the plugin build to the tutorial.** Choose CCX or Portable from [0.6.0 stable](https://github.com/ImMappyJ/ps-ai/releases/tag/v0.6.0), without compiling source. Check the version/build identity in Settings and package notes. Older 0.5.2 packages do not support native loading. A matching version does not validate your machine or weights; still complete the small generation, application and Undo checks below.

The default 8-bit path with a packaged plugin and local ComfyUI needs no Node.js, global Python, Git, ComfyUI-Manager or manual workflow import. Node.js 24+ is needed only for the [cloud platform relay](PLATFORMS.en.md) or source builds. Optional environment tools check or prepare configuration; they do not install the backend/dependencies or download models. These are instructions, not a record of a clean-machine installation or new host acceptance.

<a id="backend"></a>

## 1. Prepare a working backend

### 1.1 Download and extract ComfyUI Portable

Open the official [Windows Portable guide](https://docs.comfy.org/installation/comfyui_portable_windows). Follow its download entry for your NVIDIA GPU and Windows architecture, choosing the CUDA build according to its current guidance. AMD, Intel and ARM64 packages are not ordinary NVIDIA Windows x64 packages. Use an archive tool that supports `.7z`, as the official guide describes, and fully extract to a folder you choose, such as `D:\ComfyUI_windows_portable`. Do not launch files inside the archive.

The extracted folder should contain at least this structure. Models belong inside the inner `ComfyUI` folder:

```text
ComfyUI_windows_portable/
├─ run_nvidia_gpu.bat
├─ python_embeded/
│  └─ python.exe
└─ ComfyUI/
   ├─ main.py
   ├─ requirements.txt
   ├─ custom_nodes/
   └─ models/
```

**Check the core version before adding nodes.** The recorded core baseline is [ComfyUI 0.37.4](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.37.4), commit `8ff6dc384ba5c410266b40e137799e049459d4f2`. The latest official Portable may contain another core. That tag's “Source code” archive is core source, not Portable with Python/CUDA. Other versions must meet the node schemas in [compatibility.json](../../config/compatibility.json) and the [task API](#api); opening the browser page is insufficient.

Open the Portable **outer folder** in File Explorer, type `powershell` in its address bar and press Enter. Run:

```powershell
Get-Content .\ComfyUI\comfyui_version.py
```

Record the version in the output. If it differs from `0.37.4`, treat the following node/model/connection checks as validation of a new combination, not proof of the recorded baseline. The beginner route uses a complete official GPU-matched Portable without replacing its core. A pinned core source does not pin the complete Python/PyTorch/CUDA runtime; clean-machine installation and new runtime combinations still await project acceptance. Existing venv installations must use their own Python, following the [manual installation guide](https://docs.comfy.org/installation/manual_install). Developers seeking an isolated pinned-core reproduction can use the [optional appendix](#pinned-core).

### 1.2 Prepare nodes and dependencies for your route

Both routes need core `CLIPLoader`, `VAELoader`, `TextEncodeQwenImage21`, `QwenImage21Cache`, sampling and image nodes; fields are listed under [adaptation contracts](#model-adaptation). **Native Safetensors** uses built-in `UNETLoader(unet_name, weight_dtype=default)`: skip the GGUF extension installation below. Missing shared Qwen nodes still block connection.

<a id="gguf-nodes"></a>

**Recorded GGUF baseline:** The tested combination uses **[leejet/ComfyUI-GGUF](https://github.com/leejet/ComfyUI-GGUF)** commit `373048b8403a7820620065210a691263d4da0a61`. This is a reproducible recommendation, not an author allowlist; other implementations need matching architecture detection, node fields and socket types. Its pinned [detection code](https://github.com/leejet/ComfyUI-GGUF/blob/373048b8403a7820620065210a691263d4da0a61/tools/convert.py#L163) includes the relevant support. **As of 2026-10-31**, upstream city96 lacks the corresponding Qwen-Image 2.1 detection and [PR #483](https://github.com/city96/ComfyUI-GGUF/pull/483) remains open. A matching node name does not prove these weights can load. Keep an existing implementation that meets the contract.

For a new environment choosing this GGUF baseline, Git and Manager are unnecessary: download the [pinned node ZIP](https://github.com/leejet/ComfyUI-GGUF/archive/373048b8403a7820620065210a691263d4da0a61.zip):

1. Extract it and rename `ComfyUI-GGUF-373048…` to `ComfyUI-GGUF`.
2. Place it inside `ComfyUI_windows_portable/ComfyUI/custom_nodes/`. These files must be directly inside the node folder, without another nested folder. Do not retain multiple competing GGUF implementations.

```text
ComfyUI/custom_nodes/ComfyUI-GGUF/
├─ __init__.py
├─ nodes.py
└─ requirements.txt
```

3. In PowerShell, still at the Portable outer folder, run:

```powershell
.\python_embeded\python.exe -s -m pip install -r .\ComfyUI\custom_nodes\ComfyUI-GGUF\requirements.txt
```

The pinned [requirements.txt](https://github.com/leejet/ComfyUI-GGUF/blob/373048b8403a7820620065210a691263d4da0a61/requirements.txt) declares `gguf>=0.13.0`, `sentencepiece` and `protobuf`. Copying a folder does not install these dependencies. Do not substitute bare `pip` or system `python`; installing into another Python does not supply them to this backend. Start after installation succeeds. If already running, let current jobs finish, then close and restart normally. Default 8-bit output does not require the extra `PS_AISavePNG16` node.

### 1.3 Start and check the service

After preparing the [three model components](#model-files) below, double-click the outer `run_nvidia_gpu.bat`, or run `.\run_nvidia_gpu.bat` in that PowerShell window. Wait for the console to show the service address, then manually open [http://127.0.0.1:8188](http://127.0.0.1:8188). Keep the backend console open during use; closing it stops the service. First model loading is usually slower than later tasks. A browser page does not prove that models loaded successfully.

If the window closes quickly, try the local address first: another healthy backend may already own the port. If unavailable, launch from PowerShell to retain the error and inspect GPU/dependency and node-import logs. Avoid starting multiple instances or blindly running update scripts. Once the page opens, scan models and connect in Photoshop. You do not need to build a browser workflow; PS-AI submits its own fixed API graph.

<a id="model-files"></a>

## 2. Model files

Prepare three roles: **diffusion model, vision/text encoder and VAE encoder/decoder**. These are component roles, not three fixed files or any three weights. The three files below form the tested GGUF example. Use ComfyUI's `models` directory or point `extra_model_paths.yaml` at existing weights. The plugin stores loader-relative filenames, never absolute weight paths.

<a id="model-compatibility"></a>

### Compatibility requirements for your own models

Reuse existing components that meet these requirements with their actual filenames. Other quantizations or precision variants depend on the actual weights, loader and node versions. Untested combinations are not guaranteed compatible.

| Component | Requirements for replacement |
| --- | --- |
| Diffusion model | Compatible Qwen-Image 2.1 architecture and fixed `QwenImage21Cache` / `KSampler` semantics (`cfg=1`, `euler` / `simple`, `denoise=1`). A compatible `UnetLoaderGGUF` loads `.gguf`; this source branch adds `.safetensors` → `UNETLoader(weight_dtype=default)`. Format selects a loader, not a compatible architecture. Turbo/LoRA requiring other sampling settings is not a direct replacement merely because its name contains “2.1.” |
| Vision / text encoder | Compatible Qwen3-VL **8B** `.safetensors` meeting `CLIPLoader(type=qwen_image, device=default)` and `TextEncodeQwenImage21` text, multi-image and conditioning contracts. The current branch does not accept 4B, Qwen2.5-VL or encoder GGUF as substitutes; see the [pinned core's encoder branch](https://github.com/Comfy-Org/ComfyUI/blob/8ff6dc384ba5c410266b40e137799e049459d4f2/comfy/sd.py#L1955). |
| VAE | Compatible `.safetensors` loadable by `VAELoader`, matching Qwen 2.1 latent format, scaling and normalization. The [official configuration](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/vae/config.json) specifies 64 latent channels, 16× spatial scaling and four-channel RGBA input/output. Editing uses this same VAE in `TextEncodeQwenImage21` to encode the source and in `VAEDecode` to decode the result; an arbitrary image VAE is insufficient. |

Upstream options include [leejet's Qwen-Image 2.1 GGUF quantizations](https://huggingface.co/leejet/Qwen-Image-2.1-GGUF/tree/main) and [Comfy-Org's Qwen3-VL 8B encoders](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/tree/main/text_encoders) (BF16, INT8 convrot and W4A8). The tested combinations below use the INT8 convrot encoder and BF16 RGBA VAE. This does not establish BF16/W4A8 encoders or other precision variants as tested.

In **Backend and models**, choose **Scan models**, manually select each role's complete loader-relative name, including subfolders, then connect. Custom names are accepted when they meet the path/extension rules. Scanning proves file visibility; Connect checks the selected names and node schemas/interfaces without inspecting weight internals. Then follow [first real generation](#first-generation) to validate text-to-image, local editing, actual layers/masks and one Undo for your combination. Check memory use, quality and licensing too. Changing an extension does not convert a model format.

### Tested GGUF preset example

The following layout, downloads and hashes identify the GGUF combination. The [native INT8 example](#native-tested) also uses `diffusion_models` and reuses the encoder/VAE below. Three roles do not require downloading three fixed files. Custom components retain their actual names/search categories and need separate compatibility checks. Do not put every component in `checkpoints`:

```text
ComfyUI/
└─ models/
   ├─ diffusion_models/
   │  └─ qwen-image-2.1-Q4_K_M.gguf
   ├─ text_encoders/
   │  └─ qwen3vl_8b_int8_convrot.safetensors
   └─ vae/
      └─ qwen_image_2.1_vae_bf16.safetensors
```

| Search category | Preset file | Disk size |
| --- | --- | ---: |
| `diffusion_models` | [qwen-image-2.1-Q4_K_M.gguf](https://huggingface.co/Janchan123/Qwen-Image-2.1-Uncensored-GGUF/resolve/2a9f9f126b8cad42b48f8b1ac3c89bb884eeeee4/qwen-image-2.1-Q4_K_M.gguf) | 4.60 GB |
| `text_encoders` | [qwen3vl_8b_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/df94239739eef7205973a145ffa6f441f7b64e84/text_encoders/qwen3vl_8b_int8_convrot.safetensors) | 9.35 GB |
| `vae` | [qwen_image_2.1_vae_bf16.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/df94239739eef7205973a145ffa6f441f7b64e84/vae/qwen_image_2.1_vae_bf16.safetensors) | 0.68 GB |

<p align="center">
  <a href="../../assets/guide/workflow-settings-zh.png"><img src="../../assets/guide/workflow-settings-zh.png" width="420" alt="Current native Photoshop Settings panel after scanning models, with connection still unchecked; Chinese UI"></a>
</p>

This native Photoshop 27 screenshot was captured during release preparation under a separate Preview demonstration identity. Only read-only model scanning was performed; connection remains unchecked and no generation was submitted. File visibility does not establish architecture compatibility or complete 0.5.2 host/clean-machine acceptance.

This is a tested combination, not a recommendation for every use. The diffusion model is a third-party quantization. Read its model card and the upstream [Qwen license](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE): current terms permit non-commercial research / evaluation; commercial use requires separate permission. Weights are not distributed with the plugin.

Exact sizes, pinned sources and SHA256 values are in [compatibility.json](../../config/compatibility.json). Reuse identical existing files. With `-ModelRoot`, the environment checker validates preset sizes and hashes when the configured complete relative name equals the preset, and reports mismatches as errors. Other custom names receive a `warn` requiring your own validation; a different name alone is not rejected. A warning means unverified, not proven compatible.

If using this preset, use the pinned links in the table and wait for each download to finish before moving it. Do not rename a partial download or HTML page to a model extension. Model files need no extraction; retain downloaded filenames to help verify provenance and hashes. Exact values follow (GB above uses decimal approximations):

| File | Bytes | SHA256 |
| --- | ---: | --- |
| `qwen-image-2.1-Q4_K_M.gguf` | 4,604,557,984 | `833439e91bc1152d28f37aa198c7f6f4218b7de95754c2f7a318a2422ab4b2f8` |
| `qwen3vl_8b_int8_convrot.safetensors` | 9,350,798,360 | `8bfd0f6e12abf2d2d697ecc888e5e90b0d6741d6708f05799f53afa560452e8f` |
| `qwen_image_2.1_vae_bf16.safetensors` | 675,509,688 | `bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9` |

From the Portable outer folder, these read-only commands check your downloads. Match each result to the table; hashing large files takes time:

```powershell
Get-FileHash .\ComfyUI\models\diffusion_models\qwen-image-2.1-Q4_K_M.gguf -Algorithm SHA256
Get-FileHash .\ComfyUI\models\text_encoders\qwen3vl_8b_int8_convrot.safetensors -Algorithm SHA256
Get-FileHash .\ComfyUI\models\vae\qwen_image_2.1_vae_bf16.safetensors -Algorithm SHA256
```

<a id="native-tested"></a>

### Tested native INT8 example: 0.6.0

The combination tested on 2026-10-31 uses built-in `UNETLoader(weight_dtype=default)` with the diffusion file below and reuses the table's `qwen3vl_8b_int8_convrot.safetensors` encoder and `qwen_image_2.1_vae_bf16.safetensors` RGBA VAE. Total size is about **17.28 GB**, compared with **14.63 GB** for the GGUF example. Reuse identical encoders/VAE. BF16 diffusion weights are not required; this is not a recommendation for other INT8/FP8/BF16 variants.

| Search category | Diffusion file and pinned source | Bytes | SHA256 |
| --- | --- | ---: | --- |
| `diffusion_models` | [qwen_image_2.1_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/aacf31a6d48e707f352ecba714cee0680da3479b/diffusion_models/qwen_image_2.1_int8_convrot.safetensors) | 7,256,783,064 | `cb74113cb03faecd79611b01fd7fd642f0aa60d6f0b95086abee214d75eaa57d` |

The source is Comfy-Org/Qwen-Image-2.1 revision `aacf31a6d48e707f352ecba714cee0680da3479b`, licensed **qwen-research**; the [upstream research license](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE) still applies. The tested backend is based on ComfyUI 0.37.4 with preexisting local modifications, Python 3.13.15, PyTorch 2.14.0+cu130, comfy-kitchen 0.2.35 and comfy-aimdo 0.5.5, on an RTX 5080 with 16 GiB VRAM. This records an observed environment, not a clean installation reproducible from the upstream version alone, minimum hardware, or a performance promise. See the [compatibility manifest](../../config/compatibility.json) for pinned components and scope.

| Evidence | Scope |
| --- | --- |
| Real backend tasks and PNGs | Text-to-image, source/reference editing and asset tasks completed PNG checks, plus GGUF comparisons and explicitly configured P0 8/16-bit runs; the manifest lists individual cases. Both routes completed inference on a public NASA astronaut photo, but raw results recolored the entire spacesuit and failed strict local instruction acceptance. Photoshop's final mask constraint is checked separately; completion does not guarantee quality or identity |
| Photoshop 27.0.0 API | Real native outputs on owned 128×96 sRGB8/16 fixtures passed gray selection 64/128/255, protection, an independent editable layer mask, unchanged source/outside/protected pixels, one Undo, rollback after injected post-pixel cancellation, and stale-source rejection |
| Source color and large-source API | Tagged and untagged pathless multilayer RGB8/16 sources passed current-composite capture with no file picker, original-state preservation, assumed-sRGB copies/session provenance, active-document isolation, Undo/profile baseline and closed-source rejection. One 4096×3072 RGB16 `edit-analysis` source passed native-mask/strip application, full-composite/source hashing and one Undo |
| Recovery and cancellation | One real native task had its submission response deliberately lost after server acceptance, recovered as running under its original UUID, then cancelled atomically by ID; one inference POST, no global interrupt |
| Pending | Installed panels, CCX/Portable, photographic application/general visual quality, other large-source/wide-gamut cases and complete upgrade/history flows; standalone API probes do not establish these |

<a id="connection"></a>

## 3. Address and settings format

### Configure the panel

1. Open **Settings → Backend and models** and choose **ComfyUI**.
2. For local Portable, enter `http://127.0.0.1:8188`, matching the browser check. Existing installations can use their actual HTTP(S) origin, such as `http://192.168.1.20:8188` or `https://comfy.example.com`.
3. **Scan models**. Version 0.6.0 reads available GGUF and native diffusion-loader lists and preserves explicit choices; it never replaces a selected native route with the GGUF preset automatically. Unselected roles receive only exact preset or unique nested-basename suggestions. Choose unresolved custom files yourself; a different quantization is never guessed. Published 0.5.2 scans only the GGUF diffusion route.
4. Review the read-only loading route, then choose **Connect** to check selected filenames, shared nodes, fields and socket types and save settings. The panel reports **Nodes checked**, with a warning that the selected weights' real inference remains unverified; external acceptance records are not automatically assigned to your files. Address/model/depth changes require a new check. An absent unused loader is acceptable; network failures and malformed schemas remain errors. Then validate your own real generation.

Addresses cannot contain credentials, paths or query strings. A reverse proxy must forward HTTP and WebSocket at its root; HTTPS needs a valid certificate. API-key authentication is not integrated. Remote backends receive images, references and prompts; keep unauthenticated services private.

**Connect** saves settings after checks pass; **Save settings** and **Import JSON** can save an unchecked draft. Export/import JSON to move configuration, then check the address and filenames. See the [settings example](../../config/settings.example.json). Model names cannot be absolute paths or contain `..`. Settings lock during generation; each task keeps its original backend address.

### Setup wizard

First launch walks through address testing, model scanning and environment checks. **Generate example** then submits a real job in a separate test document. Inspect its result layer and mask, then undo once. **Setup** reopens the checks later. A connection or scan alone does not confirm model compatibility.

<a id="first-generation"></a>

### First real generation and application

Check that diffusion model, encoder and VAE meet the [compatibility requirements](#model-compatibility), using the preset above or your own combination awaiting validation. For subfolders, retain the complete relative name returned by scanning. Keep output at **8-bit**, with one candidate at a time. Complete Setup checks and choose **Generate example**. This performs real inference, loads models, uses VRAM and writes backend inputs/outputs. Wait for this task to finish, inspect the new result layer and editable mask in the separate test document, then press `Ctrl+Z` once to check that application can be undone. Also generate one image in **Text-to-image** and inspect its output and backend errors; success in one mode does not validate the other.

Next, try an ordinary edit on a saved RGB8 image you have permission to use. Make a small selection, choose the local object/material edit mode, read the source, enter a specific instruction (for example, “Change the selected cup to blue ceramic, preserving its shape and composition”) and generate one candidate. Keep the source open and unchanged while waiting. Inspect the result preview, then choose **Apply to layer**. Check the original layer remains, pixels outside the selection are unchanged, and edges/transparency look appropriate; undo once. If the public older build has no wizard, follow the [user guide](../usage/USER_GUIDE.en.md) for this small-selection test. Success means an actual candidate, new layer/mask and Undo, beyond a status label. These instructions do not certify your hardware, model quality or installation.

### Color and safe editing

Use RGB/Grayscale 8/16-bit with a resolved color profile. Photoshop's loaded ICC takes priority. Main source capture resolves available metadata automatically; untagged RGB8/16 without a verified declaration uses a separate sRGB working copy with an approximation warning, retaining the original and native depth. Unknown grayscale, CMYK, Lab and 32-bit HDR remain unsupported. See [source color](../usage/USER_GUIDE.en.md#source-color).

Model inputs are sRGB8, so wide-gamut colors and source precision can be lost. Results apply through the saved selection/protection mask on a new layer, with one undo step. Changed, closed or expired sources block application while keeping export available. Inspect alpha, color and edges on a saved copy.

<a id="output-depth"></a>

## Optional 16-bit SDR output

8-bit remains the default. To retain higher precision from generation:

1. Find `comfyui/ps_ai_sdr16` in the source tree or matching environment tools ZIP.
2. Copy that folder into `ComfyUI/custom_nodes/ps_ai_sdr16`. Its `__init__.py` must sit directly inside it. No core files, existing nodes or extra Python packages need replacement.
3. Wait for current jobs to finish and restart ComfyUI normally. Node search should include **PS-AI Save PNG16 (sRGB SDR)**.
4. Select **16-bit SDR** under Output depth in the plugin. A missing node stops generation before submission; select 8-bit to use the original path.
5. Apply to a 16-bit source document, or choose Open in new document to create a 16-bit sRGB document automatically. Save PNG preserves the candidate depth. Applying to an 8-bit document reduces it to 8-bit.

The node writes decoded VAE floats directly to tagged 16-bit RGB/RGBA PNG. Resizing, alpha processing and export retain 16-bit colors. Thumbnails and model inputs remain 8-bit; selection/protection masks remain 8-bit grayscale. A 16-bit container does not promise 16 bits of effective model detail. BF16/FP16 inference, sRGB gamut and model color shifts still apply; HDR is unsupported.

The optional JSON field `"outputDepth": 16` travels with settings. Old settings default to 8-bit; historical jobs retain their own output template.

<a id="model-adaptation"></a>

## 4. Adapting your own models

This version supports **model mappings within the existing workflow**. Weights must use a compatible Qwen-Image 2.1 architecture and load correctly with these options:

| Role | Node and field | Contract |
| --- | --- | --- |
| Diffusion: GGUF | `UnetLoaderGGUF.unet_name` | `.gguf`, compatible Qwen 2.1 structure and fixed sampling chain; existing 0.5.2 route |
| Diffusion: native | `UNETLoader.unet_name`, `weight_dtype=default` | `.safetensors`, new in 0.6.0; requires the same Qwen 2.1 structure and sampling chain. Only the [specified INT8 combination](#native-tested) has the stated test evidence |
| Encoder | `CLIPLoader.clip_name` | `.safetensors`, `type=qwen_image`, `device=default` |
| VAE | `VAELoader.vae_name` | `.safetensors`, matching Qwen 2.1 latent format, scaling and normalization; the same VAE encodes edit inputs and decodes outputs |
| Encoding / references | `TextEncodeQwenImage21` | `prompt`, `negative_prompt`, `resolution`; `images.image_1` through `images.image_3`; accepts `vae` for image inputs |
| Model wrapper | `QwenImage21Cache` | `model`, `device=auto`, `dtype=default` |
| Output | `KSampler → VAEDecode → SaveImage / PS_AISavePNG16` | `euler` / `simple`, `cfg=1`, `denoise=1`; output node ID `8` |

Also required: `LoadImage` and `JoinImageWithAlpha`. A scan proves file visibility, not internal architecture. Even after a successful node check, test both text-to-image and a local edit. Validate quantization, memory requirements, quality and licensing for every alternate combination.

Input / output rules:

- [src/generation/workflow.ts](../../src/generation/workflow.ts) builds a ComfyUI API graph, not a UI workflow JSON with node coordinates.
- Edit input is pre-scaled sRGB 8-bit RGBA PNG. `image_1` is the source. An enabled selection guide uses `image_2`; character reference uses the next slot. `JoinImageWithAlpha` restores alpha from `LoadImage`'s inverted MASK.
- Editing uses `resolution=0`; output dimensions must equal the first input. The plugin rejects mismatches. Text-to-image uses the selected resolution.
- The selection guide is a visual prompt, not a latent inpaint mask. Photoshop's final mask enforces selection and protection boundaries.
- Results come from node `8`'s `images`. The plugin then applies optional transparency, alignment and color processing; raw browser workflow output can differ.

SD, SDXL, Flux, other Qwen architectures, Turbo/LoRA requiring another sampling chain and arbitrary workflow import are unsupported. They need separate templates, node checks, size / mask contracts and Photoshop round-trip validation. Changing a dropdown filename is insufficient. Settings retain `schemaVersion: 1` and `models.unet` / `models.clip` / `models.vae`, with no new loader-selector field. The extension determines the route, without automatic switching, retry or file conversion.

Background/scene and blending omit the ComfyUI grayscale guide; Photoshop still applies the saved mask. Relighting reuses these models with no extra download. Image-context assets have failed visual acceptance in tested samples; inspect source residue, guide marks, transparency and edges. See the [user guide](../usage/USER_GUIDE.en.md).

<a id="api"></a>

## 5. Backend API contract

Proxies and custom servers must preserve these semantics:

| Endpoint | Requirement |
| --- | --- |
| `GET /system_stats` | System information |
| `GET /object_info/{class}` | Node schemas and matching loader inventories; this source branch scans both diffusion routes and validates the selected route plus shared nodes on connection |
| `POST /upload/image` | Multipart PNG; returns `name`, `subfolder` |
| `POST /prompt` | Accepts caller UUID `prompt_id`, `client_id`, `prompt`; returns the same `prompt_id` |
| `GET /history/{id}`, `GET /queue` | Task-specific terminal state, node `8` output and queue state |
| `GET /view` | PNG download by `filename`, `subfolder`, `type=output` |
| `POST /api/jobs/{id}/cancel` | Atomically cancels only that ID; returns boolean `cancelled` |
| `/ws?clientId=…` | WS for HTTP, WSS for HTTPS; `progress` includes `prompt_id`, `value`, `max` |

Having `/prompt` is not enough. A backend that ignores caller IDs or lacks task-specific cancellation needs upgrading / adapting. There is no global `/interrupt` fallback, which could stop someone else's work. Connect checks nodes and models without interrupting tasks to probe cancellation. Full acceptance requires submitting, recovering and cancelling a test task. See [ComfyUI server routes](https://docs.comfy.org/development/comfyui-server/comms_routes).

<a id="environment-tools"></a>

## 6. Environment tools

### Reuse an already running backend

This is the shortest path when ComfyUI already runs with your existing models. No Python or model-directory selection is needed:

```powershell
powershell.exe -NoProfile -File .\scripts\prepare-environment.ps1 -BaseUrl http://localhost:8188 -OutputDirectory .\prepared-connection
```

Optionally add `-SettingsPath` with an existing ComfyUI settings export to preserve its visible custom choices. The command reads loader inventories, retains exact current mappings and otherwise fills only exact preset names or unique matching basenames. It creates `ps-ai-settings.json`, `model-discovery.json`, `environment-report.json` and `README.txt` in a new directory. Read the reports, then use **Import JSON → Connect** in plugin Settings for the full node-template check. Ambiguous, missing or alternate filenames stay unresolved in an explicitly labeled draft; select them in the panel. Finding a filename does not validate its architecture, license or output.

The command reads API status without submitting, cancelling or interrupting jobs. It never starts another backend, changes its search paths, installs dependencies or downloads weights. Exit `2` means configuration was prepared with unresolved or unverified checks; exit `1` means preparation/preflight failed. A report can be useful even when preflight fails. Source/hash and write-protocol checks still need the steps below.

### Check the prepared configuration

Run from the source root or matching extracted environment-tool directory:

```powershell
powershell.exe -NoProfile -File .\scripts\check-environment.ps1 -SettingsPath .\config\settings.example.json -ReportPath .\environment-report.json
```

Use the prepared JSON above, copy and edit the example, or use exported panel settings. Add `-ModelRoot` for preset size / hash checks under `diffusion_models`, `text_encoders` and `vae`; `-SkipHash` skips hashing. `-Offline` runs local checks only. `-ComfyRoot` checks source revisions and the cancellation route. Online checking also reads `/queue` and a fresh UUID's `/history` response without sending a POST. These reads cannot prove caller-assigned IDs or atomic cancellation; the report keeps that lifecycle validation unverified. Exit codes: `0` all checks passed, `2` unverified items, `1` errors. This does not prove Photoshop acceptance.

### Prepare a separate launcher only when needed

For an existing stopped Python backend, the helper can prepare a launcher without changing that installation:

```powershell
$comfy = Read-Host 'ComfyUI directory containing main.py'
powershell.exe -NoProfile -File .\scripts\prepare-environment.ps1 -ComfyRoot $comfy -OutputDirectory .\prepared-backend -Port 8199
```

ModelRoot defaults to `ComfyUI/models`. The helper detects an existing `.venv/Scripts/python.exe`, `venv/Scripts/python.exe` or sibling Portable `python_embeded/python.exe` / `python_embedded/python.exe`. Pass `-ModelRoot` for an external shared model directory and `-PythonPath` for another existing backend Python; no interpreter is installed. Use `-SettingsPath` to retain exported custom mappings.

This creates `extra_model_paths.yaml`, `start-comfyui.ps1`, an unchecked draft `ps-ai-settings.json` and instructions. It refuses existing output directories, installs nothing, downloads no weights and leaves the backend untouched. Start the generated script yourself only when the service is stopped. It listens locally; if the port is already serving, reuse and check that service. Then scan the running backend or use the reuse-running command to resolve exact filenames before connecting.

<a id="pinned-core"></a>

<details>
<summary>Optional developer appendix: reproduce the pinned core in an isolated empty directory</summary>

This is not the beginner route or an accepted Portable binary. Use a separate, newly created empty test directory; never overwrite/downgrade an existing ComfyUI. The official repository's [pinned core ZIP](https://github.com/Comfy-Org/ComfyUI/archive/8ff6dc384ba5c410266b40e137799e049459d4f2.zip) identifies `0.37.4` / `8ff6dc384ba5c410266b40e137799e049459d4f2`, without Python/CUDA. In that isolated test directory, retain the official GPU-matched Portable runtime and launchers, move its bundled core outside the installation for safekeeping, and rename the extracted source folder to `ComfyUI`. Ensure `ComfyUI/main.py` exists directly, without another nested source folder. From the isolated Portable outer folder, run:

```powershell
Get-Content .\ComfyUI\comfyui_version.py
.\python_embeded\python.exe -s -m pip install -r .\ComfyUI\requirements.txt
```

The version should be `0.37.4`; the ZIP URL identifies the complete commit. Install this page's pinned leejet nodes and requirements only when choosing the GGUF baseline; the native route skips the GGUF extension. Runtime/dependency combinations, node schemas, task protocol and real generation still require individual checks. Retain errors and the original installation if a check fails; do not bypass them by blindly upgrading or replacing system Python.

</details>

<a id="troubleshooting"></a>

## 7. Troubleshooting

| Symptom | Check first |
| --- | --- |
| Cannot find `python.exe` / requirements | PowerShell must be at the Portable outer folder. Check `python_embeded/python.exe` and the inner `ComfyUI`. If your package uses another directory name, use its actual path rather than system pip. |
| `No module named gguf` / `sentencepiece` / `protobuf`, `IMPORT FAILED` | Rerun the GGUF requirements command with this backend's Python and inspect the first installation/import error. Check for nested node folders, then restart normally. |
| Missing selected loader / shared Qwen nodes | GGUF needs compatible `UnetLoaderGGUF`; native needs built-in `UNETLoader` and `weight_dtype=default`, without adding the GGUF package. Both need shared `TextEncodeQwenImage21` / `QwenImage21Cache` and other required nodes. |
| `Unknown model architecture!` | Check the actual weights and loader's Qwen 2.1 detection; see the dated [GGUF baseline](#gguf-nodes). Renaming an extension, automatically switching routes or resubmitting does not fix compatibility. |
| Window closes / port occupied / browser does not open | Visit `http://127.0.0.1:8188` manually and reuse a healthy service. Otherwise launch from PowerShell and retain the error; avoid duplicate instances. |
| CUDA / driver errors or out of memory | Compare the official Portable GPU build and driver and inspect backend logs. Reduce candidates/size and close other GPU workloads. The 16 GiB reference machine is not a guarantee; avoid upgrading every dependency blindly. |
| Missing `PS_AISavePNG16` after selecting 16-bit | Use default 8-bit for the first test, or separately follow [optional 16-bit output](#output-depth). This node is not required by the default path. |
| Browser works, plugin cannot connect | Complete origin, proxy API forwarding, certificate and Photoshop firewall rules. A manually applied loopback-only rule blocks LAN / remote backends; its administrator must adjust it deliberately. |
| Models missing | Search categories, exact relative names and backend logs. Refresh / restart normally after path changes. |
| Missing Qwen node / field | Compare pinned commits and schemas. Same-name older nodes may differ. |
| Different task ID / cancellation 404 | The task protocol is incompatible. Keep records and check versions; do not resubmit or use global interruption. |
| Slow text encoding | Initial loading, VRAM pressure and CPU offloading take time. The plugin uses `device=default`; ComfyUI chooses the actual device. Check its logs before forcing everything onto GPU. |
| No percentage before sampling | The node has not reported sampling steps yet. The panel shows a phase, then the task's real step progress. |
| Wrong candidate dimensions | Check source scaling and first-reference dimensions. Do not bypass checks by changing output size. |
| White fringe / color shift | Check whether preserving the source silhouette is appropriate, then ICC, raw model output, alignment and color matching. Composite manually if needed. |
| Untagged source/reference | Follow the [source-color guidance](../usage/USER_GUIDE.en.md#source-color); use a correctly profiled copy when needed. |
