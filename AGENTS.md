# PS-AI Development Guide

### Start here

PS-AI is a Photoshop UXP plugin. The published local path uses ComfyUI and Qwen-Image 2.1. The development branch also contains Bailian, Gemini / Nano Banana and OpenAI Images adapters; live platform and host acceptance await API keys. Read the [README](docs/README.en.md), [ComfyUI setup](docs/setup/COMFYUI.en.md) and [user guide](docs/usage/USER_GUIDE.en.md). See [Bailian](docs/providers/BAILIAN.en.md), [Gemini](docs/providers/GEMINI.en.md), [OpenAI Images](docs/providers/OPENAI.en.md) and the [backend / persistence contract](docs/development/BACKEND.en.md) before platform or server work. The [compatibility manifest](config/compatibility.json) records backend, node and model pins and the scope of validation; the [settings example](config/settings.example.json) defines portable configuration.

The three workspaces cover local editing, Portrait and text-to-image, with ten modes (including relight). Character references, effects and atmosphere assets are in scope; routine portrait retouching is not. References do not guarantee identity preservation, and generated results and transparency need inspection. Finding a model in the backend list does not establish compatibility.

Use public guides and current source as the development entry point. Brand geometry lives in assets/brand; regenerate exports after changes and preserve the open frame, monochrome structure and clear space without stretching or adding glow. Ignored handoff notes, historical plans and native evidence are local records, not prerequisites for a clone or fork. Do not publish those directories wholesale.

### Source map

| Area | Entry points |
| --- | --- |
| Panel, parameters, progress and history | [src/panel.ts](src/panel.ts), [src/i18n.ts](src/i18n.ts), [plugin/index.html](plugin/index.html), [plugin/style.css](plugin/style.css) |
| Capture, selections, protection, apply and undo | [src/photoshop.ts](src/photoshop.ts), [src/range-preview.ts](src/range-preview.ts) |
| Pixels, alpha, coordinates and color | [src/image.ts](src/image.ts), [src/composite.ts](src/composite.ts), [src/color.ts](src/color.ts), [src/png-decode.ts](src/png-decode.ts), [src/png16.ts](src/png16.ts) |
| Mode intent and ComfyUI graphs | [src/intent.ts](src/intent.ts), [src/workflow.ts](src/workflow.ts) |
| Managed relay and platform profiles | [src/platforms.ts](src/platforms.ts), [src/relay-controller.ts](src/relay-controller.ts), [server/runtime/managed-relay.ts](server/runtime/managed-relay.ts), [scripts/relay/start-ps-ai-relay.ps1](scripts/relay/start-ps-ai-relay.ps1) |
| Platform protocol and plugin client | [src/gateway-protocol.ts](src/gateway-protocol.ts), [src/gateway-client.ts](src/gateway-client.ts) |
| Server entry and HTTP | [server/main.ts](server/main.ts), [server/http/gateway.ts](server/http/gateway.ts), [server/http/messages.ts](server/http/messages.ts) |
| Platform jobs and persistence | [server/application/jobs.ts](server/application/jobs.ts), [server/persistence/job-store.ts](server/persistence/job-store.ts) |
| Provider contract and adapters | [server/providers/contract.ts](server/providers/contract.ts), [server/providers/bailian.ts](server/providers/bailian.ts), [server/providers/gemini.ts](server/providers/gemini.ts), [server/providers/openai.ts](server/providers/openai.ts) |
| Server errors, PNG and response budgets | [server/shared/errors.ts](server/shared/errors.ts), [server/shared/images.ts](server/shared/images.ts), [server/shared/io.ts](server/shared/io.ts) |
| Uploads, job state, cancellation and recovery | [src/client.ts](src/client.ts), [src/jobs.ts](src/jobs.ts), [src/storage.ts](src/storage.ts) |
| Profiles, environment checks and diagnostics | [src/profile.ts](src/profile.ts), [src/environment.ts](src/environment.ts), [src/diagnostics.ts](src/diagnostics.ts) |
| Optional 16-bit output | [comfyui/ps_ai_sdr16/__init__.py](comfyui/ps_ai_sdr16/__init__.py), [tests/test_sdr16.py](tests/test_sdr16.py) |
| Build, packages, environment tools and CI | [scripts/build.mjs](scripts/build.mjs), [scripts/package.mjs](scripts/package.mjs), [scripts/check-environment.ps1](scripts/check-environment.ps1), [scripts/prepare-environment.ps1](scripts/prepare-environment.ps1), [.github/workflows/build.yml](.github/workflows/build.yml) |
| Brand sources and exports | [assets/brand/mark.svg](assets/brand/mark.svg), [scripts/export-brand.mjs](scripts/export-brand.mjs) |

### Setup and commands

Install dependencies from [package.json](package.json) and the lockfile. CI pins Node in its workflow; the compatibility manifest records tested toolchain versions. The build uses TypeScript and esbuild. Photoshop provides `photoshop` and `uxp` at runtime; do not assume Node filesystem access, subprocesses or full browser APIs.

```powershell
npm ci
npm test
npm run typecheck
npm run build
```

The output is `dist/plugin`. Enable Photoshop developer mode, restart and load `dist/plugin/manifest.json` through UXP Developer Tool as described in the README. See [plugin/manifest.json](plugin/manifest.json) for the minimum host version; this is not a claim of testing every supported system.

- `npm run package` runs tests and builds, then produces CCX, Portable and environment-tool archives plus SHA256 files.
- `npm run brand:export` / `npm run brand:check` exports brand icons / checks that exports are current.
- `npm run p0` **submits real inference jobs to a running ComfyUI**. Inspect [scripts/p0-live.ts](scripts/p0-live.ts) first and ensure `nvidia-smi` is available for VRAM sampling. It currently defaults to `http://localhost:8188` and uses synthetic fixtures; it does not validate real photographs or Photoshop integration.
- `node scripts/build-p0-script.mjs` builds the native UXP probe `dist/ps-ai-p0.psjs`. Inspect the builder and relevant `src/p0-*.ts` before running it in Photoshop.
- For the 16-bit save node, run `python -m unittest discover -s tests -p test_sdr16.py` with backend Python and NumPy installed. This does not replace real inference or native apply tests.

### Contracts to preserve

**Document safety.** Capture freezes the source document, session, dimensions, profile, mode, depth, history, crop coordinates and grayscale mask. Resolve apply targets by source ID, never by whichever document is active. Reject closed, previous-session or modified sources while preserving candidate export. Keep only the validated exception for replacing the plugin's own candidate layer; do not bypass history checks generally.

Context is not the editable area. The effective mask is `M * (1 - P)`, with selection `M` and protection `P`; preserve feathering and original coordinates. Photoshop can trim transparent pixels or return cache-level coordinates: restore actual bounds. Keep pixel and candidate limits and sequential processing to bound full-size buffers.

Keep `executeAsModal` limited to capture/write operations, outside network and inference waits. Apply to a new layer with an editable mask and one undo step; roll back failures with `resumeHistory(..., false)`. Keep the mask safely hidden before writing grayscale data, dispose Imaging API resources in `finally`, and preserve original layers.

**Color, alpha and depth.** Inputs are tagged RGB / Grayscale 8/16-bit. Untagged sources, CMYK, Lab, Indexed, Multichannel and 32-bit HDR take explicit rejection paths. Convert copies when needed; never silently alter source documents. Model images, references and masks use sRGB8 / 8-bit, with gamut and precision loss; do not claim a lossless round trip.

Internal RGBA is straight alpha. When “Preserve source transparency” (`preserveAlpha`) is enabled, preserve source alpha without applying semitransparency twice. Validate the clipping base when this path needs one; for unsafe multilayer cases, ask for a merged copy or manual composition after export. Background/scene replacement may disable this option and change alpha within the edit mask. The 8-bit template is `qwen21-local-v2-rgba`; SDR16 uses `qwen21-local-v3-rgba16` and optional `PS_AISavePNG16`. Preserve `Uint16Array` values through composition, export and native apply, with separate 8-bit previews. Quantizing to 8-bit then scaling values is not 16-bit preservation. SDR16 does not mean HDR or native 16-bit model precision.

Validate PNG dimensions, inflation budget, scanlines, CRC and color tags before decoding. Do not fall back to permissive decoding. The untagged-output exception belongs only to the existing verified 8-bit template.

**Backend and jobs.** Settings use `schemaVersion: 1`. Omitted `backend` preserves ComfyUI; `backend: gateway` uses a platform `gatewayModel` ID. API keys are never plugin settings. Accept HTTP(S) origins with optional ports, without paths, credentials or queries. ComfyUI model mappings are filenames relative to backend model directories. The ComfyUI graph supports Qwen 2.1 GGUF, not arbitrary imported UI workflows. New adapters need node-required-input, connection-type, model and real-output validation.

In ComfyUI graphs, the source is the first image, an enabled guide occupies the next slot and references follow it. `JoinImageWithAlpha` restores alpha from `LoadImage`'s inverted MASK; preserve the direct connection without adding another inversion. Preserve image ordering and crop/scale correspondence. Read outputs from save node `8`; missing optional 16-bit support must fail before upload/submission.

Persist the caller-assigned UUID before POST. Recover lost responses by querying that ID, never by automatic resubmission. Historical jobs use their saved backend URL. Filter progress, results and cancellation by job ID. For ComfyUI, use only atomic `/api/jobs/{id}/cancel`, without a global `/interrupt` fallback. Show real stages or steps, not invented timing. Diagnostic traces record stages and task IDs, not private pixels or prompts; classify backend errors rather than assuming every failure is OOM.

### Managed platform selection

See [platform setup](docs/setup/PLATFORMS.en.md). Named choices are ComfyUI, Nano Banana (gemini), GPT Image (openai) and BaiLian (bailian); retain the manual gateway option. Optional platform and connections fields extend schemaVersion 1 without breaking old settings; managed localhost imports migrate to 127.0.0.1. Managed URLs are pinned to IPv4 127.0.0.1 (matching the listener; never resolve localhost for managed traffic), with origins at ports 8191/8192/8193 for bailian/gemini/openai; never send a key to an imported arbitrary URL. Preserve each model and ComfyUI address/depth on switching.

ComfyUI must never start a Node process. On Windows, RelayController copies the bundled relay/ assets into the private plugin data folder and calls UXP shell.openPath with launchProcess permission for .cmd. Host consent and Node 24 on PATH are required. Do not bypass a denied consent or assemble commands from model names, keys or prompts. Other systems use a manual gateway. The relay keeps separate stores under relay/provider, proves its identity by provider-bound nonce HMAC before the client sends any bearer/key, then authenticates all remaining routes with a Node-generated private token, rejects foreign Origin/Host, and never follows redirects. API keys are encrypted in UXP secureStorage, sent only after provider identity checks, and kept in server memory. A persisted keyed credential fingerprint blocks different or cleared keys for pending jobs across restart; restore their original account. Saved outputs/raw conversion must remain recoverable without an upstream key. Key storage may be lost; exports intentionally omit it.

Switching to ComfyUI leaves an existing relay running for recovery. Explicit stop shuts down all three listeners and drains work; closing Photoshop does not stop the independent process. Keep the legacy internal cosplay workspace ID for old history, display Portrait, and use edit mode relight for prompt-driven lighting. The new UI and relight have offline coverage; old nine-mode screenshots do not validate these new controls or results.

### Platform adapters and server rewrites

The public contract is [BACKEND.en.md](docs/development/BACKEND.en.md), not ignored local notes. UXP hosts the plugin; a separate Node.js 24+ process hosts platform adapters. Never import Node filesystem calls or provider SDKs into UXP. Keys may enter the password field and UXP secureStorage, but never ordinary settings, history, diagnostics or exports. Build output is `dist/gateway/ps-ai-gateway.mjs`; the plugin includes the same bundle and fixed launcher under relay/; environment archives include this standalone bundle and matching notices. Only the small pinned @noble/hashes HMAC/SHA256 helper is added to UXP; platform SDKs stay out.

See the [server structure](docs/development/BACKEND.en.md#server-architecture). main.ts composes and starts the service. HTTP handles transport and connection lifecycle, calling application/jobs.ts. Jobs depend on persistence and providers/contract.ts, never concrete provider classes or incoming HTTP. Adapters depend on the contract, shared protocol and validation; shared must not import upper layers. Keep task state out of routes. Shutdown stops incoming work, drains HTTP handlers, then workers and serialized writes, and finally releases the store lock. Add provider implementations under providers and register explicitly in main, without dynamic loading or another layering framework.

- Select one provider with `PSAI_PROVIDER=bailian|gemini|openai`, then `npm run gateway -- --port 8190`. Concurrent providers need separate ports/data directories. Defaults are `~/.ps-ai/bailian`, `~/.ps-ai/gemini` and `~/.ps-ai/openai`. Manual gateway keys come from the service environment. Managed keys come from the panel through authenticated loopback configuration. The reference binds 127.0.0.1 and provides neither multi-account authentication nor public hosting.
- `server/providers/contract.ts` defines `ImageProvider`. Capabilities constrain operations, image counts, depth, pixels and seeds. `seedMax: 0` means no configurable seed; use placeholder 0 without sending a provider seed. Reject unknown parameters. History restoration must not introduce disabled 16-bit output or unsupported asset modes/settings into platform configuration.
- Persist UUID, normalized fingerprint, provider identity and endpoint before the upstream call. A UUID creates at most one upstream request; conflicting bodies/providers get 409. Bailian saves its remote ID and resumes polling. Gemini GenerateContent and OpenAI Images return an image inline, running in a local worker without an invented remote ID. Keep unknown outcomes when neither a queryable ID nor raw result exists; never automatically replay a potentially billable creation.
- Persist raw output before validating/publishing PNG. Temporary I/O failures remain retryable rather than becoming invalid-image terminal states; recover saved raw output by the original UUID. Inputs, references and prompts are private stored data. Diagnostics/responses must not expose content, keys, raw provider errors or signed URLs.
- Migrate jobs, inputs and outputs together. A provider/region change cannot route old jobs elsewhere. One process locks each data directory. After an unclean exit, confirm the process is dead before removing a stale lock. Reconciliation, task-ID attachment, abandoning tracking, automatic cleanup and long-term stability guarantees are not implemented.
- Gateways currently output tagged sRGB8 PNG. Bailian requires exact dimensions; Gemini uses explicit 1K square padding and inverse cropping, with effective-resolution limits for narrow selections or large requests. Untagged output needs explicit per-provider `PSAI_BAILIAN_ASSUME_SRGB=1` / `PSAI_GEMINI_ASSUME_SRGB=1` / `PSAI_OPENAI_ASSUME_SRGB=1` policy. Never relax shared client color/CRC/budget/depth checks.
- All three adapters declare `cancellation: none`: stop future candidates, let the current request finish and retain its result. Do not imply billing stopped. Report stages only. Gemini excludes transparent effects/atmosphere assets, configurable seeds, 4K, conversations and 16-bit output; validate future additions separately.
- Add protocol, HTTP, restart/idempotency, redaction, geometry and panel regressions for adapters. Run `npm test`, `npm run build` and package checks. Without keys, record offline evidence only. Real inference, color/alpha, host interaction and installation need separate acceptance, followed by bilingual guides and manifest updates. FLUX is researched, not implemented. Published v0.4.0 assets do not contain these platform changes.

- Platform intents use semantic prompts without automatic image numbering; preserve original prompt text. Adapters bind roles: Bailian/Gemini send source, guide, reference. OpenAI JSON images contains source/reference; guide becomes a separate native mask with alpha=255-gray and protected padding. Never carry the old guide image slot into OpenAI prompts. Plan 2.5 canvases to multiples of16 and minimum area, use fixed 1.5 canvases, transform source/mask identically and inverse-crop outputs. Read only OPENAI_API_KEY; do not accept arbitrary relay URLs.

### Changes, validation and releases

Keep changes focused. Read the relevant implementation and tests; add a reproducer for behavior fixes. Preserve the compact Photoshop panel with collapsed setup/advanced controls and matching Chinese/English UI. Language changes must not rewrite prompts, model names or stored task parameters. Validate UXP inputs, selects and CSS in Photoshop; a browser screenshot is not host evidence.

Run checks appropriate to the change. Runtime, workflow and packaging changes need at least `npm test` and `npm run build`; releases need `npm run package`. For documentation changes, check the diff and links. If shipped guides change, run `node --import tsx --test --test-timeout=15000 tests/package.test.ts` to validate relative links inside the environment archive. New development links must exist in a clean clone without ignored files.

`tests/uxp-harness.ts` is a mock, not native validation. Capture/apply, alpha, ICC, depth, undo, selections and host controls require Photoshop checks. Record source review, mock tests, inference and host results separately, including anything not run. A successful run or a period without crashes does not establish long-term stability.

Before release, align versions in `package.json`, `package-lock.json` and `plugin/manifest.json`; inspect all three archives, licenses and checksums against the [packaging allowlists](scripts/package.mjs). Validate CCX and Portable installation separately. Preserve IDs `local.ps-ai` and `local.ps-ai.portable` and the Portable folder `PS-AI-FOR-ME`; changing them affects installation and UXP data. Environment preparation does not automatically download models or replace an existing backend.

GitHub Actions validates pushes to `main` and PRs. Package artifacts upload only on manual workflow runs; releases are currently published separately. Tags and assets must match validated code; do not move public tags. Documentation updates alone do not require replacing existing release assets.

Keep only README.md and AGENTS.md as root Markdown files. The English homepage is docs/README.en.md; use docs/setup, docs/usage, docs/providers and docs/development for categorized public guides. README links to each category. Keep language links at the top, use relative repository links and reflect actual implementation and validation. Publish only explicitly allowlisted guides; keep local handoff and evidence under ignored docs/local without broadening the exceptions. Configuration changes update both COMFYUI guides and the manifest; interaction changes update USER_GUIDE; brand SVG changes update exports and references. Use publishable screenshots at their original clarity, without fabricated host UI. Keep models, runtime images, private diagnostics and build artifacts ignored. Follow the shared attribution rules below for commits.

## Git Commit Attribution

When Codex contributes to code changes in this repository:

- Preserve the repository owner's configured Git identity as the primary commit author.
- Always append the following trailer to commit messages created by Codex:

  Co-authored-by: codex <codex@openai.com>

- Add the trailer after the commit message body, separated by a blank line.
- Do not add duplicate Co-authored-by trailers.
- Preserve other contributors' existing attribution.
- Do not attribute commits to Codex when Codex did not contribute.
- Do not modify global or local Git user.name / user.email settings.
- Do not amend or rewrite existing commits solely to add attribution.
- Follow existing repository commit conventions.
