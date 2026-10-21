<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">Using PS-AI</h1>
<p align="center"><a href="USER_GUIDE.md">简体中文</a> · <strong>English</strong></p>

This guide covers **0.5.0 (experimental prerelease)**: eleven modes across Local edit, Portrait and Generate, with Create / Results / History / Settings navigation. Install matching packages or build the corresponding source using the [README](../README.en.md#install-a-release-package). For backend configuration, see [platform setup](../setup/PLATFORMS.en.md) and [ComfyUI setup](../setup/COMFYUI.en.md).

All demonstration images now show actual installed Portable **0.5.0 c3adef56** in Photoshop 27, using an independent copy of **3F3F3F.webp**. Older effect images have been removed; canonical brand artwork is retained.

Mode captures show configuration entries before prompts, reference import or selection preview. They do not demonstrate completed generation or range acceptance. See [Bailian](../providers/BAILIAN.en.md), [Gemini / Nano Banana](../providers/GEMINI.en.md) and [OpenAI Images](../providers/OPENAI.en.md) for adapter limits; live platform output still needs API-key acceptance.

<a id="current-ui"></a>

## Current interface walkthrough (0.5.0)

Two capture sessions use the same **0.5.0 c3adef56** runtime. The unmerged sRGB8 demonstration copy preserves foreground pixels/alpha over a separate neutral-gray background. Settings, workbench, Results and layers in this walkthrough use a controlled local lighting response at `127.0.0.1:8194`; the missing-selection image uses the unedited original WebP without generating. Mode/advanced captures below submit no inference, while the [model configuration image](../setup/COMFYUI.en.md#connection) separately scans the actual local ComfyUI catalog at `localhost:8188`. **Controlled operations, configuration captures and model scanning do not establish real generation quality or all-mode acceptance.** Images retain actual capture pixels; click for original resolution. Some captures show Chinese UI; English Settings is also provided.

1. **Configure:** open Settings → Backend and models. The demonstration endpoint is isolated; use your own compatible ComfyUI or the platform setup instructions for actual generation. Scanning a catalog does not establish live model quality.

   ![0.5.0 English Settings view; local controlled demonstration](../../assets/guide/050-settings-en.png)

2. **Prepare:** return to Create, choose the mode, and inspect the source, selection and protection. The pictured source is a separate copy, not an overwrite of the original file.

   ![0.5.0 Create view on the sample copy; UI operation sample](../../assets/guide/050-create-zh.png)

3. **Relight explicitly:** choose the lighting scope and open the workbench. Original, local illustration and AI-result views are distinct; editing a light expresses intent. The workbench illustration is a local preview; generated responses in this walkthrough are controlled local data, not model-quality examples.

   ![0.5.0 lighting workbench; controlled local response context](../../assets/guide/050-relight-zh.png)

4. **Inspect and deliver:** inspect Results and source availability before applying or exporting. The layer view illustrates the Photoshop lighting-group structure for this controlled sample, not physically isolated illumination or guaranteed detail fidelity.

   | Results view | Photoshop layers view |
   | --- | --- |
   | ![0.5.0 Results view; controlled response, not model inference](../../assets/guide/050-results-zh.png) | ![0.5.0 lighting layers in Photoshop; controlled UI sample](../../assets/guide/050-layers-zh.png) |

5. **History and errors:** use the saved UUID to inspect/recover an existing task. A missing selection needs a new selection or an explicit Entire image lighting scope. The error view illustrates the message; it does not establish every recovery path.

   | History view | Missing-selection guidance |
   | --- | --- |
   | ![0.5.0 History view and local task details](../../assets/guide/050-history-zh.png) | ![0.5.0 missing-selection guidance; UI operation sample](../../assets/guide/050-selection-error-zh.png) |

The eleven mode sections below describe current operation; mode images show entries and controls only.

## 0.5.0 navigation

The current panel groups its controls into the areas below. Navigation only changes what is visible: the mode, prompt, reference, parameters, task and candidates remain intact. Generation, application and recovery still require an explicit action.

| Area | Contents |
| --- | --- |
| Create | Local edit / Portrait / Generate, task mode, description, selection and protection, reference, destination, generation parameters and output depth. Professional controls remain under Advanced parameters. |
| Results | Numbered candidates, a larger display preview, source and application availability, View at 100%, Save PNG, Open in new document and applied-layer opacity. |
| History | A selectable record table with All / Unresolved filters, pages, Load candidate, Reuse parameters and recovery. Explicitly reusing lighting reads the currently active document. |
| Settings | Backend and models, language, API keys, configuration import / export, setup wizard and host diagnostics. |

The bottom area presents the active task status; switching pages does not stop work. Apply continues to distinguish a new layer from replacement of this capture's candidate layer. Stale sources or unsafe candidates retain the export path. Errors appear near their owning feature. A completed successful retry or fresh read clears the corresponding old error; starting work, clicking a disabled button or success on another source does not. Failed task records remain in History. Technical details copies a redacted report directly and shows Copied only after the clipboard write succeeds.

Open the separate lighting workbench from Create → Portrait → Relighting. Its toolbar, light list and property groups share the panel's visual style. Original, Lighting illustration and AI result remain separate views. Hide markers only affects visibility; Enable this light determines whether a light participates in the lighting setup.

Display previews are separate from candidate and export pixels. Existing task parameters, scene formats and history remain readable; the new lighting-output default is described below. The captures show the current layout; other docking configurations, system scaling and the full host workflow still need separate acceptance.

## Current behavior and validation boundaries

The product version is **0.5.0**. The separate Git build identifier in Settings distinguishes revisions. Dated native checks and current configuration captures identify their own scopes and do not establish current full-product acceptance.

Opening the panel restores local settings and history metadata without automatically contacting a backend, scanning models or launching a relay. Choose Connect or Generate when needed. An offline backend does not block local navigation, and history images decode on demand. Installed Photoshop cold-start timing still requires separate measurement.

Automatically view results when complete defaults on and can be disabled in Settings. After an explicitly submitted batch has downloaded, validated, saved and prepared all candidates, the panel locates that batch by task ID once. Text input, dragging, an open lighting dialog or a hidden panel defers this navigation. Nothing is applied automatically. Failure, cancellation and partial success retain available candidates without claiming complete success.

Narrow History starts with the list. Selecting a record opens details; Back to history restores the filter, page, checks and browsing position. Select all still includes every page in the current filter. Create errors do not occupy History, and empty history has no empty task form.

History browsing and current Results are independent. A loaded candidate’s action uses its saved task UUID and source snapshot; browsing an invalid record cannot disable another valid candidate. Changed, closed or earlier-session sources offer a clickable Check source action with the reason and available recovery path, without writing to the document. Failed lighting extraction retains reference inspection/export and cannot become applicable by switching modes.

New lighting sessions default to Lighting layers; Full-image redraw remains an explicit choice. Old tasks retain their original output type. Lighting layers use one model target as a low-resolution lighting reference, then derive local influence fields over a native base copied from the original document. These fields can still alter the appearance of faces, lettering and materials. Structural mismatch or unsupported color/transparency conditions refuse application while retaining the reference output; there is no automatic redraw fallback. Initial layers support sRGB RGB8/16 with opaque editable pixels. Wide-gamut, grayscale and translucent edit regions require explicitly choosing the existing Full-image redraw path. Real-photo lighting quality requires human acceptance.

Opening the workbench while idle reads the visible composite of the currently active Photoshop document and retains edited lights. Generated backgrounds, merged layers and manual edits enter the source as currently shown on the canvas. Re-read current document also reads the active document, without excluding results or a separate binding action. Reading changes no layer opacity, visibility or content. Existing candidates retain their submitted snapshots and inspection/export paths; rereading grants no new apply permission. If a fresh read fails during explicit entry from the main panel, the dialog stays closed while lights and old candidates remain retained with the failure reason. A failed reread inside an already open workbench may show stale content. Reopening during a running task restores its frozen context without changing that task.

Source documents are limited to 45,000,000 pixels and a 30,000-pixel side. Large selections in ordinary editing, background/scene, blend and full-image redraw automatically use a budgeted working raster when native-resolution capture would exceed its budget. Selection feathering, protection and application coordinates remain at native size. The panel shows document, working, model-input and application dimensions. Analysis resolution, retained candidates and other session buffers affect the available budget; upsampling does not produce native 45MP model detail.

Photoshop 27 native API checks on 2026-10-19 passed capture, strip application, cancellation during preflight, selection restoration and single undo on 24MP RGB8, 45MP RGB16 ordinary edits and a 45MP RGB8 background. Sampled source and protected pixels remained unchanged. A 23.15MP real-photo duplicate also passed ordinary capture, native-size application, whole-source pixel preservation, single undo and rollback after partial writing. These API checks do not establish installed-panel, actual AI-output or lighting-quality acceptance; see the [development contract](../development/BACKEND.en.md#relighting-workbench).

The 2026-10-19 strip-read fix addresses `Invalid Source Bounds` when reading a partial selection in strips: only the intersection with the selection bounds is requested from Photoshop, while the mask for outside context remains zero. This was unrelated to JPG format. On the same date, an irregular subject selection in a 20.02MP sRGB8 JPG passed native ordinary full-context, background and relight capture, with zero per-pixel mask differences and unchanged source state. A separate feathered sample preserved gray values 1, 64, 128 and 255 exactly. Installed-panel interaction still requires separate acceptance.

Lighting uses an analysis copy capped at 1,048,576 pixels and a 1536-pixel side; the native base retains document depth, while model input remains sRGB8. Large selections and lighting layers are written in strips at the original edit coordinates, subject to an estimated 512,000,000-byte image-working-set gate. This is not a measurement of total Photoshop memory or a guarantee that every document within the pixel limit fits. Large-selection PNG exports and New document use the displayed model or working-raster dimensions; background candidates use the saved working size. Successfully derived lighting composites use the analysis dimensions, while a rejected extraction retains the reference at actual model-output dimensions. For full-resolution delivery, apply to the source and save as PSD or export from Photoshop.

For lighting candidates, Save AI reference exports the exact saved model output separately from Save PNG, which exports the prepared local composite. The raw-reference action makes no new generation request and remains available after extraction is rejected.

UXP requires the minimum writable clipboard declaration `clipboard: readAndWrite`; the plugin only writes redacted reports and never reads the clipboard. A failed copy reports failure and offers diagnostic export. New interactions, dragging, large-image application and lighting quality cannot inherit acceptance from old screenshots or offline tests.

## Connect and make a copy

1. Install/load the matching plugin and open PS-AI from Photoshop Plugins; the Portable entry is **PS-AI (Portable)**.
2. Open **Settings → Backend and models** and choose ComfyUI, Nano Banana, GPT Image, BaiLian or Manual gateway. Cloud adapters require their API key, Node.js 24+ for the local relay, and the setup described in [platform setup](../setup/PLATFORMS.en.md); live cloud output remains unvalidated.
3. For ComfyUI, start the backend and verify its browser page, enter an origin such as `http://localhost:8188`, then scan/select the compatible Qwen 2.1 model, encoder and VAE. Save settings and connect. Omit credentials, paths and query parameters; renaming another architecture cannot make it compatible.
4. The setup wizard can test the address and environment. Its final Generate example action explicitly runs inference and applies a result to a separate test document.
5. Return to **Create** and choose a mode before preparing a saved source copy. Ordinary edits/removal/clothing select the area to change; character reference additionally needs an imported image. Background/scene select the subject to keep; blending selects the foreground subject. Removal has no prompt, and blending’s supplementary description is optional.
6. Relighting uses the workbench with Current selection or Entire image. Image-context assets need a placement selection; explicitly text-only assets and text-to-image need no source selection. Preview the actual range, generate deliberately, inspect Results, apply/export, and recover an interrupted job through History using its original ID.

Language and output depth save on change; use Save settings for the address and models. Export / import JSON to move settings, without model weights or image history. CCX and Portable keep separate data.

Use a source with the correct ICC profile. RGB / Grayscale 8/16-bit needs a resolved color space; unresolved untagged sources are blocked. The original-file/working-copy exception is described below. Prepare RGB copies of CMYK, Lab, Indexed, Bitmap, Multichannel and 32-bit HDR files. In the historical tests, the source WebP was 8-bit; test copies were converted to **RGB / 16-bit, sRGB IEC61966-2.1**. Conversion does not restore missing detail.

<a id="source-color"></a>

**Saved source color in the current build:** an existing document ICC, including Adobe RGB, keeps its current interpretation and needs no original-file picker. An untagged RGB image with a bound original file needs authorization to read that exact file. Choose the original being edited, such as `3F3F3F.webp`, when prompted. The plugin checks its path, dimensions and depth, then reads color declarations: static WebP without ICC uses the format's sRGB default; PNG needs an explicit sRGB chunk. Successful resolution opens an unmerged, tagged sRGB working copy. The preview states the rule used, and generation and Apply as new layer target that copy. The original is untouched and unsaved layers are retained. Untagged edits also receive the original-file color interpretation; check their appearance if they were edited under a different working space. Saved protection coordinates carry over; continue selecting and generating in the working copy.

Authorized file entries are reused for the current plugin session. **Advanced parameters → Remember original-file access** is off by default. Enable it to save up to 32 exact-file access tokens in private plugin storage; enabling it also remembers files already authorized in this session when supported. These grants and the preference are excluded from portable settings, task history and diagnostic exports. They contain no cached pixels or color conclusions: every use reads bounded current bytes and inspects their declarations again. A replaced file cannot reuse an earlier sRGB conclusion. Revoked, moved or unreadable access can open one replacement picker; select the original again. Missing host token APIs or unavailable private storage do not prevent the current authorized read. Check the access status for recovery instructions.

Disabling remembering removes saved grants while retaining session access. **Clear original-file access** also drops session entries; later reads may need the picker again. If private storage cannot be updated, the panel reports that removal failed and retains useful session access; check storage and retry Clear before assuming saved grants are gone. Tagged working copies keep their valid ICC and do not need their original file to be reopened. Exact-file session reuse was observed in this iteration's limited installed flow; complete host flows for remembering, clearing and revoked access remain pending.

Canceling, choosing a different file, exceeding 64 MB, an unverifiable original file or unknown color stops capture before uploading that area. Confirm the true color space, use Edit → Assign Profile on a copy and capture again. Photoshop 27 read this WebP and verified working-copy capture, identity apply (zero pixel difference), single undo and cleanup on a disposable untagged duplicate, with the original unchanged. Installed 0.5.0 b3548bd4 also passed the real original-file picker and document-scope capture on a public PNG8. Native API checks at revision 4f18ca2 independently guard original/copy selection state: even with no selection on the color copy, selection and document scopes returned full-mask SHA256 values identical to the original native plane. Installed 291c1d40 follow-up passed missing-selection rejection, the real original-file picker and selection capture, with the correct source and key light in the workbench. Reference import and broader interactions remain separate checks. Published v0.4.0 still needs a tagged copy as described above.

The working copy’s sRGB assignment is a separate history baseline. After repeated undo reaches the state before assignment, Create recovered color copy and reread is offered only when this plugin session can prove the copy’s origin and exact history state. It creates a new tagged copy while preserving the old document and its redo history, then rereads current pixels, selection and protection. Old candidates retain their old snapshots. A failed read can retry the same new copy without duplicating it; clearing or changing protection affects the retry. A valid current ICC takes priority without original-file access. Unknown, earlier-session or arbitrary pathless untagged documents still require a verified manual profile assignment. PS27 RGB8/16 synthetic API checks passed repeated undo, recovery, preservation and one apply/undo. In the installed b3548bd4 public PNG8 document-scope case, three Photoshop Undo operations reached NONE and exposed the actual recovery action. Explicit recovery created and captured a new sRGB copy while retaining the old document, edited key light and two old candidates; no old candidate was selected or enabled for application to the new source. This is limited installed-flow evidence; other sources/scopes and color recovery on later builds still need retesting.

After Undo, an explicit NONE profile type remains untagged even if its display name still says sRGB; that name alone never authorizes capture or recovery. For a working copy already proven in this plugin session, however, a residual display name no longer prevents explicit recovery when its history, layers and document state still match. After a plugin restart, documents without that session proof still require a verified manual profile assignment.

<a id="context-assets"></a>

## Assets using the image and selection (0.5.0)

New Effect / Atmosphere asset tasks default to Reference current image and selection. Select where the asset belongs, optionally define protection, then preview the actual inputs: the left image is the sRGB8 source sent to the model; the right is the effective grayscale range after protection. White permits placement, black excludes it and gray retains feathering. The current visible composite and guide share the same crop and scale; native source, selection and protection are saved separately. This required guide is sent regardless of the ordinary optional-guide switch.

Input and destination are independent. New document still sends the current image and selection. Only explicitly choosing Text-only independent asset avoids reading the image and offers PNG export or a new document. Old unmarked tasks keep their saved meaning; reusing their parameters explicitly selects text-only and never adds uploads or resubmits them. Imported character/style references are not used for assets. Unsupported model combinations fail before upload; explicitly choose text-only or a supported model.

Selection application uses the saved native coordinates and effective gray mask once. The asset retains its own alpha without multiplying source alpha, subject alignment or ordinary edit color matching. Large areas use a budgeted working raster and native-size strip application. Apply reloads that UUID’s source and masks and checks depth and history. Changed or closed sources retain export; browsing history cannot bypass source checks. Fully opaque outputs can be saved for inspection but cannot be applied.

Six PS27 synthetic API cases passed native RGB8/16 asset capture, grayscale selection/protection, alpha and single feathering, application and undo/rollback. Small cases were 64×48; large cases were 4096×4097 RGB8 and 4096×3072 RGB16, using bounded working rasters and native-size strips. Outside/protected visible color and alpha were unchanged, including recovery after cancellation during partial writing; hidden RGB under zero alpha is outside this evidence. These used synthetic assets and in-memory task records, not installed asset controls, disk durability or real-model quality acceptance.

Installed 0.5.0 291c1d40 separately passed a small RGB8 asset flow. A rectangular selection defaulted to image-and-selection input, showing an actual 353×273 source crop/effective gray guide and 1120×864 model canvas. One explicit generation sent two uploads/one POST to the controlled backend; a transparent blue-wave fixture applied as an independent layer with an editable mask. One Photoshop Undo removed it, then reading the same UUID from disk History and applying again succeeded without another upload or POST. The original document remained and no duplicate was submitted. This is installed small-RGB8/disk-History evidence, not installed large/RGB16, restart durability or real upstream quality acceptance.

**This iteration’s five real ComfyUI samples failed visual checks.** The source and guide were sent for hand arcs, portrait smoke, perspective beams and feathered face protection. Outputs retained source people/environments or painted guide boundaries. One separate prompt comparison still retained source content. Transparent pixels alone do not establish a usable independent asset: inspect against light and dark backgrounds for source and guide residue. Platform request structures have offline coverage, but real platform output remains untested without API keys. Failures retain the original task and raw output; recovery queries the original UUID without automatically generating again.

## Generation settings

Start with one candidate and 8-bit (compatible) to check the flow. Choose resolution, steps and seed for the task. The captures show configuration entries, not an effect comparison for a particular parameter set. Edit candidates follow the captured crop’s aspect ratio and need not be square.

For 16-bit SDR output, install the optional `PS_AISavePNG16` and restart the backend as described in the [ComfyUI guide](../setup/COMFYUI.en.md). Model input remains sRGB8; web screenshots cannot demonstrate 16-bit precision.

## Shared selection-edit steps

In the current panel, undoing to an earlier Photoshop state may also remove the selection. Make a new selection and use **Preview selection**, or explicitly choose **Restore last selection and reread** in the original mode. The latter replaces the Photoshop selection with this plugin session's most recent successfully captured range, preserving its normalized 8-bit grayscale feathering and coordinates. For background/scene modes it restores the subject to keep. It is available only for the same source document, dimensions, native mode/depth and panel mode; reloads and earlier sessions require a new selection. It restores only the range, then reads current pixels and current color information, applies current protection once, and shows a new preview. Inspect it before choosing **Generate**; restoration never submits a job or authorizes an old candidate against changed document history. If rereading fails, the restored selection remains available and stale source pixels are discarded.

**Settings → Build** shows the version and short source revision; `-dirty` identifies a build containing uncommitted changes, and an unbuilt source run says `dev (unbuilt)`. The identifier also appears in copyable error details, helping distinguish builds with the same version. Selection restoration and these controls have offline regression coverage; installed Photoshop behavior and undo still require native acceptance.

Select an area and use Preview selection: **amber is editable, blue is manually protected and gray supplies context**. Submission captures again. To protect a face or hand, select it, Protect selection, then select the edit area. Set protection again after changing documents or restoring parameters.

Generate, wait, inspect thumbnails and View at 100%, then Apply as new layer. The result has an editable mask and preserves the source layer. The new mode captures show entry points; confirm the actual range with Preview selection in your own document.

<a id="background-fix"></a>

**Background replacement in the current build:** select the subject to keep in both Local edit → Replace background and Portrait → Replace scene; do not invert the selection. The plugin captures the whole canvas and uses the subject selection and source alpha to determine the background range, including transparent canvas areas and translucent edges. Preview the range and check the opaque subject core and manual protection. Both modes automatically disable source-transparency preservation, alignment and color matching. ComfyUI also disables the visual selection guide, which the model can mistake for picture content. Only model input is matted over white; saved source pixels and original layers remain intact. Ordinary preferences return when leaving these modes. Platform adapters retain their provider / native mask path.

Subject selection and RGBA application are later changes with offline regression coverage only. The native evidence below used the earlier background-selection flow and does not validate the new flow. Loading old candidates retains their saved masks and color-matching settings. When reusing parameters to generate a new background, select the subject again; color matching is automatically disabled for the new task.

Candidates with substantial transparency in the background show a warning and cannot be applied. Export them for inspection and generate another candidate manually; there is no automatic retry. On 2026-10-18, the original Chinese request “少女站在舞台上” produced visible stage lighting, scenery and a floor on this sample. Application to an RGB8 / Adobe RGB copy in Photoshop 27 left pixels outside the selection, additional protection and the source layer unchanged; one undo restored the composite exactly. Other prompts may need more detail about the environment. The capture below shows the current configuration entry; new host controls and 16-bit background inference still need separate acceptance. Historical v0.4.0 packages do not contain this correction.

## Mode index

| Edits and removal | Clothing, reference and scenes | Assets and text to image |
| --- | --- | --- |
| [01 · Objects and materials](#edit) | [04 · Clothing and props](#costume) | [07 · Effect](#effect) |
| [02 · Remove](#remove) | [05 · Character reference](#reference) | [08 · Atmosphere](#atmosphere) |
| [03 · Background](#background) | [06 · Scene](#scene) | [09 · Text to image](#generate) |

0.5.0 modes: [10 · Relighting](#relight) · [11 · Image Blending](#blend).

Each section shows the current mode entry and subsequent steps. These captures submit no generation; click an image for its original file.

<a id="edit"></a>

## 01 · Objects and materials (0.5.0)

Open **Local edit → Objects and materials**.

1. Select the object or material on a source copy. Protect faces, hands or text separately when needed.
2. Describe the change, for example “Make the selected metal ornament matte silver while retaining its shape and texture.” This is a writing example, not a prompt validated by new inference in this round.
3. Preview selection, inspect the editable range and explicitly generate. Check details in Results before applying as a new layer or exporting.

![0.5.0 Objects and materials configuration entry before generation, Chinese UI](../../assets/guide/050-mode-edit-zh.png)

<a id="remove"></a>

## 02 · Remove objects (0.5.0)

Open **Local edit → Remove objects**.

1. Select the object to remove and retain some surrounding context for reconstruction. Avoid selecting the whole person or background.
2. This mode uses a built-in removal instruction and has no prompt field. Add protection if needed and preview the selection.
3. Generate, inspect reconstruction and edges, then apply or export. An unsatisfactory output never triggers automatic resubmission.

![0.5.0 Remove objects configuration entry before generation, Chinese UI](../../assets/guide/050-mode-remove-zh.png)

<a id="background"></a>

## 03 · Replace background (0.5.0)

Open **Local edit → Replace background (select subject)**.

1. Select the subject to keep without inverting. The plugin captures the full canvas and uses the subject selection and source alpha to determine the background range.
2. Describe the new set, floor and lighting, for example “A lavender studio, soft side light and a simple floor.”
3. Preview subject preservation, translucent edges and protection before generating. Substantially transparent backgrounds cannot apply but remain exportable; see the [background limits](#background-fix).

![0.5.0 Replace background configuration entry before generation, Chinese UI](../../assets/guide/050-mode-background-zh.png)

<a id="costume"></a>

## 04 · Clothing and props (0.5.0)

Open **Portrait → Clothing and props**.

1. Select the clothing or prop to change, avoid unchanged faces and hands, and add protection where needed.
2. Describe the garment part, color, material and details to retain, for example “Make the selected coat tail deep violet while retaining folds and metal ornaments.”
3. Preview the range, generate and inspect. Exact clothing or complex-prop reconstruction is not guaranteed; export for manual refinement when needed.

![0.5.0 Clothing and props configuration entry before generation, Chinese UI](../../assets/guide/050-mode-costume-zh.png)

<a id="reference"></a>

## 05 · Character reference (0.5.0)

Open **Portrait → Character reference**.

1. Prepare a source copy and select the editable area. Expand the reference section and choose one image you have permission to use.
2. Describe the clothing, accessories or appearance to take from the reference. Reference input does not guarantee identity, texture or detail transfer.
3. Check the imported preview, range and protection before generating. The capture below shows the entry before reference import; complete native reference-import acceptance remains pending.

References are converted to sRGB8 for the model. Confirm unknown color declarations and embed the correct ICC on a copy. Explicit sRGB PNG and static WebP default sRGB can be recognized; an extension alone never proves an arbitrary image’s color space.

![0.5.0 Character reference configuration entry before generation, Chinese UI](../../assets/guide/050-mode-reference-zh.png)

<a id="scene"></a>

## 06 · Replace scene (0.5.0)

Open **Portrait → Replace scene**.

1. Select the subject to keep without inverting; the entire canvas supplies the environment.
2. Describe the scene, time, floor and light direction. Subject preservation and protection follow the background mode.
3. Preview before generating. ComfyUI omits the black-and-white visual guide; application uses the saved actual mask. Do not import a range guide as a scene reference.

![0.5.0 Replace scene configuration entry before generation, Chinese UI](../../assets/guide/050-mode-scene-zh.png)

<a id="effect"></a>

## 07 · Effect asset (0.5.0)

Open **Portrait → Effect asset**.

1. Image-and-selection input is the default. Select the intended asset location on a source copy, add protection and preview the source/effective grayscale range.
2. Describe the shape, direction and colors, for example “A curved blue light trail beside the hand.” Explicitly choose Text-only independent asset for text-only input.
3. Inspect alpha, source residue and range boundaries in the raw output. Only suitable transparent assets can apply; fully opaque output remains inspectable/exportable. Real Qwen image-context asset samples failed visual acceptance; see the [asset limits](#context-assets).

![0.5.0 Effect asset configuration entry before generation, Chinese UI](../../assets/guide/050-mode-effect-zh.png)

<a id="atmosphere"></a>

## 08 · Atmosphere asset (0.5.0)

Open **Portrait → Atmosphere asset**.

1. Choose Image and selection or Text-only independent asset for the task. Choosing New document as a destination does not change the input type.
2. For image input, select the placement range, inspect the effective grayscale range/protection and describe smoke, particles or haze.
3. Inspect transparency and retained people, environments or guide boundaries. Keep raw output for inspection; transparent pixels alone do not establish a useful asset.

![0.5.0 Atmosphere asset configuration entry before generation, Chinese UI](../../assets/guide/050-mode-atmosphere-zh.png)

<a id="generate"></a>

## 09 · Text to image (0.5.0)

Open **Generate → Text to image**.

1. Describe subject, environment, composition and style. A source editing selection is not required.
2. Optionally choose one reference and its role, then set candidate count, resolution and output depth. Use 8-bit (compatible) without the optional PNG16 save node.
3. Explicitly generate candidates, inspect Results, then export PNG or view in a new document. Generation does not automatically write into the current source.

![0.5.0 Text to image configuration entry before generation, Chinese UI](../../assets/guide/050-mode-generate-zh.png)

<a id="relight"></a>

## 10 · Relighting (0.5.0)

Intensity, temperature, range, depth, softness, cone angle, direction, elevation, ambient and shadow parameters have horizontal sliders with precise numeric inputs. One continuous drag is one workbench undo; Esc cancels the current gesture. Keyboard and numeric edits stay synchronized, and light type/color mode controls parameter visibility. Dragging updates only the local illustration, without capture, submission or per-event draft writes.

Previously recorded PS27 RGB8/16 synthetic API checks passed actual field extraction, native Shadow/Light groups, grayscale masks and protection, source preservation, one undo and failure rollback. Native-versus-preview maxima were 1/255 and 3/65535. The original failed task was read offline by its existing UUID; failures distinguish structural mismatch from unsupported boundaries and retain raw-reference export. These checks do not establish real-photo detail fidelity, every lighting channel or the complete installed-panel workflow. Final lighting visual acceptance belongs to the user.

Installed 0.5.0 b3548bd4 passed a limited PS27 flow with a public PNG8 and controlled local-response backend: one generation made one POST/two uploads; lighting-group application and one Photoshop Undo succeeded; reading the same UUID from History and applying again added no POST. The then-current exclusion/reread control retained lights and old candidates; that control is retired. The current **Re-read current document** action includes the visible result and needs no separate binding action. In the historical check, a failed reference remained inspection-only with Apply blocked. An intensity drag from 1 to 3.2 returned to 1 with one workbench Undo and no POST during editing; the output picker contained only Lighting layers and Full-image redraw. This backend performed no upstream inference. These are actual installed interaction checks, not model quality, all controls or final-revision installation acceptance.

Relighting uses a separate large lighting workbench. Original, local illustration and AI result are distinct views. **The illustration expresses lighting intent; inspect the prepared result before applying it.** Lighting layers derive fields from the model reference; Full-image redraw uses the model image itself. Models receive semantic lighting instructions, without a guarantee of precise multi-light control, physical shadows or material simulation.

1. Work in a saved copy and set protection for details that must remain unchanged. Choose **Portrait → Relighting → Lighting scope**: **Current selection** is the default and requires an edit selection; **Entire image** explicitly edits the full canvas minus protection without changing Photoshop's selection. Include the receiving ground in the selected scope if its shadows should change. Capture reads the visible composite; surrounding context alone never expands the editable mask.
2. Open the workbench and check the actual source name/document ID, scope, profile and original image. A tagged sRGB working copy is labeled with its original document ID. Missing selections are reported before original-file authorization. The main panel's Generate entry also opens this editor; editing lights makes no AI request.
3. Add, select or drag lights. Select a light in the list, then use the sidebar to rename, duplicate, disable, delete or lock it; use Find to locate off-image lights. The limit is eight. Hiding markers does not disable lights. Zoom, pan and fit affect only the view. Workbench undo/redo treats one drag as one action and preserves text-editing shortcuts inside inputs.
4. Choose point, spot or directional, independently of key/fill/rim/custom role. Intensity and Z are relative intentions. Choose either temperature or custom color. Expand advanced light controls for softness and the applicable depth, spot target/cone or directional bearing. Global lighting contains ambient, existing-light handling, shadows and content-preservation intent.
5. Inspect approximate range and color in **Lighting illustration**, then add an optional description. New sessions default to **Lighting layers**; choose **Full-image redraw** explicitly if needed, then reread the source when prompted. Resolve obvious conflicts or acknowledge them explicitly before submission. Only the workbench's **Generate AI result** button freezes the scene and submits one model request. The primary image is the clean bounded source, without markers, handles or local light patches.
6. Editing can continue during generation. A result from an earlier configuration is marked stale. Cancellation follows the backend's capabilities; a platform request already in progress may still finish and be billed. Changed sources require rereading, not silent rebinding.
7. Inspect the prepared result for identity, text/logos, fabric texture, edges, highlights and shadows. Lighting layers apply as a group containing a native source base and the supported Shadow, Cast Shadow, Color Atmosphere, Light and Rim Light channels; unobserved channels are omitted. Channels have editable masks, and the group carries the actual selection-minus-protection mask. Full-image redraw and old complete-result tasks use a NORMAL image layer with an editable mask. Original layers stay intact; adjust group/layer opacity or undo once. Reapplying a candidate from the same capture replaces only the plugin's own output.

The workbench briefly closes for recapture or document writes, then returns; PS27 does not support the required writes inside its open dialog. Network waits hold no document modification lock. Configurations are saved locally. Opening from the main panel while idle reads the current canvas; Re-read current document updates it again. If this panel entry cannot capture the source, the workbench stays closed and shows the specific error. Create a missing selection, or explicitly choose Entire image, before opening again. Lights and candidates remain retained. A failed reread from an already open workbench can still show the old content, marked stale and unavailable for a current-source submission. Internal dialog reopening after generation or application retains that task's frozen context without an extra capture. A successful fresh read clears old read errors for that source. Closing the workbench stops source observation and preview work, not an already submitted task.

Structured relighting disables subject alignment and context color matching so they do not cancel intentional lighting changes; ordinary preferences return when leaving. Lighting layers require opaque editable pixels and tagged sRGB RGB8/16; native application rechecks opacity and rolls back unsupported pixels. Explicit Full-image redraw keeps the existing safe transparency strategy: unsafe multilayer translucent sources need a merged copy or manual composition after export. Native 16-bit source data is retained separately, but model input remains sRGB8. Platforms output sRGB8; ComfyUI optionally saves SDR16, which is not native 16-bit model precision or a lossless round trip.

To change scope, close the workbench, choose the new Lighting scope in the main panel and reopen. The workbench reads the active document and chosen scope while retaining edited lights, without a second binding action. Generation remains blocked until capture succeeds; failure keeps the old source/edits with an explicit stale reason. Draft/history reuse uses the current explicitly chosen source and scope without resubmitting historical jobs. The earlier limited installed flow above does not establish this current-canvas change; its regression, native and installed evidence is recorded separately.

The workbench offers exactly Full-image redraw and Lighting layers. The former compensation experiment and its diagnostics have been removed. Lighting fields remain estimates rather than independent physical channels. Failed extraction retains the reference for inspection/export and never switches silently to Full-image redraw or creates an empty group.

Current configuration captures do not replace complete workbench acceptance. Earlier source modules passed light interaction, resizing and 4K eight-light preview checks in a PS27 script; those timings describe the prior preview implementation. On 2026-10-19 local time, separate synthetic PS27 API checks verified source preservation, hiding the group and one undo for 1024×300 sRGB8/16, plus 9000×5000 RGB8 analysis capture, strip writing and one undo. A follow-up with a feathered mask kept protected pixels unchanged; native versus local-preview maximum differences were 2/255 and 3/65535. These checks did not test real-photo lighting quality, new inference, 45MP RGB16 or the installed panel. Portrait, product-text, fabric, source-sync interactions and the full host workflow still need acceptance. See the [development contract](../development/BACKEND.en.md#relighting-workbench) for implementation and measurement conditions.

<a id="blend"></a>

## 11 · Image Blending (0.5.0)

![0.5.0 Image Blending configuration entry before generation, Chinese UI](../../assets/guide/050-mode-blend-zh.png)

Image Blending adapts a subject already placed in a scene to its surroundings. It reads the whole visible composition and uses lighting, color temperature, contrast, texture and depth of field outside the subject as context. Only the selected subject and its edges are edited, minus manual protection.

1. Prepare the subject and background in a saved copy, then select the subject. Do not select the entire canvas; a cutout on transparency has no environment to match.
2. Choose **Portrait → Image Blending** and preview the range. Areas outside the subject supply context. Protect subject details separately if needed.
3. Generate directly or add an optional instruction, such as “Match the warm window light from the left; preserve facial structure and clothing texture.” A second background reference image is unnecessary.
4. Inspect identity, pose, hair edges, lighting, grain and perspective, then apply as a masked layer. Adjust opacity or undo once as needed.

New ComfyUI blending tasks send the current composition and any optional character reference without a grayscale range guide. Qwen encodes that guide as an ordinary reference image, which can interfere with lighting changes. Selection, feathering and protection remain saved in full; Photoshop's native-size mask precisely limits application. Platform backends retain their own guide/native-mask paths. Switching modes or backends restores the ordinary guide preference. Old candidates keep their saved tasks and are never automatically regenerated.

The revised built-in instruction applies to every backend and asks the model to match exposure, light direction, shadows and reflected environment colors while retaining the illustration or photographic style. Only grayscale-guide omission is specific to ComfyUI. The full canvas supplies context regardless of the margin setting. Model resolution remains limited, so a small subject may lose detail. Alignment and context color matching do not counteract this mode. Results depend on the model and do not guarantee exact identity, linework or texture preservation. This is not skin retouching.

Two real inference comparisons on 2026-10-20 reused the existing Qwen 2.1 models, original inputs and fixed seeds. Omitting the guide produced clear lighting changes on the illustration; changes on the photographic portrait remained weak, so portrait blending quality is not resolved by this evidence. Local previews composited through the saved subject mask preserved the outside background. Larger changes do not establish better quality: identity, style, details and edges still need visual acceptance. The portrait preview used a bounded analysis raster. These comparisons do not replace acceptance of the updated installed Photoshop controls, native-size application or color.

A separate installed 0.5.0 d2966347 Portable check in Photoshop 27 used a small synthetic RGB8 document. Blending disabled the guide and restored ordinary preferences on exit. Full-canvas preview succeeded; one generation sent one source upload and one POST to an isolated controlled backend, with no guide or duplicate submission. Actual application created a masked layer while preserving the original layer, outside pixels and alpha. One Photoshop Undo exactly restored the source composite and history baseline. This verifies installed interaction on a 64x48 source, not real inference quality, exact feather weights, protection, large images, 16-bit or platforms.

## Candidates, progress and undo

- **Progress:** loading and text encoding show stages; sampling shows actual steps and percentages, followed by a saved-candidate message. Encoding can take time; avoid repeated submissions.
- **Candidates:** 1–4 run sequentially, incrementing a locked seed. Switch thumbnails or use the list. Candidate numbers locate saved results; they do not indicate generation acceptance during this configuration capture round.
- **Apply:** the first application creates a masked layer. Another candidate from the same capture replaces it. Changes to source dimensions, content or session block stale application.
- **Undo:** Ctrl+Z undoes one application. Opacity has separate undo records; the panel slider does not track native undo.
- **Export:** Save PNG exports the processed candidate at context dimensions. Ordinary edits may use a crop; blending and background modes use the full canvas as context. Open as new document uses an independent sRGB document. Preview is 8-bit; export keeps the chosen depth.
- **History:** click a record on the left to view its details and local preview on the right. Load candidate opens it in Results; Reuse parameters restores its text and settings. Prepare references, protection and selection again. After a restart, old results can be exported or opened separately, but cannot directly apply to a reopened source.
- **Cancel / reconnect:** during generation or recovery, cancel targets the active task and stops later candidates, keeping completed results. When idle, cancel and Recover task target the selected History record. Recovery queries its original ID without resubmitting; switch Settings to the saved backend type and address when instructed.

The current build keeps an unresolved-task count and **Handle pending tasks** shortcut visible across navigation and connection messages. Startup and a blocked generation select the actual unresolved record, even when a newer candidate is ready. History shows the complete copyable UUID, state, saved backend, date, source document ID and source name when saved. Use **Next unresolved task** to inspect multiple records. Selection is locked during a task action. Fifteen consecutive unknown replies or failed status queries end the local wait with `unknown` and retain the ID; a valid queued/running reply resets that count. This does not establish a remote failure or cancellation. Retry **Recover task** using the original ID.

History has a **list on the left and details with a preview on the right**. Each record shows its date, task type, literal prompt summary and state; details include the full prompt, UUID, source and saved backend. Removal identifies its built-in instruction, and old records with missing parameters or prompts say so. The two panes scroll separately and stack in a narrow panel. Preview reads and validates local files without changing Results or contacting a backend; missing candidates or damaged files show an explanation.

**All** / **Unresolved** show counts; **Previous** / **Next** limit each page to 20 records. Click a record to focus its details. Checkboxes select one or more records for clearing, with a separate selection count. **Select all** includes every page in the current filter. Paging preserves checked records; changing the filter clears them. **Refresh** rereads local history only. Pending-task shortcuts reveal the intended UUID and page together with its details and actions. A completed recovery keeps that row focused, switching to All if its terminal state leaves the Unresolved filter. Task actions lock selection, paging, refresh and clearing. The new layout, scrolling and keyboard behavior have offline coverage only; native Photoshop acceptance remains pending.

**Clear checked history** shows a count and impact notice before you click **Confirm clearing these records**. It removes checked local records and their plugin-owned source, mask and candidate files, and evicts their in-memory candidates. Original Photoshop documents, applied layers, exported images, settings, original-file access grants and lighting drafts remain. While idle, this can also clear unrecoverable legacy queued, running, cancelling or unknown records and remove their local generation block. **It does not cancel remote jobs, guarantee billing stops, or delete backend data.** These records will no longer be available for recovery through History. Other unresolved records still block generation; starting a new task remains a separate action.

An interrupted cleanup does not make confirmed cleared records reappear as generation blockers after restart. Use **Retry local cleanup** for pending file or history-metadata work. Files still referenced by other records are retained; nonstandard filenames whose ownership cannot be established are skipped and reported. Cleanup never follows arbitrary paths or deletes directories. Check the cleanup status before treating the operation as fully complete.

For an `unknown` record only, **Stop tracking locally** opens a warning for that UUID; **I understand; stop tracking this ID** is the separate confirmation. This removes only that record from the local generation guard. It does **not** cancel the remote request, stop billing, prove failure or delete any history, source or result. A new generation is a separate deliberate action and may duplicate work and charges. The record stays `unknown`, marked as locally detached. Selecting it and choosing **Recover task** resumes tracking and queries the original ID at its saved backend. Changing the selection, refreshing history or retrying clears the confirmation; queued/running records cannot be detached. Other unresolved records still block generation.

The lighting workbench offers **Handle pending tasks** to close the dialog and open the selected unresolved record in History. Edited lighting and the frozen source remain available when reopening. These recovery controls have offline mock coverage; native Photoshop acceptance remains pending.

## Parameters and color

![0.5.0 advanced parameter controls, Chinese UI configuration example](../../assets/guide/050-advanced-zh.png)

| Control | Use |
| --- | --- |
| Resolution | 768, 992 or 1024; edits retain aspect ratio and align to workflow dimensions. |
| Steps | Default 25, range 1–100; higher is not necessarily better. |
| Context margin | Default 15%; surrounding context is not made editable. In 0.5.0, blending, background and scene modes always read the full canvas. |
| Selection guide | Visual guidance. The final Photoshop mask enforces protection. Off by default for reference assistance; disabled for ComfyUI background / scene / blending modes. |
| Preserve transparency | Useful for clothing / materials; disabled for background / scene modes in 0.5.0. Turn off for removal or silhouette expansion too. |
| Subject alignment | Uses alpha bounds to adjust size and position; can change proportions. Automatically disabled for background / scene / blending modes in 0.5.0. |
| Color matching | Limited overall correction; inspect actual output to decide whether to enable it. Automatically disabled for background / scene / blending modes in 0.5.0; ordinary preferences return on exit. Old background candidates retain their saved setting. |

16-bit output can be exported as PNG16, opened as RGB16 or applied to a 16-bit document. Applying to an 8-bit source quantizes to 8-bit without changing its depth. Model inputs, references and masks remain 8-bit. Higher-depth output reduces later quantization; it does not imply full 16-bit model precision, HDR or native wide-gamut generation. Finish color and lighting in Photoshop as needed.

## Troubleshooting and limits

| Symptom | Action |
| --- | --- |
| No selection / fully protected edit | Select again, inspect the range preview and clear unwanted protection. Relighting also offers an explicit Entire image scope; after a scope change, re-read the source. |
| Reference fails color checks | Confirm and embed the correct ICC on a copy; see Character reference. |
| Background becomes black or transparent | Generate again using either background mode in the current build; see the [background correction](#background-fix). Select the subject to keep and describe scenery, lighting and the floor if needed. Loading an old candidate does not regenerate it. Do not import a black-and-white mask as a scene reference. |
| White background | Preserve the outline for materials, disable for backgrounds. Inspect source fringe and alpha; standalone assets may need cleanup. |
| Result too small or unfilled | Check selection, context and aspect ratio; try alignment off. In current background modes, select the subject and preview the full-canvas range. Do not bypass size checks by changing workflow dimensions. |
| Source changed; application blocked | Capture and generate again, or export the old result for manual composition. |
| Unsafe semi-transparent multilayer source | Save a copy and merge visible layers before generating, or export and composite manually. |
| Backend, model or depth error | Check service, mappings and optional node. Open technical details, correct and retry. |
| Photoshop exits entirely | Save work, record the stage and examine events / dumps alongside host, GPU, driver and plugin behavior. A successful session is not a permanent crash fix. |

Host diagnostics check selection, protection, masks, undo and rollback in their own documents. Save report exports the result. Runtime logs record plugin stages, not Photoshop crash dumps.

A historical check on 2026-10-17 used Windows Photoshop 27.0, GPU enabled and this sample: all nine modes generated actual outputs; six edits applied to copies; effects, atmosphere and text-to-image opened as 16-bit documents, with the first two additionally composited onto the sample. Source layers in all eight edit / composition copies remain channel-for-channel identical. Visible pixels and alpha outside all six edit masks are unchanged, as is full-canvas alpha in the three preserve-transparency examples. Invisible RGB beneath fully transparent pixels is excluded from appearance comparisons; source layers themselves were checked channel by channel.

Acceptance is limited to these examples. Clothing tested a coat tail; reference tested socks transfer. Complex prop reconstruction, identity consistency, other models, calibrated-display accuracy and long-term stability remain unverified. Photoshop did not exit during this session; that is not a permanent stability guarantee. Reference, effect and atmosphere modes remain experimental. Routine skin retouching is outside scope.

Use a trusted backend. Local ComfyUI also stores inputs and outputs. Check privacy and image permissions before sharing screenshots. Code licensing does not replace model or image licensing; see [compatibility and model sources](../../config/compatibility.json).
