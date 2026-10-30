<p align="center">
  <img src="../../assets/brand/avatar.png" width="72" alt="PS-AI">
</p>
<h1 align="center">Configure ComfyUI from zero</h1>
<p align="center"><a href="COMFYUI.md">简体中文</a> · <strong>English</strong> · <a href="../README.en.md">README</a></p>

PS-AI connects directly to your ComfyUI. The plugin includes no backend or weights. This page covers preparation from zero on Windows with NVIDIA through the first result. Existing compatible installations can skip to [models](#model-files) or [connection](#connection). For cloud APIs, see [platform setup](PLATFORMS.en.md).

Setup order: install the plugin → extract the backend → install GGUF nodes and dependencies → place three models → start and connect → generate, inspect the new layer and undo.

<a id="beginner"></a>

## Before starting: what you need

1. **Photoshop 27.0 or later.** The recorded host is Windows Photoshop 27.0. Follow the [README installation steps](../README.en.md#install-a-release-package) for the PS-AI CCX or Portable package, then open PS-AI from Photoshop's Plugins menu. PS-AI Portable is the plugin; ComfyUI Portable below is a separate inference backend.
2. **A compatible NVIDIA GPU, working driver and enough disk space.** The reference machine has an RTX 5080 with 16 GiB VRAM and about 48 GB RAM; these are not established minimum requirements. The three models total about 14.63 GB. Also allow space for Portable, extracted copies, Python dependencies, download caches and generated images. See official instructions for other GPUs, CPU and macOS; this project has not completed equivalent validation there.
3. **Match the plugin build to the tutorial.** This page covers [0.5.2 experimental](https://github.com/ImMappyJ/ps-ai/releases/tag/v0.5.2), including the guided interface. Match the downloaded package, version/build identity in Settings and package notes; older packages may differ. A [source build](../README.en.md#build-from-source) also needs the corresponding version. A matching version does not establish clean-machine installation or complete host acceptance.

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

### 1.2 Install the specified GGUF nodes and dependencies

This preset needs **[leejet/ComfyUI-GGUF](https://github.com/leejet/ComfyUI-GGUF)** at commit `373048b8403a7820620065210a691263d4da0a61`. Do not substitute the generic city96 package with the same name from another tutorial. Git and Manager are unnecessary: download the repository's [pinned node ZIP](https://github.com/leejet/ComfyUI-GGUF/archive/373048b8403a7820620065210a691263d4da0a61.zip).

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

After placing the [three models](#model-files) below, double-click the outer `run_nvidia_gpu.bat`, or run `.\run_nvidia_gpu.bat` in that PowerShell window. Wait for the console to show the service address, then manually open [http://127.0.0.1:8188](http://127.0.0.1:8188). Keep the backend console open during use; closing it stops the service. First model loading is usually slower than later tasks. A browser page does not prove that models loaded successfully.

If the window closes quickly, try the local address first: another healthy backend may already own the port. If unavailable, launch from PowerShell to retain the error and inspect GPU/dependency and node-import logs. Avoid starting multiple instances or blindly running update scripts. Once the page opens, scan models and connect in Photoshop. You do not need to build a browser workflow; PS-AI submits its own fixed API graph.

<a id="model-files"></a>

## 2. Model files

Use ComfyUI's `models` directory or point `extra_model_paths.yaml` at existing weights. The plugin stores loader-relative filenames, never absolute weight paths.

For files placed directly under ComfyUI, use this layout. Do not put all three files in `checkpoints`:

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

Exact sizes, pinned sources and SHA256 values are in [compatibility.json](../../config/compatibility.json). Reuse identical existing files. The environment checker verifies preset sizes and hashes; alternate models are reported as needing your own validation.

Use the pinned links in the table and wait for each download to finish before moving it. Do not rename a partial download or HTML page to a model extension. Model files need no extraction or renaming. Exact values follow (GB above uses decimal approximations):

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

<a id="connection"></a>

## 3. Address and settings format

### Configure the panel

1. Open **Settings → Backend and models** and choose **ComfyUI**.
2. For local Portable, enter `http://127.0.0.1:8188`, matching the browser check. Existing installations can use their actual HTTP(S) origin, such as `http://192.168.1.20:8188` or `https://comfy.example.com`.
3. **Scan models**. Visible current choices are retained. Missing mappings are filled only by the exact preset filename or one unambiguous matching basename in a subdirectory. Review unresolved roles and choose custom files yourself; a different quantization is never guessed.
4. Choose **Connect** to check the selected models and node template and save the configuration. After it reports **Connected**, try one generation.

Addresses cannot contain credentials, paths or query strings. A reverse proxy must forward HTTP and WebSocket at its root; HTTPS needs a valid certificate. API-key authentication is not integrated. Remote backends receive images, references and prompts; keep unauthenticated services private.

**Connect** saves settings after checks pass; **Save settings** and **Import JSON** can save an unchecked draft. Export/import JSON to move configuration, then check the address and filenames. See the [settings example](../../config/settings.example.json). Model names cannot be absolute paths or contain `..`. Settings lock during generation; each task keeps its original backend address.

### Setup wizard

First launch walks through address testing, model scanning and environment checks. **Generate example** then submits a real job in a separate test document. Inspect its result layer and mask, then undo once. **Setup** reopens the checks later. A connection or scan alone does not confirm model compatibility.

<a id="first-generation"></a>

### First real generation and application

Check that diffusion model, encoder and VAE match their respective files above. For subfolders, retain the relative name returned by scanning. Keep output at **8-bit**, with one candidate at a time. Complete Setup checks and choose **Generate example**. This performs real inference, loads models, uses VRAM and writes backend inputs/outputs. Wait for this task to finish, inspect the new result layer and editable mask in the separate test document, then press `Ctrl+Z` once to check that application can be undone.

Next, try an ordinary edit on a saved RGB8 image you have permission to use. Make a small selection, choose the local object/material edit mode, read the source, enter a specific instruction (for example, “Change the selected cup to blue ceramic, preserving its shape and composition”) and generate one candidate. Keep the source open and unchanged while waiting. Inspect the result preview, then choose **Apply to layer**. Check the original layer remains, pixels outside the selection are unchanged, and edges/transparency look appropriate; undo once. If the public older build has no wizard, follow the [user guide](../usage/USER_GUIDE.en.md) for this small-selection test. Success means an actual candidate, new layer/mask and Undo, beyond a Connected label. These instructions do not certify your hardware, model quality or installation.

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

<a id="model-compatibility"></a>

## 4. Adapting your own models

This version supports **model mappings within the existing workflow**. Weights must use a compatible Qwen-Image 2.1 architecture and load correctly with these options:

| Role | Node and field | Contract |
| --- | --- | --- |
| Diffusion model | `UnetLoaderGGUF.unet_name` | `.gguf`, compatible Qwen 2.1 structure and sampling chain |
| Encoder | `CLIPLoader.clip_name` | `.safetensors`, `type=qwen_image`, `device=default` |
| VAE | `VAELoader.vae_name` | `.safetensors`, matching latent format |
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

SD, SDXL, Flux, other Qwen architectures and arbitrary workflow import are unsupported. They need separate templates, node checks, size / mask contracts and Photoshop round-trip validation. Changing a dropdown filename is insufficient.

Background/scene and blending omit the ComfyUI grayscale guide; Photoshop still applies the saved mask. Relighting reuses these models with no extra download. Image-context assets have failed visual acceptance in tested samples; inspect source residue, guide marks, transparency and edges. See the [user guide](../usage/USER_GUIDE.en.md).

<a id="api"></a>

## 5. Backend API contract

Proxies and custom servers must preserve these semantics:

| Endpoint | Requirement |
| --- | --- |
| `GET /system_stats` | System information |
| `GET /object_info/{class}` | Node schemas and model dropdowns |
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

The version should be `0.37.4`; the ZIP URL identifies the complete commit. Then install this page's pinned leejet nodes and their requirements. Runtime/dependency combinations, node schemas, task protocol and real generation still require individual checks. Retain errors and the original installation if a check fails; do not bypass them by blindly upgrading or replacing system Python.

</details>

<a id="troubleshooting"></a>

## 7. Troubleshooting

| Symptom | Check first |
| --- | --- |
| Cannot find `python.exe` / requirements | PowerShell must be at the Portable outer folder. Check `python_embeded/python.exe` and the inner `ComfyUI`. If your package uses another directory name, use its actual path rather than system pip. |
| `No module named gguf` / `sentencepiece` / `protobuf`, `IMPORT FAILED` | Rerun the GGUF requirements command with this backend's Python and inspect the first installation/import error. Check for nested node folders, then restart normally. |
| Missing `UnetLoaderGGUF` / `TextEncodeQwenImage21` / `QwenImage21Cache` | Compare the core and leejet pins. The generic same-name GGUF package, or folder copying without dependencies, is insufficient for this preset. |
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
