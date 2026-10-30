<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">PS-AI User Guide</h1>
<p align="center"><a href="USER_GUIDE.md">简体中文</a> · <strong>English</strong> · <a href="../README.en.md">Home</a></p>

Start with a small edit: **connect → read the range → describe and generate → inspect and apply**. [Install the plugin](../README.en.md#install-a-release-package), then [configure ComfyUI from zero](../setup/COMFYUI.en.md#beginner) for a local backend, or connect a [cloud service](../setup/PLATFORMS.en.md).

> This guide covers **0.5.2 experimental**, including the guided interface, automatic color working copies and Blend lighting mode. Match the downloaded package with the version/build identity in Settings; older packages may differ. Real outputs and local composite previews are labeled separately below and do not establish complete regression for this version, acceptance for every mode or clean-machine installation.

Create, Settings and Results are native PS27 screenshots captured during release preparation under a separate Preview demonstration identity: source preview, read-only model scanning and existing historical candidate loading were performed, without new generation. The Relighting interface screenshot remains historical 0.5.0. Screenshots use the Chinese interface.

<a id="current-ui"></a>

## Make your first edit

1. **Connect an existing service.** Start ComfyUI, enter its address in **Settings → Backend and models**, scan models and connect. Scanning retains available choices and fills only unique preset matches; choose other files manually. The [configuration tools](../setup/COMFYUI.en.md#environment-tools) can also prepare importable settings from a running service, without reinstalling or downloading models.
2. **Prepare the range.** Open a saved copy, choose **Local edit → Objects and materials**, select a small area and use **Preview selection**. **Orange is editable, blue is protected, gray is context.**
3. **Describe the change.** Try “make the metal ornament matte silver, preserving its shape.” Review the candidate count, resolution, depth and destination summary; expand **Generate and output** when needed.
4. **Generate and inspect.** Use **Generate candidates** at the bottom. Keep the source unchanged; inspect edges, color, faces and text in Results, then apply as a new layer or save a PNG. One Ctrl+Z reverses one application.

<p align="center"><a href="../../assets/guide/workflow-create-zh.png"><img src="../../assets/guide/workflow-create-zh.png" width="420" alt="Current native Photoshop Create panel with captured range and draft prompt, before generation"></a></p>

**Next step** offers an action based on connection, source and input state; navigation does not submit generation. Expand protection, references and settings as needed. Switching Create / Results / History / Settings preserves drafts and running tasks. Opening the panel does not start a backend or generate.

<details>
<summary>Connection settings and practical defaults</summary>

<p align="center"><a href="../../assets/guide/workflow-settings-zh.png"><img src="../../assets/guide/workflow-settings-zh.png" width="420" alt="Current native Settings panel after model scanning, with connection still unchecked"></a></p>

| Setting | Suggestion |
| --- | --- |
| Candidates | 1–4 per batch, generated sequentially; a locked seed increments per candidate |
| Resolution / steps | Common choices are 768, 992 and 1024; default 25 steps, more is not necessarily better |
| Context margin | Default 15%, adding reference context only; background, scene and Blend read the full canvas |
| Range guide | A visual hint; Photoshop masks enforce the actual boundary. Some modes disable it |
| Preserve source transparency | Useful for clothing/material edits; disable when intentionally extending or removing silhouettes |
| Alignment / color matching | Use where appropriate; do not cancel deliberate lighting changes with color matching |

Settings JSON transfers addresses, model mappings and language, without keys, model files or image history. CCX and Portable have separate data. Follow [platform setup](../setup/PLATFORMS.en.md) for cloud keys; do not send them to arbitrary imported addresses.

</details>

## Choose a mode and selection

| Workspace / mode | What to select and describe |
| --- | --- |
| <a id="edit"></a>Local edit · Objects and materials | Select the object; describe material, color and shapes to retain |
| <a id="remove"></a>Local edit · Remove objects | Select the distraction with some surroundings; a built-in instruction replaces the prompt field |
| <a id="background"></a><a id="background-fix"></a>Local edit · Replace background | **Select the subject to keep; do not invert.** Describe the new scene, ground and lighting |
| <a id="costume"></a>Portrait · Clothing and props | Select clothing/props, avoiding faces and hands that should stay |
| <a id="reference"></a>Portrait · Character reference | Select the edit area, import a reference and name the features to borrow; identity is not guaranteed |
| <a id="scene"></a>Portrait · Replace scene | Keep the subject selected, as for backgrounds; describe environment, time and lighting |
| <a id="effect"></a>Portrait · Effect asset | Select placement, describe shape/direction/color; text-only generation is also available |
| <a id="atmosphere"></a>Portrait · Atmosphere asset | Select placement for mist, smoke or particles; text-only generation is also available |
| <a id="generate"></a>Generate · Text to image | Describe subject, setting, composition and style; no references, usually no selection |
| Portrait · [Relighting](#relight) | Current selection, or explicitly choose Entire image, then arrange lights |
| Portrait · [Image Blending](#blend) | Select the foreground already placed in a visible environment |

To protect faces or text, select them and use **Set protection**, then select the edit area. Protection is subtracted from the editable range, retaining feathers; context never enlarges the apply boundary. Prepare selections again after changing documents or reusing parameters.

If Undo loses your selection, **Restore last selection and reread** restores the saved range for this document and mode within the same session, then reads current pixels. It does not submit a task or restore old candidates' apply permission.

**Background / scene:** reads the full canvas and disables source-alpha retention, alignment and color matching; ComfyUI also disables the range guide. Inspect hair, translucent edges and ground contact. Clearly transparent backgrounds are export-only. Old tasks retain their saved ranges.

<a id="context-assets"></a>

**Effects / atmosphere:** **Use current image and selection** sends source and grayscale range together; imported character references are not used. Choose **Text-only independent asset** to omit the source. Input and destination are separate: **New document** does not mean text-only. Apply retains asset alpha and uses the saved range mask once; fully opaque output is export-only.

Image-context Qwen samples can retain people, backgrounds or guide boundaries and **have not passed visual acceptance**. The gallery's asset examples are text-only outputs positioned manually, not successful image-context generation.

<a id="relight"></a>

## Relight an image

1. Choose **Portrait → Relighting**, then Current selection or Entire image. Include the ground if you want shadows there.
2. Open the workbench and check the current composite. After changing the background/document, use **Reread current document**; edited lights remain. Add a background beneath cutouts in a copy so the editable area is opaque.
3. Add, move and adjust up to eight lights; duplicate, disable or lock them. The local illustration expresses intent. Dragging, workbench Undo and hiding markers do not generate images.
4. Explicitly use **Generate AI result**, inspect, then apply or export. Changing lights after generation marks the old result as outdated.

<p align="center"><a href="../../assets/guide/050-relight-zh.png"><img src="../../assets/guide/050-relight-zh.png" width="800" alt="Relighting workbench with a local lighting illustration"></a></p>

| Output / control | Use |
| --- | --- |
| Lighting layers (default) | Estimate lighting from the AI reference, overlay the original, and apply a masked pass-through group without copying the base |
| Full-image redraw | Use the model image; structure and texture may change. Applies as a masked layer |
| Light fidelity | 0–1, default 1; lower to weaken the effect, 0 returns to the original |
| Detail protection | 0–1, default 0.65; higher reduces fine changes and softens local shadows |

Releasing a slider or confirming a value recalculates locally and saves with the candidate, **without generating again**. Group opacity is also adjustable. Changing the underlying content or position can make saved lighting unsuitable.

Lighting requires tagged sRGB RGB8/16 with opaque editable coverage. The original remains the content base, but lighting and redraw cannot be fully separated: large offsets can leave patches, while hard shadows and narrow rim lights can weaken. Export the raw AI reference separately if needed; the plugin does not switch to redraw automatically.

Read failures retain lights and old candidates but cannot authorize a new task with stale pixels. Reopening during a task shows its bound source. The workbench may briefly close during reads/writes; closing it does not cancel work. Use the task cancellation button.

<a id="blend"></a>

## Match a subject to its environment

1. Place the subject in a background, then select the foreground. Do not select the whole canvas; an isolated transparent cutout has no environment to match.
2. Read the current image and range, set protection if needed, describe something like “match warm window light from the left,” then generate.
3. Compare source, blend preview and AI reference. Inspect the subject, edges and detail before applying. The background is context; application changes only the subject minus protection.

New tasks in 0.5.2 default to **Preserve detail · lighting only**, applying a lighting group without a base-image copy. Adjust fidelity/detail locally without resubmission, or explicitly choose **AI redraw subject**. Old history retains its original method. Lighting has the same source requirements as Relighting, with no automatic fallback.

Blend reads the full composite and disables alignment and context color matching; ComfyUI omits the grayscale guide. Weak AI lighting cannot be amplified into nonexistent light by extraction. Photographic results can be subtle, and patches/shadows need inspection. The gallery's old Blend example uses **AI redraw**, not the new lighting extraction.

<details>
<summary>Real outputs and limitations for all eleven modes</summary>

These use the designated `3F3F3F.webp` image and its edited copies. Local edits are composited with saved selections; gray shows transparency. These are actual generated files and local composite previews, **not Photoshop apply screenshots**. Click for full size.

**Objects and materials:** “change this doll into a black-cat doll,” shown as a waist crop.
<p><a href="../../assets/guide/050-result-edit.png"><img src="../../assets/guide/050-result-edit.png" width="480" alt="Waist doll changed into a black-cat doll"></a></p>

**Removal:** fills the doll's area; seams and clothing linework still need inspection.
<p><a href="../../assets/guide/050-result-remove.png"><img src="../../assets/guide/050-result-remove.png" width="412" alt="Before and after removing the waist doll"></a></p>

**Background:** retains the subject in a pale-blue studio with contact shadows.
<p><a href="../../assets/guide/050-result-background.png"><img src="../../assets/guide/050-result-background.png" width="720" alt="Transparent background replaced with a pale-blue studio"></a></p>

**Clothing:** white over-knee socks, shown as a leg crop.
<p><a href="../../assets/guide/050-result-costume.png"><img src="../../assets/guide/050-result-costume.png" width="480" alt="Before and after changing to white over-knee socks"></a></p>

**Character reference · failure:** source / reference / composite; shrinking, misalignment and seams make this unsuitable.
<p><a href="../../assets/guide/050-result-reference.png"><img src="../../assets/guide/050-result-reference.png" width="480" alt="Failed character-reference result, with source, black-cat reference and misalignment"></a></p>

**Scene:** the subject in a pink bedroom.
<p><a href="../../assets/guide/050-result-scene.png"><img src="../../assets/guide/050-result-scene.png" width="720" alt="Scene replaced with a pink bedroom"></a></p>

**Effect · text-only manual composition:** source / blue lightning asset / manually scaled and positioned preview.
<p><a href="../../assets/guide/050-result-effect.png"><img src="../../assets/guide/050-result-effect.png" width="720" alt="Text-only blue lightning asset with manual composition"></a></p>

**Atmosphere · text-only manual composition:** source / golden particles / proportionally scaled, cropped overlay.
<p><a href="../../assets/guide/050-result-atmosphere.png"><img src="../../assets/guide/050-result-atmosphere.png" width="720" alt="Text-only golden particles with manual composition"></a></p>

**Text to image:** an independent pink bedroom, without reading or editing the character image.
<p><a href="../../assets/guide/050-result-generate.png"><img src="../../assets/guide/050-result-generate.png" width="480" alt="Independently generated pink bedroom"></a></p>

**Relighting:** source / real AI reference / local lighting preview, warm left and cool right. Source combines the character and generated room; fidelity 1, detail protection 0.65. No additional grading; this does not establish photographic results.
<p><a href="../../assets/guide/050-result-relight.png"><img src="../../assets/guide/050-result-relight.png" width="720" alt="Source, AI reference and warm/cool lighting-layer composite preview"></a></p>

**Blend · legacy AI redraw:** the subject becomes darker in a stage environment, with the saved range retaining the background; face and clothing details also change.
<p><a href="../../assets/guide/050-result-blend.png"><img src="../../assets/guide/050-result-blend.png" width="720" alt="Legacy AI redraw blending comparison, not the new lighting mode"></a></p>

</details>

## Compare, apply and export

Select thumbnails in Results and use **100% view** to inspect details. Applying creates a masked layer while retaining originals; within the same capture you can replace that round's candidate layer. Lighting output uses a group. One Undo reverses one application; opacity changes add separate history, and panel sliders do not synchronize after Photoshop Undo.

<p align="center"><a href="../../assets/guide/workflow-results-zh.png"><img src="../../assets/guide/workflow-results-zh.png" width="420" alt="Current native Results panel with a real historical scene candidate; original source closed or session ended, export only"></a></p>

This screenshot loads an existing real scene candidate in the branch's final runtime. Its source is closed or its session has ended, so only export actions are offered. No remote recovery, generation or layer application occurred, and the old candidate's source permissions were not changed.

**Save PNG** and **View in new document** remain available for export. Working/analysis rasters can be smaller than the original; apply and save through Photoshop for original-size delivery. Do not modify the source during generation. Changed, closed or previous-session sources cannot receive old candidates; export remains available, and **Check source** explains the block.

## History, disconnections and cancellation

| Action | What happens |
| --- | --- |
| Click / check records | Click for details, check for bulk clearing; 20 per page, Select all covers every page in the current filter |
| Load candidates | Read local results without generation; the original source still determines apply permission |
| Reuse parameters | Reuse descriptions/settings, then prepare selection, protection and references again |
| Recover task | Switch to its saved backend type/address, then query the original UUID without resubmission |
| Cancel | Cancel the current task and stop later candidates; started cloud requests may still complete and be billed |
| Clear checked history | Confirm deletion of local records/plugin candidate files; Photoshop documents, layers, exports, settings and lighting drafts remain |

Unresolved tasks stay visible. Repeated failed status reads retain unknown state and the original ID for later recovery; unknown does not mean remote failure. Only unknown tasks allow a second confirmation to **Stop local tracking**. This does not cancel remote work or billing; generating again can duplicate it. Clearing history also does not cancel or clear the backend. Retry interrupted local cleanup with **Retry local cleanup**.

<a id="source-color"></a>

## Color, depth and originals

**Photoshop's current document ICC** takes priority, including opening-policy conversions; an imported layer's file cannot establish the whole composite's color. Reading the document never opens another original-file picker. Exact authorized files can provide verified declarations; otherwise unresolved untagged RGB8/16 uses an independent sRGB copy retaining layers, depth and range, with the original preserved.

**Assumed sRGB** means an approximation with possible color differences, not recovered ICC. Its notice survives same-session rereads and saved candidates; apply binds only to that copy. References do not use this approximation: they need current ICC or a reliable declaration from the exact selected file. For unknown references, verify and embed the correct ICC in a copy before retrying.

If repeated Undo removes a known working copy's tag, only exact session-proven sources offer **Create recovered-color copy and reread**. This preserves the old document and redo history, creating a new source without granting old candidates new apply permission. Otherwise check color manually. Legacy file grants live in **Settings → File access and privacy**, outside routine reading.

Model/reference inputs are sRGB8, losing wide-gamut color and precision. [Optional SDR16](../setup/COMFYUI.en.md#output-depth) is not native 16-bit generation or HDR; platforms currently output sRGB8. Applying to an 8-bit document reduces output to 8-bit without converting the original automatically.

## Troubleshooting

| Situation | Next step |
| --- | --- |
| Missing selection / fully protected | Reselect or clear protection; Relighting can explicitly use Entire image |
| Old source in workbench | Reread and check success; reopening during a task retains its original source |
| Unsafe translucent multilayer application | Merge visible layers in a copy and regenerate, or export and compose manually |
| Source changed, apply blocked | Export old candidates; read the current image for a new task |
| Connection, model or depth errors | Expand technical details and follow [ComfyUI setup](../setup/COMFYUI.en.md) |
| Photoshop exits | Save work and record reproduction steps/redacted errors; changing installation formats may not resolve it |

Documents are limited to 45 million pixels and 30,000 per side. CMYK, Lab, Indexed, Multichannel, 32-bit HDR and unknown-profile Grayscale are unsupported. Inspect references, lighting, blending and assets individually; real cloud-key output remains unvalidated. See [the homepage](../README.en.md#before-you-use-it) for licensing and data handling.

**Settings → Host diagnostics → Image round-trip validation** writes to test documents to check selections, masks, Undo and rollback. Save work first; inspect privacy before sharing reports. Technical boundaries are in the [backend contract](../development/BACKEND.en.md) and [relighting implementation](../development/RELIGHT.en.md).
