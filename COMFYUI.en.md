# ComfyUI setup and model compatibility

[简体中文](COMFYUI.md) · **English** · [README](README.en.md)

The plugin includes neither the backend nor weights. Reuse an existing ComfyUI if it meets the contract below. This guide covers the `qwen21-local-v2-rgba` template in plugin 0.3.0.

## 1. Prepare a working backend

Already have ComfyUI? Start it, open its page in a browser and check nodes and weights. Do not overwrite existing models or workflows just to connect the plugin.

For a new installation, follow the official [Windows Portable guide](https://docs.comfy.org/installation/comfyui_portable_windows) or [manual installation guide](https://docs.comfy.org/installation/manual_install). Follow that distribution's driver, Python and PyTorch requirements. The plugin's environment tools generate configuration and run checks; they do not install the backend, dependencies or weights.

| Component | Tested baseline |
| --- | --- |
| ComfyUI | `0.37.4`, commit `8ff6dc384ba5c410266b40e137799e049459d4f2` |
| [leejet/ComfyUI-GGUF](https://github.com/leejet/ComfyUI-GGUF) | Commit `373048b8403a7820620065210a691263d4da0a61` |
| Python / PyTorch | Existing backend: `3.13.15` / `2.14.0+cu130`. Not minimum requirements for other hardware. |

Newer versions may work, but must meet the node and API requirements below. `UnetLoaderGGUF` comes from the GGUF extension. A compatible ComfyUI supplies the Qwen 2.1 and other core nodes. Follow the extension's instructions for `custom_nodes`, use the backend's own Python for dependencies and restart through your normal procedure. A matching node name alone does not prove compatibility.

## 2. Model files

Use ComfyUI's `models` directory or point `extra_model_paths.yaml` at existing weights. The plugin stores loader-relative filenames, never absolute weight paths.

| Search category | Preset file | Disk size |
| --- | --- | ---: |
| `diffusion_models` | [qwen-image-2.1-Q4_K_M.gguf](https://huggingface.co/Janchan123/Qwen-Image-2.1-Uncensored-GGUF/resolve/2a9f9f126b8cad42b48f8b1ac3c89bb884eeeee4/qwen-image-2.1-Q4_K_M.gguf) | 4.60 GB |
| `text_encoders` | [qwen3vl_8b_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/df94239739eef7205973a145ffa6f441f7b64e84/text_encoders/qwen3vl_8b_int8_convrot.safetensors) | 9.35 GB |
| `vae` | [qwen_image_2.1_vae_bf16.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/df94239739eef7205973a145ffa6f441f7b64e84/vae/qwen_image_2.1_vae_bf16.safetensors) | 0.68 GB |

This is a tested combination, not a recommendation for every use. The diffusion model is a third-party quantization. Read its model card and the upstream [Qwen license](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE): current terms permit non-commercial research / evaluation; commercial use requires separate permission. Weights are not distributed with the plugin.

Exact sizes, pinned sources and SHA256 values are in [compatibility.json](config/compatibility.json). Reuse identical existing files. The environment checker verifies preset sizes and hashes; alternate models are reported as needing your own validation.

## 3. Address and settings format

Enter a complete **HTTP(S) origin** in Backend and models:

```text
http://localhost:8188
http://localhost:8199
http://192.168.1.20:8188
https://comfy.example.com
```

A local backend normally listens on `127.0.0.1`. A remote backend needs a reachable interface and a firewall configured by its administrator. The plugin changes neither. Credentials, query strings and paths such as `/comfy` are unsupported. A reverse proxy must forward HTTP and WebSocket at its root; HTTPS needs a valid certificate. API-key authentication is not integrated.

Scan models, select three compatible files, save and connect. Scanning uses the address currently entered. Connect saves the form before checking it. Changing language saves only the language, without submitting an unsaved address. Example:

```json
{
  "schemaVersion": 1,
  "baseUrl": "http://localhost:8188",
  "language": "en-US",
  "models": {
    "unet": "qwen-image-2.1-Q4_K_M.gguf",
    "clip": "qwen3vl_8b_int8_convrot.safetensors",
    "vae": "qwen_image_2.1_vae_bf16.safetensors"
  }
}
```

`language` accepts `zh-CN` or `en-US`; older settings may omit it and default to Chinese. Model names must match the scan, including subdirectories and separators, for example `my-qwen/model.gguf`. Absolute paths and `..` are rejected. Settings are locked during generation. History records its backend origin; legacy records without one belong to `http://localhost:8188`.

To support user-selected hosts, the UXP manifest declares network `domains: "all"`. Runtime requests go to the configured ComfyUI; there is no telemetry. A remote server receives and may retain uploaded images, references and prompts. Do not expose an unauthenticated backend to untrusted networks.

## 4. Adapting your own models

This version supports **model mappings within the existing workflow**. Weights must use a compatible Qwen-Image 2.1 architecture and load correctly with these options:

| Role | Node and field | Contract |
| --- | --- | --- |
| Diffusion model | `UnetLoaderGGUF.unet_name` | `.gguf`, compatible Qwen 2.1 structure and sampling chain |
| Encoder | `CLIPLoader.clip_name` | `.safetensors`, `type=qwen_image`, `device=default` |
| VAE | `VAELoader.vae_name` | `.safetensors`, matching latent format |
| Encoding / references | `TextEncodeQwenImage21` | `prompt`, `negative_prompt`, `resolution`; `images.image_1` through `images.image_3`; accepts `vae` for image inputs |
| Model wrapper | `QwenImage21Cache` | `model`, `device=auto`, `dtype=default` |
| Output | `KSampler → VAEDecode → SaveImage` | `euler` / `simple`, `cfg=1`, `denoise=1`; output node ID `8` |

Also required: `LoadImage` and `JoinImageWithAlpha`. A scan proves file visibility, not internal architecture. Even after a successful node check, test both text-to-image and a local edit. Validate quantization, memory requirements, quality and licensing for every alternate combination.

Input / output rules:

- [src/workflow.ts](src/workflow.ts) builds a ComfyUI API graph, not a UI workflow JSON with node coordinates.
- Edit input is pre-scaled sRGB 8-bit RGBA PNG. `image_1` is the source. An enabled selection guide uses `image_2`; character reference uses the next slot. `JoinImageWithAlpha` restores alpha from `LoadImage`'s inverted MASK.
- Editing uses `resolution=0`; output dimensions must equal the first input. The plugin rejects mismatches. Text-to-image uses the selected resolution.
- The selection guide is a visual prompt, not a latent inpaint mask. Photoshop's final mask enforces selection and protection boundaries.
- Results come from node `8`'s `images`. The plugin then applies optional transparency, alignment and color processing; raw browser workflow output can differ.

SD, SDXL, Flux, other Qwen architectures and arbitrary workflow import are unsupported. They need separate templates, node checks, size / mask contracts and Photoshop round-trip validation. Changing a dropdown filename is insufficient.

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

## 6. Environment tools

Run from the source root or matching extracted environment-tool directory:

```powershell
powershell.exe -NoProfile -File .\scripts\check-environment.ps1 -SettingsPath .\config\settings.example.json -ReportPath .\environment-report.json
```

Copy and edit the example first, or use exported panel settings. Add `-ModelRoot` for preset size / hash checks under `diffusion_models`, `text_encoders` and `vae`; `-SkipHash` skips hashing. `-Offline` runs local checks only. `-ComfyRoot` checks source revisions and the cancellation route. Exit codes: `0` all checks passed, `2` unverified items, `1` errors. This does not prove Photoshop acceptance.

To generate a separate launcher for an existing Python backend:

```powershell
$comfy = Read-Host 'ComfyUI directory containing main.py'
$models = Read-Host 'Model root directory'
$python = Read-Host 'Full path to this backend python.exe'
powershell.exe -NoProfile -File .\scripts\prepare-environment.ps1 -ComfyRoot $comfy -ModelRoot $models -PythonPath $python -OutputDirectory .\prepared-backend -Port 8199
```

This creates `extra_model_paths.yaml`, `start-comfyui.ps1` and importable `ps-ai-settings.json`. It refuses existing output directories, installs nothing, downloads no weights and leaves the backend untouched. Start the generated script yourself only when the service is stopped. It listens locally; if the port is already serving, reuse and check that service.

## 7. Troubleshooting

| Symptom | Check first |
| --- | --- |
| Browser works, plugin cannot connect | Complete origin, proxy API forwarding, certificate and Photoshop firewall rules. A manually applied loopback-only rule blocks LAN / remote backends; its administrator must adjust it deliberately. |
| Models missing | Search categories, exact relative names and backend logs. Refresh / restart normally after path changes. |
| Missing Qwen node / field | Compare pinned commits and schemas. Same-name older nodes may differ. |
| Different task ID / cancellation 404 | The task protocol is incompatible. Keep records and check versions; do not resubmit or use global interruption. |
| Slow text encoding | Initial loading, VRAM pressure and CPU offloading take time. The plugin uses `device=default`; ComfyUI chooses the actual device. Check its logs before forcing everything onto GPU. |
| No percentage before sampling | The node has not reported sampling steps yet. The panel shows a phase, then the task's real step progress. |
| Wrong candidate dimensions | Check source scaling and first-reference dimensions. Do not bypass checks by changing output size. |
| White fringe / color shift | Check whether preserving the source silhouette is appropriate, then ICC, raw model output, alignment and color matching. Composite manually if needed. |
