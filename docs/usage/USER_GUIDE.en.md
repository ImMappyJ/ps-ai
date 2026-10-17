<p align="center"><img src="../../assets/brand/avatar.png" width="64" alt="PS-AI"></p>
<h1 align="center">Using PS-AI</h1>
<p align="center"><a href="USER_GUIDE.md">简体中文</a> · <strong>English</strong></p>

This walkthrough tests all nine modes on separate copies of **3F3F3F.webp**. Screenshots show the actual Portable panel in Windows Photoshop 27.0. Results were exported from Photoshop composites. Click an image for its original PNG; panel captures retain their native 541-pixel width, without enlargement or reconstructed UI.

**For version 0.4.0 (experimental).** Version 0.3.0 lacks guided setup, range previews and optional 16-bit output. See [installation](../README.en.md#install-a-release-package) and [ComfyUI setup](../setup/COMFYUI.en.md).

The screenshots and nine-mode acceptance use ComfyUI. See [Bailian](../providers/BAILIAN.en.md), [Gemini / Nano Banana](../providers/GEMINI.en.md) and [OpenAI Images](../providers/OPENAI.en.md) for platform setup and limits; their live results and host behavior are not validated by these examples.

The development build renames the old **COSPLAY** tab to **Portrait** and adds relighting as a tenth mode. The nine illustrated examples below remain v0.4.0 evidence. For the four backend choices and key controls, see [platform setup](../setup/PLATFORMS.en.md).

## Connect and make a copy

1. Start ComfyUI and confirm its address opens in a browser.
2. Open PS-AI from Photoshop's Plugins menu. The Portable entry is **PS-AI (Portable)**.
3. Expand Backend and models. Enter an origin such as `http://localhost:8188`. Custom hosts and ports are supported; omit credentials, paths and query parameters.
4. Scan models, select the matching Qwen 2.1 diffusion model, vision / text encoder and VAE, then Save settings and Connect. Other architectures cannot be used by renaming files.
5. The first-time wizard can test the address, check the environment and run a generation example. The last step generates and applies in its own test document.
6. Open the sample and save a PSD copy. Start each example from a fresh copy.

Language and output depth save on change; use Save settings for the address and models. Export / import JSON to move settings, without model weights or image history. CCX and Portable keep separate data.

Use a source with the correct ICC profile. Tagged RGB / Grayscale 8/16-bit is supported; untagged sources are blocked. Prepare RGB copies of CMYK, Lab, Indexed, Bitmap, Multichannel and 32-bit HDR files. The source WebP is 8-bit; test copies were converted to **RGB / 16-bit, sRGB IEC61966-2.1**. Conversion does not restore missing detail.

## Shared test settings

**One candidate, resolution 992, 25 steps, locked seed 42, 15% context margin, color matching off and 16-bit SDR output.** Models: the compatibility list's Qwen 2.1 Q4_K_M, Qwen3-VL INT8 and Qwen 2.1 VAE. Edit candidates follow the captured aspect ratio. [Recipes JSON](../../assets/guide/recipes.json) records exact Chinese prompts, switches and dimensions. English prompts below are translations for readability; they were not independently tested.

Without the optional save node, keep **8-bit (compatible)**. For 16-bit SDR, install `PS_AISavePNG16` and restart ComfyUI as described in the [backend guide](../setup/COMFYUI.en.md). Web previews are 8-bit and cannot demonstrate 16-bit precision.

## Shared selection-edit steps

Select an area and use Preview selection: **amber is editable, blue is manually protected and gray supplies context**. Submission captures again. To protect a face or hand, select it, Protect selection, then select the edit area. Set protection again after changing documents or restoring parameters.

Generate candidates, wait, inspect thumbnails and View at 100%, then Apply as new layer. The result has an editable mask and preserves the source layer. Orange illustrations below are maps made from the actual selection masks; UI captures are shown separately. Comparisons show the original on the left and result on the right.

## Mode index

| Edits and removal | Clothing, reference and scenes | Assets and text to image |
| --- | --- | --- |
| [01 · Objects and materials](#edit) | [04 · Clothing and props](#costume) | [07 · Effect](#effect) |
| [02 · Remove](#remove) | [05 · Character reference](#reference) | [08 · Atmosphere](#atmosphere) |
| [03 · Background](#background) | [06 · Scene](#scene) | [09 · Text to image](#generate) |

Each example starts with the result. Expand **Selection and panel settings** for the setup screenshots. Click any image to inspect the original file.

<a id="edit"></a>

## 01 · Objects and materials

<p align="center">
  <a href="../../assets/guide/01-edit-compare.png"><img src="../../assets/guide/01-edit-compare.png" width="760" alt="Before on the left, white over-the-knee socks on the right"></a>
  <br><sub>Before (left) · White over-the-knee socks (right)</sub>
</p>

1. Duplicate the original. Select both legs from above the knees down to the shoe openings, leaving room for the sock tops.
2. Choose Local edit → Edit objects / materials, with the selection destination. Enter the prompt below.
3. Enable Selection guide, Preserve source transparency and subject alignment. Disable color matching. Preview the selection and generate.
4. Check both sock tops, shoes and pose, then apply. If alignment distorts proportions, turn it off and generate again.

Prompt translation:

> Add white over-the-knee socks to both legs, with the tops above the knees. Keep the leg pose, shoes, existing clothes and transparent background.

The test added white over-the-knee socks while preserving the alpha outline and visible pixels outside the edit mask. The 800×1216 candidate maps back to source coordinates; no manual enlargement is needed.

<details>
<summary>Selection and panel settings</summary>

<table>
  <tr>
    <th width="50%" align="center">Editable area</th>
    <th width="50%" align="center">Panel settings</th>
  </tr>
  <tr>
    <td align="center" valign="top"><a href="../../assets/guide/01-edit-selection.png"><img src="../../assets/guide/01-edit-selection.png" width="360" alt="Actual selection mask shown in amber"></a></td>
    <td align="center" valign="top"><a href="../../assets/guide/01-edit-panel.png"><img src="../../assets/guide/01-edit-panel.png" width="360" alt="Actual Portable panel: Objects and materials"></a></td>
  </tr>
</table>

</details>

<a id="remove"></a>

## 02 · Remove

<p align="center">
  <a href="../../assets/guide/02-remove-compare.png"><img src="../../assets/guide/02-remove-compare.png" width="560" alt="Before on the left, plush charm removed on the right"></a>
  <br><sub>Before (left) · Plush charm removed (right)</sub>
</p>

1. Duplicate the original. Lasso the black plush charm on the chest, including its head, body, limbs and a little surrounding white fabric.
2. Choose Local edit → Remove objects, with the selection destination. Enter the prompt.
3. Enable the selection guide. Disable transparency preservation, alignment and color matching. Preview and generate.
4. Check for black fragments, continuous fabric folds and the retained chain, then apply.

Prompt translation:

> Remove the black plush charm on the chest, including its head and limbs. Continue the white pleated fabric through that area. Keep the metal chain, pose and other clothing.

The charm was removed and replaced by white fabric, with the chain retained. Complex occlusion may need a second, smaller edit to remove remaining fragments.

<details>
<summary>Selection and panel settings</summary>

<table>
  <tr>
    <th width="50%" align="center">Editable area</th>
    <th width="50%" align="center">Panel settings</th>
  </tr>
  <tr>
    <td align="center" valign="top"><a href="../../assets/guide/02-remove-selection.png"><img src="../../assets/guide/02-remove-selection.png" width="280" alt="Actual selection mask shown in amber"></a></td>
    <td align="center" valign="top"><a href="../../assets/guide/02-remove-panel.png"><img src="../../assets/guide/02-remove-panel.png" width="360" alt="Actual Portable panel: Remove"></a></td>
  </tr>
</table>

</details>

<a id="background"></a>

## 03 · Background

<p align="center">
  <a href="../../assets/guide/03-background-compare.png"><img src="../../assets/guide/03-background-compare.png" width="760" alt="Before on the left, lavender studio background on the right"></a>
  <br><sub>Before (left) · Lavender studio background (right)</sub>
</p>

1. Duplicate the transparent sample. Ctrl-click the character layer thumbnail to load its opacity, then Ctrl+Shift+I to select the background across the entire canvas.
2. Choose Local edit → Replace background, with the selection destination. Enter the prompt.
3. Enable the guide. Disable transparency preservation, alignment and color matching. Preview: the background should be editable and the opaque character excluded.
4. Generate and apply. Check canvas coverage, foot contact, hair edges and shadows. Selecting the character edits the character; a prompt cannot invert a selection.

Prompt translation:

> Replace only the transparent background with a simple pale lavender photography studio. Use softly lit walls and floor, with a slight contact shadow under the feet. Preserve the character, hair, clothes, pose and framing.

The full background became a lavender studio with a foot shadow. Opaque character pixels retain the source. Partially transparent hair blends with the new background; refine the result mask where needed.

<details>
<summary>Selection and panel settings</summary>

<table>
  <tr>
    <th width="50%" align="center">Editable area</th>
    <th width="50%" align="center">Panel settings</th>
  </tr>
  <tr>
    <td align="center" valign="top"><a href="../../assets/guide/03-background-selection.png"><img src="../../assets/guide/03-background-selection.png" width="360" alt="Actual selection mask shown in amber"></a></td>
    <td align="center" valign="top"><a href="../../assets/guide/03-background-panel.png"><img src="../../assets/guide/03-background-panel.png" width="360" alt="Actual Portable panel: Background"></a></td>
  </tr>
</table>

<p align="center">
  <a href="../../assets/guide/03-background-workspace.png"><img src="../../assets/guide/03-background-workspace.png" width="760" alt="Actual Photoshop window"></a>
  <br><sub>Original Photoshop capture; click to inspect.</sub>
</p>

</details>

<a id="costume"></a>

## 04 · Clothing and props

<p align="center">
  <a href="../../assets/guide/04-costume-compare.png"><img src="../../assets/guide/04-costume-compare.png" width="620" alt="Before on the left, deep violet coat tail on the right"></a>
  <br><sub>Before (left) · Deep violet coat tail (right)</sub>
</p>

1. Duplicate the original. Lasso the lower pink coat tail on the right, covering the entire area intended for the material change.
2. Choose Portrait → Repair clothing / props, with the selection destination. Enter the prompt.
3. Enable the guide and transparency preservation. Disable alignment and color matching. Preview and generate.
4. Check diamond cutouts, trim, folds and the alpha outline, then apply. The unselected upper area stays pink; select the whole garment to recolor it all.

Prompt translation:

> Change only the selected right-hand pink coat tail to deep violet velvet. Keep its folds, diamond cutouts, gold trim and outline. Preserve the pose, other clothing and transparent background.

The selected coat tail became deep violet while retaining trim and cutouts. This verifies clothing editing. Props use the same workflow, but complex weapons and mechanical reconstruction were not separately tested here.

<details>
<summary>Selection and panel settings</summary>

<table>
  <tr>
    <th width="50%" align="center">Editable area</th>
    <th width="50%" align="center">Panel settings</th>
  </tr>
  <tr>
    <td align="center" valign="top"><a href="../../assets/guide/04-costume-selection.png"><img src="../../assets/guide/04-costume-selection.png" width="310" alt="Actual selection mask shown in amber"></a></td>
    <td align="center" valign="top"><a href="../../assets/guide/04-costume-panel.png"><img src="../../assets/guide/04-costume-panel.png" width="360" alt="Actual Portable panel: Clothing and props"></a></td>
  </tr>
</table>

</details>

<a id="reference"></a>

## 05 · Character reference

<p align="center">
  <a href="../../assets/guide/05-reference-compare.png"><img src="../../assets/guide/05-reference-compare.png" width="760" alt="Before on the left, white socks from the reference on the right"></a>
  <br><sub>Before (left) · White socks from the reference (right)</sub>
</p>

1. Duplicate the original and select both legs. Use the white-socks edit of the same sample: [download the tested reference](../../assets/guide/reference-white-socks-icc.png).
2. Choose Portrait → Character reference. Open the reference section, Choose image, import the PNG and set Reference use to clothing. Enter the prompt.
3. Leave the selection guide off, the default for this mode. Enable transparency preservation; disable alignment and color matching. Preview and generate.
4. Compare sock tops, color and source pose, then apply. Clear reference afterward; standalone assets and text-to-image also require it cleared.

Prompt translation:

> Use the reference's white over-the-knee socks on both selected legs, with the sock tops above the knees. Keep the source character's leg pose, shoes, clothes and transparent background.

The reference transferred the white-socks feature while preserving pose and shoes. This is clothing-reference assistance, not identity locking, exact replication or multi-view consistency.

**If import reports an untagged image:** PS 27 treated one PNG16 with only an sRGB chunk and no embedded ICC as untagged, so validation blocked it. Confirm its true color space, use Edit → Assign Profile on a copy, save with the correct ICC embedded and import again. Do not arbitrarily assign sRGB to unknown sources or rename extensions to bypass validation. Adding a matching sRGB ICC resolved this test without changing compressed pixel data.

<details>
<summary>Selection and panel settings</summary>

<table>
  <tr>
    <th width="50%" align="center">Reference image</th>
    <th width="50%" align="center">Panel settings</th>
  </tr>
  <tr>
    <td align="center" valign="top"><a href="../../assets/guide/reference-white-socks-icc.png"><img src="../../assets/guide/reference-white-socks-icc.png" width="360" alt="The tested white-socks reference"></a></td>
    <td align="center" valign="top"><a href="../../assets/guide/05-reference-panel.png"><img src="../../assets/guide/05-reference-panel.png" width="360" alt="Actual Portable panel: Character reference"></a></td>
  </tr>
</table>

</details>

<a id="scene"></a>

## 06 · Scene

<p align="center">
  <a href="../../assets/guide/06-scene-compare.png"><img src="../../assets/guide/06-scene-compare.png" width="760" alt="Before on the left, wisteria garden scene on the right"></a>
  <br><sub>Before (left) · Wisteria garden scene (right)</sub>
</p>

1. Duplicate the original and clear old references and protection. Ctrl-click the character layer thumbnail, then Ctrl+Shift+I to select the full transparent background.
2. Choose Portrait → Replace scene, with the selection destination. Enter the prompt.
3. Enable the guide. Disable transparency preservation, alignment and color matching. Preview and generate.
4. Apply and inspect the pergola, path perspective, feet and hair edges. The source character's lighting is retained; finish environmental lighting with adjustment layers if needed.

Prompt translation:

> Replace only the transparent background with a wisteria garden path on a sunny afternoon: a distant purple flower pergola, soft green plants and a pale stone path with natural perspective. Place both feet firmly on the path with contact shadows. Preserve the character, clothes, pose and framing.

The garden and path fill the background, rather than a small patch around the legs. Opaque character pixels remain unchanged.

<details>
<summary>Selection and panel settings</summary>

<p align="center">
  <a href="../../assets/guide/06-scene-panel.png"><img src="../../assets/guide/06-scene-panel.png" width="400" alt="Actual Portable panel: Scene"></a>
  <br><sub>Click the capture to read the full-resolution panel.</sub>
</p>

<p align="center">
  <a href="../../assets/guide/06-scene-workspace.png"><img src="../../assets/guide/06-scene-workspace.png" width="760" alt="Actual Photoshop window"></a>
  <br><sub>Original Photoshop capture; click to inspect.</sub>
</p>

</details>

<a id="effect"></a>

## 07 · Effect

<table>
  <tr>
    <th width="50%" align="center">Standalone asset</th>
    <th width="50%" align="center">Composited in Photoshop</th>
  </tr>
  <tr>
    <td align="center" valign="top"><a href="../../assets/guide/effect-preview.png"><img src="../../assets/guide/effect-preview.png" width="320" alt="Generated effect asset"></a></td>
    <td align="center" valign="top"><a href="../../assets/guide/07-effect-result.png"><img src="../../assets/guide/07-effect-result.png" width="320" alt="Photoshop composite on the sample"></a></td>
  </tr>
</table>

1. Choose Portrait → Effect asset, set New document and clear the reference. A standalone asset needs no character selection.
2. Enter the prompt and generate. Check the open curve, absence of characters and real transparency. Open as new document; this test created a 992×992 sRGB / 16-bit asset.
3. Use Layer → Duplicate Layer to copy the generated layer into a fresh sample copy. Ctrl+T: scale proportionally to 900×900 px, top-left X=50, Y=555 px.
4. Use Normal blending at about 85% opacity. Use a layer mask for front / back occlusion; add glow or other blending only as needed.

Prompt translation:

> A single violet ribbon of magical smoke, an open S curve flowing from lower left to upper right, tapering and fading at both ends. No closed loop or ring. Isolated transparent background, natural translucent edges, no people or text.

The first prompt asked for smoke around the legs with an empty center and produced a closed ring, which was rejected. The explicit open-curve prompt produced the accepted asset, then actually composited in Photoshop. It resembles a translucent violet ribbon, with small curve gaps and faint alpha residue; it still needs finishing.

<details>
<summary>View the Photoshop workspace</summary>

<p align="center">
  <a href="../../assets/guide/07-effect-asset-workspace.png"><img src="../../assets/guide/07-effect-asset-workspace.png" width="760" alt="Actual Photoshop window"></a>
  <br><sub>Original Photoshop capture; click to inspect.</sub>
</p>

</details>

<a id="atmosphere"></a>

## 08 · Atmosphere

<table>
  <tr>
    <th width="50%" align="center">Standalone asset</th>
    <th width="50%" align="center">Composited in Photoshop</th>
  </tr>
  <tr>
    <td align="center" valign="top"><a href="../../assets/guide/atmosphere-preview.png"><img src="../../assets/guide/atmosphere-preview.png" width="320" alt="Generated atmosphere asset"></a></td>
    <td align="center" valign="top"><a href="../../assets/guide/08-atmosphere-result.png"><img src="../../assets/guide/08-atmosphere-result.png" width="320" alt="Photoshop composite on the sample"></a></td>
  </tr>
</table>

1. Choose Portrait → Atmosphere asset, set New document and clear the reference.
2. Enter the prompt and generate. Check for an empty upper area, bottom mist, no character and no text. Open the 992×992 sRGB / 16-bit asset as a new document.
3. Duplicate its generated layer into a fresh sample copy. Transform proportionally to 900×900 px, top-left X=50, Y=555 px.
4. Use Normal blending at about 35% opacity. Check mist density and the face; reduce opacity or mask unwanted coverage.

Prompt translation:

> Soft pale lavender mist with a few floating light specks, concentrated at the bottom and fading upward, leaving the top empty. Transparent background, no people, no text, no solid backdrop.

The mist stays low and leaves the face clear. It has real alpha, but apparently empty areas retain very low-opacity pixels. Check on a dark background and clean the mask when needed; asking for transparency does not guarantee clean alpha.

<details>
<summary>Selection and panel settings</summary>

<p align="center">
  <a href="../../assets/guide/08-atmosphere-panel.png"><img src="../../assets/guide/08-atmosphere-panel.png" width="400" alt="Actual Portable panel: Atmosphere"></a>
  <br><sub>Click the capture to read the full-resolution panel.</sub>
</p>

</details>

<a id="generate"></a>

## 09 · Text to image

<p align="center">
  <a href="../../assets/guide/generate-preview.png"><img src="../../assets/guide/generate-preview.png" width="560" alt="Text-to-image result"></a>
  <br><sub>A new illustration generated from text; the source image is not used as input.</sub>
</p>

1. Choose Generate → Text to image, set New document and clear the reference.
2. Describe the appearance of 3F3F3F.webp using the prompt below. The source image is not sent as model input; no selection is needed.
3. Use one candidate, resolution 992, 25 steps and locked seed 42. Check full-body framing, both feet, outfit and background.
4. Open as new document to continue in a separate 992×992 sRGB / 16-bit document.

Prompt translation:

> Full-body anime illustration of an adult woman with long pink curls, a white pleated blouse, a pink and navy long coat, a black skirt with gold trim, red gloves and black lace-up heels. One hand raised beside the face, the other extended naturally. Soft detailed anime rendering, one centered character, both feet fully visible, clean pale lavender background, no text.

The result includes pink hair, a white blouse, a pink / navy coat and complete feet. It is a new illustration, without guaranteed identity, pose or accessory matching. Use a selection edit to change clothing on the original.

<details>
<summary>Selection and panel settings</summary>

<p align="center">
  <a href="../../assets/guide/09-generate-panel.png"><img src="../../assets/guide/09-generate-panel.png" width="400" alt="Actual Portable panel: Text to image"></a>
  <br><sub>Click the capture to read the full-resolution panel.</sub>
</p>

<p align="center">
  <a href="../../assets/guide/09-generate-workspace.png"><img src="../../assets/guide/09-generate-workspace.png" width="760" alt="Actual Photoshop window"></a>
  <br><sub>Original Photoshop capture; click to inspect.</sub>
</p>

</details>

<a id="relight"></a>

## 10 · Relighting (development build)

This is a selection edit with a prompt, not a one-click filter. The request path is tested offline; this guide does not claim a new native result or provide a fabricated screenshot.

1. Open a saved copy and select the area whose lighting should change. Set a protection area first for details that must remain unchanged, then reselect the edit area.
2. Choose **Portrait → Relighting**, with **New layer at selection** as the destination.
3. Describe direction, softness and color, for example: “Warm soft key light from the upper left, cool shadows on the right; preserve facial features, clothing structure and background.”
4. Keep source transparency for a cutout. To avoid compensating for deliberate color changes, start with context color matching off. Use a reference only if it helps specify the intended light.
5. Generate one candidate, inspect facial structure, edges and unselected areas, then apply as a separate masked layer. Adjust opacity or undo once if needed.

Works through the ComfyUI edit workflow or a platform model declaring edit support. Platforms stay at 8-bit, with platform-controlled steps and their own seed limits. This does not add skin smoothing or routine beauty retouching.

## Candidates, progress and undo

- **Progress:** loading and text encoding show stages; sampling shows actual steps and percentages, followed by a saved-candidate message. Encoding can take time; avoid repeated submissions.
- **Candidates:** 1–4 run sequentially, incrementing a locked seed. Switch thumbnails or use the list. A screenshot's Candidate 4 can include earlier panel results; each test here submitted one image.
- **Apply:** the first application creates a masked layer. Another candidate from the same capture replaces it. Changes to source dimensions, content or session block stale application.
- **Undo:** Ctrl+Z undoes one application. Opacity has separate undo records; the panel slider does not track native undo.
- **Export:** Save PNG exports the processed candidate at context dimensions, not the entire source canvas. Open as new document uses an independent sRGB document. Preview is 8-bit; export keeps the chosen depth.
- **History:** load candidates or reuse parameters. Prepare references, protection and selection again. After a restart, old results can be exported or opened separately, but cannot directly apply to a reopened source.
- **Cancel / reconnect:** cancel targets the current ID and stops later candidates, keeping completed results. Recover task queries the original ID without resubmitting; use the original backend address. If cancellation is unconfirmed, keep querying rather than creating more jobs.

## Parameters and color

| Control | Use |
| --- | --- |
| Resolution | 768, 992 or 1024; edits retain aspect ratio and align to workflow dimensions. |
| Steps | Default 25, range 1–100; higher is not necessarily better. |
| Context margin | Default 15%; surrounding context is not made editable. |
| Selection guide | Visual guidance. The final Photoshop mask enforces protection. Off by default for reference assistance. |
| Preserve transparency | Useful for clothing / materials; disable for backgrounds, removal or silhouette expansion. |
| Subject alignment | Uses alpha bounds to adjust size and position; can change proportions. Off for the background and scene examples. |
| Color matching | Limited overall correction. Off in these tests. |

16-bit output can be exported as PNG16, opened as RGB16 or applied to a 16-bit document. Applying to an 8-bit source quantizes to 8-bit without changing its depth. Model inputs, references and masks remain 8-bit. Higher-depth output reduces later quantization; it does not imply full 16-bit model precision, HDR or native wide-gamut generation. Finish color and lighting in Photoshop as needed.

## Troubleshooting and limits

| Symptom | Action |
| --- | --- |
| No selection / fully protected edit | Select again, inspect the range preview and clear unwanted protection. |
| Reference fails color checks | Confirm and embed the correct ICC on a copy; see Character reference. |
| White background | Preserve the outline for materials, disable for backgrounds. Inspect source fringe and alpha; standalone assets may need cleanup. |
| Result too small or unfilled | Check selection, context and aspect ratio; try alignment off. Select the entire background. Do not bypass size checks by changing workflow dimensions. |
| Source changed; application blocked | Capture and generate again, or export the old result for manual composition. |
| Unsafe semi-transparent multilayer source | Save a copy and merge visible layers before generating, or export and composite manually. |
| Backend, model or depth error | Check service, mappings and optional node. Open technical details, correct and retry. |
| Photoshop exits entirely | Save work, record the stage and examine events / dumps alongside host, GPU, driver and plugin behavior. A successful session is not a permanent crash fix. |

Host diagnostics check selection, protection, masks, undo and rollback in their own documents. Save report exports the result. Runtime logs record plugin stages, not Photoshop crash dumps.

The 2026-10-17 session used Windows Photoshop 27.0, GPU enabled and this sample: all nine modes generated actual outputs; six edits applied to copies; effects, atmosphere and text-to-image opened as 16-bit documents, with the first two additionally composited onto the sample. Source layers in all eight edit / composition copies remain channel-for-channel identical. Visible pixels and alpha outside all six edit masks are unchanged, as is full-canvas alpha in the three preserve-transparency examples. Invisible RGB beneath fully transparent pixels is excluded from appearance comparisons; source layers themselves were checked channel by channel.

Acceptance is limited to these examples. Clothing tested a coat tail; reference tested socks transfer. Complex prop reconstruction, identity consistency, other models, calibrated-display accuracy and long-term stability remain unverified. Photoshop did not exit during this session; that is not a permanent stability guarantee. Reference, effect and atmosphere modes remain experimental. Routine skin retouching is outside scope.

Use a trusted backend. Local ComfyUI also stores inputs and outputs. Check privacy and image permissions before sharing screenshots. Code licensing does not replace model or image licensing; see [compatibility and model sources](../../config/compatibility.json).
