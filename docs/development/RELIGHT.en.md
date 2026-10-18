# Relighting workbench

[中文](RELIGHT.md) | English

This describes the development upgrade, absent from existing release packages. The original, local illustration and AI result are separate objects. The illustration expresses lighting intent, not a final AI result or physically accurate rendering. See the [user guide](../usage/USER_GUIDE.en.md#relight) and [backend contract](BACKEND.en.md).

## Capabilities

| Area | Actual scope |
| --- | --- |
| Runtime | Photoshop 27+, UXP manifest 5/API 2, existing TypeScript/esbuild and DOM/Spectrum |
| Source | Visible composite from the bound document; current-selection context or explicitly chosen entire image |
| Boundary | Frozen grayscale mask `M*(1-P)`, with `M=255` across the canvas for entire-image relight; original coordinates and protection |
| Lighting | Point, spot, directional and global ambient; semantic control, no provider per-light API |
| UI | PS 27 native probe confirmed large UXP dialog, PNG data URL, absolute DOM markers and pointer capture |
| Native writes | Existing application fails inside an open dialog; close for short capture/write, then restore the workbench |
| Models | Existing ComfyUI Qwen 2.1, Bailian, Gemini and OpenAI adapters; no new services or depth/normal/segmentation models |
| Output | NORMAL complete-result layer and editable mask; separately gated experimental compensation |

The initial container probe used a disposable 128×96 synthetic document. Application inside the dialog returned an unavailable Make command; after closing, application succeeded. Identity comparison of 49,152 RGBA channels had maximum difference 0. Pre-existing document IDs/history were unchanged. Workbench controls, performance and generation are validated separately from this container/API combination.

The final source passed actual point, spot-target and directional dragging, repeated gestures and undo/redo in a PS27 native script. Resizing from 1040×740 to 1160×820 recalculated fit without changing the scene fingerprint; off-image lights could be found again. Draggable markers retain stable DOM nodes and pointer capture. The stationary image-load/resize feedback loop was fixed; closing releases listeners, preview caches and image references. Source-script execution is not installed-panel acceptance.

## Scene and coordinates

The entry control `relight-scope` defaults to `selection`; `document` is an explicit entire-image choice. `CaptureOptions.selection='document'` supplies a full-canvas editable mask without reading or writing Photoshop's selection. It is distinct from `context='document', selection='edit'` used by blending and from subject-background reconstruction. Whole-image relight must not require an environment outside a subject selection. Native 16-bit source samples and partial grayscale protection stay intact.

Capture checks required selection bounds and the processing pixel budget before any original-file picker, then revalidates the bound document and selection inside the capture modal after asynchronous file access. Missing selection has diagnostic code `selection-required` and bilingual guidance to create a selection or explicitly choose Entire image. Selection/source changes during authorization stop before working-copy creation, pixel reads or upload. Current document ICC remains authoritative; an explicit NONE profile type is never accepted just because its name says sRGB.

`RelightSession` and `FrozenRelightSubmission` retain the chosen scope locally, separate from provider fields and lighting scene JSON. Reopen keeps that scope, source and edits. Changing the entry control requires explicit reread/rebind before generation; a failed reread preserves the prior binding. Reread retains edited lights and creates a new source snapshot. The workbench identifies the actual source document/name, its frozen scope and any initial tagged working copy's original ID. Draft and historical scene reuse retain the current explicitly chosen capture policy; old history remains readable without a new scene schema.

Original-file authorization uses exact normalized native paths and session FileEntry handles. Optional Remember original-file access stores a schema-validated private `source-file-access.json`, separate from portable settings, containing only the preference and at most 32 path/token pairs. Tokens come from user-selected entries through `createPersistentToken` and restore through `getEntryForPersistentToken`; no arbitrary file URL or broad filesystem grant is used. Enabling remembers already authorized session handles too. Every use re-reads bounded bytes and validates path/dimensions/native depth through the reader and adapter; it never caches pixels or color conclusions. Invalid restored access falls back to at most one picker per operation. Token/storage failures preserve current authorized reads and show redacted guidance.

Opt-out preserves session handles but removes saved grants; Clear also drops session handles. Preference/removal writes serialize behind in-flight token writes, and a revision check prevents older reads/token creation from restoring cleared grants. Failed removal must remain visibly failed, retaining useful session access; do not claim persisted grants are gone. These capture/access/scope paths have automated mock regressions only. Native installed-panel authorization, capture/apply/undo and current host ICC diagnosis remain pending and require separate host permission.

API references: [Adobe UXP modal dialogs](https://developer.adobe.com/uxp/guides/how-to/add-modal-dialogs/), [executeAsModal](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/executeasmodal), and [Imaging API](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/imaging/). A modal dialog blocks host interaction; close the editor during generation when needed, then reopen its retained configuration.

`RelightScene` has schemaVersion 1 and parameterVersion 1. Source binding records document/layer IDs, session/history, pixel digest, snapshot identity, native dimensions, bounds, profile/mode/depth and mask reference. Layer IDs describe visible-composite provenance. Images/binary masks stay outside scene JSON; credentials never belong in scene or task metadata.

Each light has a stable ID, name, role, type, enabled/position-lock state and applicable parameters. Key/fill/rim/custom roles are distinct from point/spot/directional types. Eight lights is an interaction limit, not a model precision claim. Disabling changes lighting; hiding markers changes only the view.

Coordinates originate at the processing region's top-left, x right/y down. Positions and spot targets use normalized `[-1,2]` coordinates, including off-image placement. Document coordinates are `(bounds.left+x*width,bounds.top+y*height)`. Model coordinates map through its content rectangle and padding; viewport coordinates add fitting, zoom and pan. Screen pixels are never passed as model coordinates, and resizing must not change the scene.

| Parameter | Convention |
| --- | --- |
| Intensity | Relative 0–4, not lumens/lux/exposure |
| Z | Relative depth intention -1–1, without recovered 3D geometry |
| Range | 0.05–3 times the processing short edge, point/spot only |
| Softness | 0–1 |
| Spot cone | 5–160 degrees with aim target |
| Directional | Direction -180–180, elevation -90–90 degrees; position is not distance attenuation |
| Color | Either temperature 2000–12000 K or custom `#RRGGBB`, never both active |

Global state includes ambient, preserve-and-fill versus reshape, shadow strength/softness, content-preservation intent and a supplement. Loading validates versions, fields, finite ranges, unique IDs, counts and geometry. Viewport and editor selection are separate; the scene fingerprint tracks actual enabled lighting intent rather than names, locks or hidden controls.

## Illustration and request compilation

The CPU illustration uses a separate downsampled sRGB 8 image and the actual grayscale editing range, preserving alpha. DOM markers/labels/handles are separate. There is no recovered occlusion, cast-shadow geometry, material response or physical reflection. Editing makes no generation request.

Each source snapshot prepares a maximum-480-edge image and a mask resampled with visible-alpha weights once. Transparent editable pixels cannot contribute edit coverage to protected visible content. Dragging reuses the cache, cancels obsolete work and checks freshness again before PNG encoding. A PS27 core probe used a 4096×3072 sRGB8 source and eight mixed lights: capture took 6606ms and cache preparation 11ms. Across 12 warm runs, arithmetic median render/PNG/image-load times were 52.5/43/11ms, with total median 107.5ms and nearest-rank p95 118ms; the first run took 152ms. This is a core-function baseline, not final dragging FPS or a performance guarantee across computers.

A separate workbench measurement used the same 4096×3072 source size, eight lights and a 480×360 cache. Ten actual DOM parameter commits to a fresh image-load event took 111–124ms, median 116.5ms and nearest-rank p95 124ms. Window/dialog resize and image-load counters did not grow during a 2.513-second idle sample. This measures native preview-update latency, not painted-frame FPS or long-term stability.

Compilation produces stable semantic text for all enabled lights and global intent. Natural direction, color and strength descriptions come first, followed by applicable numeric details. Disabled lights are omitted. Editor implementation details and precision caveats stay in the UI and metadata. Obvious supplemental conflicts produce warnings; this is not a general language parser. Structured data is stored independently of the final prompt.

| Backend | Actual conditions and geometry |
| --- | --- |
| ComfyUI | Clean source first, optional grayscale guide, then reference; existing graph/save node 8 |
| Bailian | Source/guide/reference roles and exact output size; seed within declared capabilities |
| Gemini | Source/guide centered in 1024-square, inverse crop; no configurable seed; visual guide |
| OpenAI | Source/reference in images; guide becomes a native alpha mask; identical source/mask transforms and inverse crop; no configurable seed |

Lighting positions describe unpadded source content. No invented lighting/depth/normal fields enter provider APIs. The illustration never replaces the clean primary source. Per-light precision, identity, text/logos and texture require inspection.

Tasks retain submitted scene/fingerprint, actual provider/model, sanitized capability snapshot, input dimensions, color information and result identity. A real seed is recorded only when supported; protocol placeholder 0 does not establish seed support. Submission freezes the scene; later edits mark the old result stale. Canceled/obsolete requests cannot become a new success; recovery uses the original UUID.

## Complete result and color

A complete result covers the processed region, not necessarily the whole document. It uses a new NORMAL layer with an editable mask, opacity adjustment and one undo operation. Reapplication replaces only the plugin-owned candidate for that capture. Closed documents or changed history/profile/session refuse application while export remains available.

Native 16-bit source data is retained separately. Model input remains sRGB 8; platforms return sRGB 8, while ComfyUI optionally saves SDR PNG 16. This is not HDR or native 16-bit model generation. Imaging converts results into the target document; unsupported modes/profiles fail explicitly.

Translucent sources retain the existing validated clipping-base strategy to avoid alpha being applied twice. Unsafe multilayer sources require a merged visible copy and fresh capture, or manual composition after export. No safety check is bypassed.

A disposable 512×512 sRGB16 document in PS27 retained native channel values that were not multiples of 257. A previously saved real Qwen 8-bit result passed two consecutive applications through the actual workbench and adapter: the second replaced the owned candidate without increasing the layer count. Successive undo operations restored the first candidate and original image. Original-layer preservation and both restorations each compared 1,048,576 native16 RGBA values with maximum difference 0. This used controlled host callbacks and an existing result file, not new inference or full panel storage/network end-to-end acceptance; it does not establish lossless model color exchange.

## Experimental compensation

The baseline requires equal dimensions/depth, fully opaque alpha and fixed encoded-sRGB values. It is not linear-light data or freely ICC-convertible photography. For normalized per-channel base `B` and target `R`:

- `R<B`: `D=R/B`, `L=0`.
- `R>B`: `D=1`, `L=(R-B)/(1-B)`.
- Equal: `D=1`, `L=0`.
- Dark then light: `C=1-(1-B*D)*(1-L)`.

Branches avoid zero denominators. Quantized maps are recomposed and measured with RGB maximum absolute error, mean absolute error and RMSE, in code values and normalized units. Transparency, unknown color conditions, unequal depth or unsupported blend settings reject compensation while preserving the complete result.

An independent PS 27 probe used a NORMAL isolated group with a fixed opaque base, Multiply dark and Screen light, full opacity and no masks. Maps were written directly in the document's encoded channel space without cross-profile conversion. sRGB/Adobe RGB at 8-bit had maximum error 0; 16-bit maximum was 2/65535, mean approximately 0.284 code values across RGBA. Display P3 was unavailable and skipped. These numbers do not establish product support for Adobe RGB compensation or real-image quality.

**Compensation application remains unavailable.** Reconstruction does not prove the layers contain only lighting: facial, logo and texture edits may also appear. Both native composition and real-image visual acceptance are required before creating compensation layers. They must never stack over the same complete result.

## Validation boundary

Automated/core and simulated-panel tests cover state, coordinates, compilation and failure handling. Native probes validate specific PS 27 API combinations. Local ComfyUI/Qwen2.1 comparisons used 512×512, fixed seed 23491 and 25 steps: the first numeric-heavy compiler failed visually, while natural direction and color wording produced distinguishable left/right warm lighting and cool lighting on synthetic objects. Real outputs from a public NASA/scikit-image photo retained the broad pose, clothing and environment with visible color changes. Small badge text and fine texture were not accepted as faithful; compensation was not enabled.

The full source-panel native-network probe was denied on its first GET in PSJS, with zero uploads or inference submissions and unchanged pre-existing documents. Adobe lists [Network as unavailable to scripts](https://developer.adobe.com/photoshop/uxp/2022/scripting/how-it-works/); the network path needs acceptance in an installed UXP plugin. Independent model inference, native module application and this full panel end-to-end check remain separate evidence.

Model comparisons, native workbench controls and performance measurements have separate evidence. Installed-panel behavior, platform generation and broader face/text/fabric quality still require acceptance. A single error metric cannot replace those checks.
