# Relighting workbench

[中文](RELIGHT.md) | English

This describes the structured lighting implementation in **0.5.0 (experimental prerelease)**. Use matching packages or source as described in the README; historical v0.4.0 packages lack this workbench. The original, local illustration and model reference are separate objects. New sessions default to experimental lighting layers derived from that reference; Full-image redraw remains an explicit choice. The illustration expresses lighting intent and does not predict the final composition or physically accurate rendering. See the [user guide](../usage/USER_GUIDE.en.md#relight) and [backend contract](BACKEND.en.md).

## Capabilities

| Area | Actual scope |
| --- | --- |
| Runtime | Photoshop 27+, UXP manifest 5/API 2, existing TypeScript/esbuild and DOM/Spectrum |
| Source | Active document's visible composite on explicit idle opening/reread; current-selection context or explicitly chosen entire image |
| Boundary | Frozen grayscale mask `M*(1-P)`, with `M=255` across the canvas for entire-image relight; original coordinates and protection |
| Lighting | Point, spot, directional and global ambient; semantic control, no provider per-light API |
| UI | PS 27 native probe confirmed large UXP dialog, PNG data URL, absolute DOM markers and pointer capture |
| Native writes | Existing application fails inside an open dialog; close for short capture/write, then restore the workbench |
| Models | Existing ComfyUI Qwen 2.1, Bailian, Gemini and OpenAI adapters; no new services or depth/normal/segmentation models |
| Output | Lighting layers and Full-image redraw only; new sessions default to experimental editable lighting fields, while explicit full-result mode and old history retain NORMAL image application |

The initial container probe used a disposable 128×96 synthetic document. Application inside the dialog returned an unavailable Make command; after closing, application succeeded. Identity comparison of 49,152 RGBA channels had maximum difference 0. Pre-existing document IDs/history were unchanged. Workbench controls, performance and generation are validated separately from this container/API combination.

An earlier implementation passed actual point, spot-target and directional dragging, repeated gestures and undo/redo in a PS27 native script. Resizing from 1040×740 to 1160×820 recalculated fit without changing the scene fingerprint; off-image lights could be found again. Draggable markers retained stable DOM nodes and pointer capture, and the stationary image-load/resize feedback loop settled. Closing released listeners, preview caches and image references. This historical source-script evidence does not validate the current lighting-layer, source-sync or large-image paths, or installed-panel behavior.

## Scene and coordinates

An explicit main-panel entry opens only after a successful fresh capture. Failure leaves the dialog closed while retaining its session, lights and exportable candidates. A reread initiated within an already open editor may reopen stale content with generation blocked. Source-read errors are resolved only after the new binding commits; disabled actions or unrelated successes cannot clear them. Successful retries supersede older feedback for the same feature/source without removing failed task records from History.

The entry control `relight-scope` defaults to `selection`; `document` is an explicit entire-image choice. `CaptureOptions.selection='document'` supplies a full-canvas editable mask without reading or writing Photoshop's selection. It is distinct from `context='document', selection='edit'` used by blending and from subject-background reconstruction. Whole-image relight must not require an environment outside a subject selection. Native 16-bit source samples and partial grayscale protection stay intact.

Capture checks required selection bounds and the processing pixel budget before any original-file picker, then revalidates the bound document and selection inside the capture modal after asynchronous file access. Missing selection has diagnostic code `selection-required` and bilingual guidance to create a selection or explicitly choose Entire image. Selection/source changes during authorization stop before working-copy creation, pixel reads or upload. Current document ICC remains authoritative; an explicit NONE profile type is never accepted just because its name says sRGB.

`RelightSession` and `FrozenRelightSubmission` retain the chosen scope and output kind locally, separate from provider fields and lighting scene JSON. An idle explicit panel opening or reread captures the active document and the panel's chosen scope while retaining edited lights; a failed read preserves the prior binding and marks it stale. Changing output kind requires an explicit reread before generation. The workbench identifies the actual source document/name, its frozen scope and any initial tagged working copy's original ID. Draft and historical scene reuse retain the current explicitly chosen capture policy; old history remains readable without a new scene schema.

Original-file authorization uses exact normalized native paths and session FileEntry handles. Optional Remember original-file access stores a schema-validated private `source-file-access.json`, separate from portable settings, containing only the preference and at most 32 path/token pairs. Tokens come from user-selected entries through `createPersistentToken` and restore through `getEntryForPersistentToken`; no arbitrary file URL or broad filesystem grant is used. Enabling remembers already authorized session handles too. Every use re-reads bounded bytes and validates path/dimensions/native depth through the reader and adapter; it never caches pixels or color conclusions. Invalid restored access falls back to at most one picker per operation. Token/storage failures preserve current authorized reads and show redacted guidance.

Opt-out preserves session handles but removes saved grants; Clear also drops session handles. Preference/removal writes serialize behind in-flight token writes, and a revision check prevents older reads/token creation from restoring cleared grants. Failed removal must remain visibly failed, retaining useful session access; do not claim persisted grants are gone. Automated mock regressions cover these access/scope paths. This iteration's limited installed flow is recorded under Validation boundary; persistent tokens, cleared/revoked access and all scope controls still need host acceptance, which synthetic capture/write checks cannot replace.

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

Each source snapshot prepares bounded 480-edge and 240-edge caches with masks resampled using visible-alpha weights. Transparent editable pixels cannot contribute edit coverage to protected visible content. Dragging reuses unchanged light geometry, cancels obsolete work and checks freshness again before PNG encoding. The current scheduler yields by a measured CPU time budget without assuming Canvas, WebGL, Workers or requestAnimationFrame support.

**Historical native baseline, prior preview implementation:** a PS27 core probe used a 4096×3072 sRGB8 source and eight mixed lights: capture took 6606ms and cache preparation 11ms. Across 12 warm runs, arithmetic median render/PNG/image-load times were 52.5/43/11ms, with total median 107.5ms and nearest-rank p95 118ms; the first run took 152ms. This is a core-function baseline, not current dragging FPS or a performance guarantee across computers.

A separate historical workbench measurement used the same 4096×3072 source size, eight lights and a 480×360 cache. Ten actual DOM parameter commits to a fresh image-load event took 111–124ms, median 116.5ms and nearest-rank p95 124ms. Window/dialog resize and image-load counters did not grow during a 2.513-second idle sample. This measures that earlier native preview-update latency, not the current scheduler, painted-frame FPS or long-term stability.

Compilation produces stable semantic text for all enabled lights and global intent. Natural direction, color and strength descriptions come first, followed by applicable numeric details. Disabled lights are omitted. Editor implementation details and precision caveats stay in the UI and metadata. Obvious supplemental conflicts produce warnings; this is not a general language parser. Structured data is stored independently of the final prompt.

| Backend | Actual conditions and geometry |
| --- | --- |
| ComfyUI | Clean source first, optional grayscale guide, then reference; existing graph/save node 8 |
| Bailian | Source/guide/reference roles and exact output size; seed within declared capabilities |
| Gemini | Source/guide centered in 1024-square, inverse crop; no configurable seed; visual guide |
| OpenAI | Source/reference in images; guide becomes a native alpha mask; identical source/mask transforms and inverse crop; no configurable seed |

Lighting positions describe unpadded source content. No invented lighting/depth/normal fields enter provider APIs. The illustration never replaces the clean primary source. Per-light precision, identity, text/logos and texture require inspection.

Tasks retain submitted scene/fingerprint, actual provider/model, sanitized capability snapshot, input dimensions, color information and result identity. A real seed is recorded only when supported; protocol placeholder 0 does not establish seed support. Submission freezes the scene; later edits mark the old result stale. Canceled/obsolete requests cannot become a new success; recovery uses the original UUID.

## Editable lighting fields and memory limits

New sessions use `lighting-layers`; old records without an output kind remain `full-result`. Changing this choice requires an explicit reread. One existing model request supplies an illumination reference; no per-light requests or new provider fields are added. The current `soft-guided-v1` extraction aims for soft overall lighting: estimate low-frequency brightness and chroma, smooth the fields using a source guide with fine texture removed, gently suppress small changes and limit extreme gains. Only the lighting fields are smoothed, not the original image. Structure similarity scores, correlation weights and content-boundary rejection are no longer used. Hard shadows and narrow rim lights may weaken; major structural edits can still leave broad lighting artifacts. Real-photo visual acceptance remains pending.

New extraction summaries identify `method: soft-guided-v1` without fabricated similarity scores; legacy fields and error types remain for compatibility. Explicitly loading a historical candidate can re-extract from the original UUID's saved source, mask and AI output without resubmission or rewriting the old job state. Source snapshots, color, dimensions, transparency and application authority still require validation; extraction never silently switches to Full-image redraw. Screenshots of old structure rejections remain historical evidence, not a claim that the current algorithm rejects the same content.

The native writer copies the frozen source composite into an isolated NORMAL group, then adds available Shadow/Multiply, Cast Shadow/Multiply, Color Atmosphere/Color, Light/Screen and Rim Light/Screen layers in that order. Group and layer opacity/fill start at 100%; each channel has an editable white mask, and the group carries the exact selection-minus-protection mask once. Multiply uses white at zero influence, Screen uses black, and Color uses zero alpha. Absent channels are omitted and their absence recorded; a fully neutral reference creates no empty lighting group. Cast Shadow needs an observed dark receiver downstream of a stable source edge; this is a 2D classification, not recovered occlusion. Rim Light needs an enabled rim light and an observed edge response.

The experimental source path supports tagged sRGB RGB8/16 with opaque pixels throughout the editable area. Other profiles, grayscale and editable transparency are rejected explicitly; native strips recheck actual source opacity during application and roll back a failed write. Full-result output remains an explicit choice with its existing color/alpha rules. The native base retains document depth, while provider inputs remain sRGB8. Lost highlight/shadow detail cannot be reconstructed. Hair, skin, text, logos, cloth and cast-shadow plausibility require user visual acceptance. Synthetic native writer evidence is recorded below; the complete 45MP workflow and real inference for these fields remain pending.

The document limit is 45,000,000 pixels and 30,000 per side. Lighting capture keeps native masks but limits its analysis raster to 1,048,576 pixels/1536 per side. Native base and influence layers use sequential strips of at most 262,144 pixels, pinned to the captured history. A 512,000,000-byte estimated image-working-set gate includes old/new capture overlap, analysis/filter arrays, strips and retained panel buffers; it is not a measurement of total Photoshop RAM or a guarantee that every document below 45MP fits. With no additional retained panel buffers, the current planner estimates 382,765,492 bytes for a 9000×5000 RGB8 edit and 399,530,984 bytes for RGB16, each using a 1373×763 analysis image. These are static estimates, not measured peaks or native acceptance.

Ordinary native-resolution ROI capture has separate pixel and byte budgets. When it cannot fit, ordinary edits and full-image redraw use a bounded working raster marked `edit-analysis`, instead of rejecting solely because the selection exceeds 16M pixels. Native masks remain grayscale; application reads strips pinned to the captured history, retains source alpha or reconstructs background with `min(S,A)` once, and writes pixels and an editable mask at original coordinates. Candidate caches do not retain every native mask; application reloads it by the original task. Legacy history keeps its saved behavior. PNG CRC, inflation, color and model-output limits remain unchanged. Large ordinary candidate exports use model dimensions, backgrounds use working dimensions, and successfully derived lighting composites use saved analysis dimensions; rejected lighting references use actual model-output dimensions. Full-resolution delivery requires applying to the still-valid source and saving as PSD or exporting from Photoshop.

On 2026-10-19, disposable synthetic documents in Photoshop 27.0.0 passed ordinary large-selection checks for 6000×4000 RGB8, 9000×5000 RGB16 and a 9000×5000 RGB8 background with transparent strips, a translucent subject and protection. An analysis target of 512 produced 627×418 or 686×381 working rasters while retaining native 24M/45M masks. Capture/write times were 1980/6666ms, 3855/18171ms and 3536/6876ms, respectively. Sampled source-layer, protected and undo-restored pixels were unchanged; one-step undo, cancellation during preflight and native selection restoration passed. RGB16 mask error was at most 1/65535 and visible-composite error 1.13/65535; both RGB8 cases stayed below 0.46/255. Visible-composite comparisons exclude undefined RGB at alpha zero; source layers are checked separately. All temporary documents closed. This is native API evidence, excluding AI inference, installed-panel interaction, complete export and real-photo lighting quality, and is not a memory-peak measurement.

On the same date, an unsaved duplicate of a 3929×5893 (23,153,597-pixel) sRGB8 photograph passed the ordinary large-selection API check. Analysis target 1024 yielded an 836×1254 working raster with a full native mask; capture/write took 16022/20109ms. SHA256 over every current native pixel confirmed the source layer was unchanged. One undo and cancellation after the first written strip each restored the full composite, layers and history. The duplicate closed and the original document state remained unchanged. Application used a local constant-color fixture, without AI inference or lighting-quality acceptance.

Source observation is scoped to the open workbench and coalesces documented Photoshop events into metadata checks. While idle, an explicit opening from the panel or Reread captures the active document's visible composite, including generated backgrounds and merged content. Reading changes no layer opacity or visibility and requires neither result exclusion nor a separate binding action. A complete successful capture publishes the binding, retains edited lights, clears the selected old result and displays the current source; failure retains the old editor/candidates with an explicit stale reason. Internal dialog reopening after generation/application and reopening during a running task retain its frozen context without implicit capture. Closing stops observation and preview work; it does not read pixels in the background or cancel an already submitted task. Old results retain their submitted source and export path; reread grants no new apply permission. Apply independently revalidates document/session/history and mask identity. ICC, transparency, selection and memory-budget checks still apply to reads.

Dragging uses a 240-edge cache and commits a 480-edge preview on release, with stable marker nodes, one running render and at most one latest pending render. High-frequency input does not read Photoshop pixels, save drafts or request AI. Pointer cancellation/blur/released-button fallbacks release interaction state; UXP does not guarantee a lostpointercapture event. A bounded UI-only uncompressed PNG avoids the compression search during dragging, at the cost of a larger local data URL.

Current offline core benchmark: Windows x64, Ryzen 7 9850X3D, Node 24.21.0, 4000×3000 RGB8 source, eight mixed lights, one cold run then 12 warm runs moving one light. Median is the arithmetic median; P95 is nearest-rank and equals max for 12 samples.

| Preview | Calculation median / P95 ms | PNG median / P95 ms | Base64 median / P95 ms | Total median / P95 ms |
| --- | --- | --- | --- | --- |
| Prior 480×360 | 90.84 / 91.89 | 33.90 / 37.74 | Not measured | 124.90 / 129.41, excludes Base64 |
| Current final 480×360 | 27.43 / 40.16 | 35.70 / 38.17 | 0.49 / 1.13 | 64.28 / 77.16 |
| Current drag 240×180 | 3.80 / 7.34 | 0.60 / 1.22 | 1.63 / 2.29 | 6.06 / 10.41 |

The two eight-light caches allocate 6,912,000 bytes of weight maps; this is array capacity, not a process-memory peak. Drag/final PNG sizes in this fixture were 173,081/76,835 bytes. The benchmark excludes native capture, image-load/painting and network/model time. It does not establish installed-panel latency or FPS; the historical native timings above measure an earlier implementation.

### Synthetic native API checks, 2026-10-19 local time

An independent Photoshop 27.0.0 probe completed at 2026-10-18 16:44 UTC (2026-10-19 in Asia/Shanghai). It used disposable synthetic documents and local targets, without inference or installed-panel interaction.

| Source | Capture / write ms | Observed checks |
| --- | --- | --- |
| 1024×300 sRGB RGB8 | 139 / 182 | Shadow, Color Atmosphere and Light; original-layer preservation, hiding the group and one undo each had maximum RGBA difference 0; layer count restored |
| 1024×300 sRGB RGB16 | 158 / 157 | Shadow and Light; original-layer preservation, hiding the group and one undo each had maximum RGBA difference 0; layer count restored |
| 9000×5000 sRGB RGB8 | 479 / 11106 | 1373×763 analysis raster (4,190,396 bytes), 45,000,000-byte native mask, Color Atmosphere and Light written in strips, 692 progress callbacks, group created; one undo restored layer count and history |

A follow-up at 16:48 UTC, after the localized-structure guard update, added a 0/128/255 grayscale group mask and a stronger coarse color field. Native composite versus local prepared preview had maximum difference 2/255 for RGB8 and 3/65535 for RGB16; protected pixels, original-layer preservation, hidden-group restoration and one undo each had maximum difference 0. Both small cases contained Shadow, Color Atmosphere and Light. Capture/write took 138/172ms for RGB8 and 146/170ms for RGB16. The repeated 45MP RGB8 case took 475/11044ms with the same analysis size, two channels, 692 progress callbacks and successful single-undo restoration of layer count/history.

Pre-existing document IDs, dimensions, profiles, history and saved state were preserved. These are single synthetic API timings, not memory peaks, detail-fidelity guarantees or a complete 45MP read/edit/generate/apply/export measurement. They cover native writing and the stated masked-preview comparison, not real-photo visual quality, 45MP RGB16, source-sync UI or an installed panel. Those checks remain separate.

## Complete result and color

Explicit Full-image redraw and old `full-result` history cover the processed region, not necessarily the whole document. They use a new NORMAL layer with an editable mask, opacity adjustment and one undo operation. Reapplication replaces only the plugin-owned candidate for that capture. Closed documents or changed history/profile/session refuse application while export remains available.

Native 16-bit source data is retained separately. Model input remains sRGB 8; platforms return sRGB 8, while ComfyUI optionally saves SDR PNG 16. This is not HDR or native 16-bit model generation. Imaging converts results into the target document; unsupported modes/profiles fail explicitly.

Translucent sources retain the existing validated clipping-base strategy to avoid alpha being applied twice. Unsafe multilayer sources require a merged visible copy and fresh capture, or manual composition after export. No safety check is bypassed.

Historical full-result evidence: a disposable 512×512 sRGB16 document in PS27 retained native channel values that were not multiples of 257. A previously saved real Qwen 8-bit result passed two consecutive applications through the earlier workbench and adapter: the second replaced the owned candidate without increasing the layer count. Successive undo operations restored the first candidate and original image. Original-layer preservation and both restorations each compared 1,048,576 native16 RGBA values with maximum difference 0. This used controlled host callbacks and an existing result file, not current lighting-layer application, new inference or full panel storage/network end-to-end acceptance; it does not establish lossless model color exchange.

## Output types and legacy history

The only output choices are `full-result` (Full-image redraw) and `lighting-layers` (Lighting layers). The older per-pixel editable compensation option, diagnostics and unused implementation have been removed. Lighting layers use the soft field extraction and input validity checks described above.

Legacy history without an output type still means `full-result`; unknown types remain rejected, and existing records are not rewritten in bulk. Changing the next output choice changes only new submissions. Existing candidates retain the preview, type and application action defined by their saved output type. A changed output choice still requires an explicit source reread before generation.

## Validation boundary

Current automated/core and simulated-panel tests cover state, coordinates, compilation, source lifecycle, bounded processing and synthetic lighting fields. The dated synthetic native API checks above cover the stated writer cases only. Complete 45MP read/edit/generate/apply/export acceptance, 45MP RGB16 and real-photo lighting quality remain pending checks.

Installed Portable 0.5.0 b3548bd4 passed a limited PS27 chain using a public PNG8 and controlled local-response backend with no upstream inference: one POST/two uploads prepared a valid lighting group, application and one Photoshop Undo succeeded, and reading the same UUID from History then applying again added no POST. The former recorded-group exclusion/reread control retained lights and old candidates; this control and separate binding actions are now retired. The current **Re-read current document** action captures the visible composite including applied results. In that historical check, a failed-extraction reference stayed inspection-only with Apply blocked. One intensity gesture from 1 to 3.2 returned to 1 with one local Undo and no editing-time request; exactly Lighting layers and Full-image redraw were offered. After three Photoshop Undo operations returned the public PNG8 working copy to NONE, the actual recovery action created and captured a new sRGB copy while retaining the old document, edited key light and two old candidates; no candidate was selected or authorized for the new source. These are installed interaction observations, not every control, model quality or final-revision installation acceptance.

Native duplication does not guarantee retention of Photoshop's selection. Revision 4f18ca2 independently guards original/copy history and selection. Native API checks on a public 512×512 PNG8 passed both selection/document scopes with identical full SHA256 values for the original native, captured selection and effective masks, preserving existing documents. Follow-up verified 21 installed runtime-file hashes for 291c1d40 and the settings label `PS-AI 0.5.0 · 291c1d40`. Missing selection was correctly rejected; full selection and the real original-file picker then created a color copy and opened the workbench with the correct source/key light and no size error. Persistent file access, other sources/scopes, drag latency and broader source synchronization remain outside that limited flow.

The following historical model observations precede the new lighting-field path. Local ComfyUI/Qwen2.1 comparisons used 512×512, fixed seed 23491 and 25 steps: the first numeric-heavy compiler failed visually, while natural direction and color wording produced distinguishable left/right warm lighting and cool lighting on synthetic objects. Real outputs from a public NASA/scikit-image photo retained the broad pose, clothing and environment with visible color changes. Small badge text and fine texture were not accepted as faithful. These observations do not validate the current field extraction or its detail protection.

The earlier full source-panel native-network probe was denied on its first GET in PSJS, with zero uploads or inference submissions and unchanged pre-existing documents. Adobe lists [Network as unavailable to scripts](https://developer.adobe.com/photoshop/uxp/2022/scripting/how-it-works/). This iteration's controlled installed-plugin network flow is recorded above; actual model inference, native module application and platform-network acceptance remain separate evidence.

Model comparisons, native workbench controls and performance measurements have separate evidence. Uncovered installed controls, platform generation and broader face/text/fabric quality still require acceptance. A single error metric cannot replace those checks.
