# Backend protocol and adapter development

[中文](BACKEND.md) | English

This guide is for rewriting the server, adding providers or changing job storage. See [Bailian](BAILIAN.en.md), [Gemini / Nano Banana](GEMINI.en.md) and [OpenAI Images](OPENAI.en.md) for setup and [COMFYUI.en.md](COMFYUI.en.md) for the existing local backend.

## Backend paths

| Setting | Request contract | Implementation |
| --- | --- | --- |
| Omitted `backend`, or `comfyui` | ComfyUI graph, node schemas and model filenames | [src/client.ts](src/client.ts), [src/workflow.ts](src/workflow.ts) |
| `backend: gateway` | Semantic `ps-ai/1` requests and model capabilities | [src/gateway-client.ts](src/gateway-client.ts), [src/gateway-protocol.ts](src/gateway-protocol.ts) |

The new server does not need ComfyUI or pretend GGUF nodes. Photoshop retains capture, selections, protection, previews and safe application. The gateway owns provider authentication, translation, task identities and output files.

Bailian, Gemini and OpenAI Images are implemented, with live platform and host acceptance pending API keys. The plugin understands jobs and capabilities; adapters own provider fields. The FLUX row is a researched extension direction, not an implementation.

| Platform | API shape | Status |
| --- | --- | --- |
| [Bailian Qwen Image](https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference) | Async creation, remote task ID, polling and result URL | BailianProvider; recovery by remote ID |
| [Google Gemini / Nano Banana](https://ai.google.dev/gemini-api/docs/generate-content/image-generation) | Native generateContent, mixed parts and inline image | GeminiProvider; one synchronous call in a local background worker |
| [OpenAI Images](https://developers.openai.com/api/docs/guides/image-generation) | Separate generate/edit endpoints | OpenAIImagesProvider, JSON images and native mask; no Responses integration |
| [Black Forest Labs / FLUX](https://docs.bfl.ai/quick_start/generating_images) | Returned polling URL and async result | Researched, not implemented |

An OpenAI-compatible label, similar endpoint name or accepted model ID does not establish image-editing compatibility. Google Interactions is a separate API, not used by this adapter; do not assign its recovery guarantees to GenerateContent.

## ps-ai/1 routes

Paths are relative to the gateway origin; JSON is UTF-8. The reference server binds only to `127.0.0.1`. It has no user accounts, gateway login or public deployment mode.

| Method and path | Contract |
| --- | --- |
| `GET /psai/v1/capabilities` | Protocol, provider, credential-presence flag and model capabilities; never credentials |
| `PUT /psai/v1/uploads/{id}-{role}.png` | Raw PNG with `Content-Type: image/png`; returns `{"name":"..."}` |
| `POST /psai/v1/jobs` | Job envelope below; HTTP 202 echoes the caller's `id` |
| `GET /psai/v1/jobs/{id}` | State, sanitized error or result descriptor for that task |
| `GET /psai/v1/outputs/{id}.png` | Checked PNG for a completed task; no exposed temporary platform URL |
| `POST /psai/v1/jobs/{id}/cancel` | Truthful boolean `cancelled`; currently false for all three adapters |

`id` and `clientId` are lowercase UUIDs generated and persisted by the plugin. Upload roles are `source`, `guide` and `reference`. Paths, external input URLs and another job's uploads are rejected. Upload names are immutable.

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "clientId": "00000000-0000-4000-8000-000000000002",
  "request": {
    "model": "qwen-image-2.1-pro",
    "kind": "edit",
    "mode": "edit",
    "prompt": "Add white over-knee stockings. Preserve the pose and surrounding areas.",
    "seed": 42,
    "width": 768,
    "height": 768,
    "outputDepth": 8,
    "source": "00000000-0000-4000-8000-000000000001-source.png"
  }
}
```

`kind` is `t2i`, `edit` or `asset`; `mode` uses the plugin's nine modes. Edits require a source. Optional guide and reference follow the source in that order, without empty slots. Platform intents do not assign image numbers; adapters bind roles. Bailian/Gemini use a visual guide. OpenAI converts it to a separate mask (alpha=255-gray), leaving source/reference in images. Photoshop selections and protection enforce the final boundary.

Capabilities contain `protocol: ps-ai/1`, `provider`, `configured`, `cancellation: none`, `progress: stages` and `models`. Each model defines `id`, `label`, `operations`, `maxInputImages`, `outputDepths`, `seedMax`, `minPixels`, `maxPixels` and `maxAspectRatio`. `seedMax: 0` means no configurable seed; requests use placeholder 0 without sending a provider seed. Unknown parameters are rejected. This protocol revision supports only 8-bit output, stage progress and no guaranteed interruption. Add client support and version the contract before exposing other parameters, step progress or cancellation guarantees.

States are `queued`, `running`, `ready`, `failed`, `cancelled` and `unknown`. Only `ready` supplies:

```json
{"state":"ready","images":[{"filename":"00000000-0000-4000-8000-000000000001.png","subfolder":"","type":"output"}]}
```

## Persistence is part of the contract

See [server/store.ts](server/store.ts) and [server/gateway.ts](server/gateway.ts). A rewrite in another language or database must preserve this ordering:

1. Validate inputs and hash the normalized request together with `clientId`.
2. **Persist the local UUID, fingerprint, provider identity, endpoint and `submitting` state before creating a platform task.**
3. For task APIs, atomically save `providerTaskId` and `queued`, then query only that ID. Inline APIs make one local background call, without an invented remote ID; preserve raw output before validating and publishing it.
4. The same UUID and request return the existing record. A different request gets 409. Never create the upstream task again.
5. After a lost response, timeout or restart, resume by platform ID when available. A submission window without that ID becomes `unknown`, with no automatic retry or invented terminal state.
6. Download completed output, preserve the raw bytes, validate and save the checked PNG. Validation failures retain raw output and an explicit error. Temporary disk failures remain retryable; saved raw output can be processed again by local UUID even after a provider URL expires.

The default directory is `~/.ps-ai/bailian`, `~/.ps-ai/gemini` or `~/.ps-ai/openai`; override it with `PSAI_GATEWAY_DATA_DIR`. It contains `jobs/`, `inputs/`, `raw/`, `outputs/` and `gateway.lock`. Metadata uses a temporary file, flush and atomic rename. Operations serialize per job; one instance owns the directory. Prompts, inputs and results remain on disk without automatic cleanup.

Normal shutdown releases the lock. After a crash, confirm that the recorded PID has exited before manually removing a stale `gateway.lock`. Never remove a live instance's lock. Corrupt job files block startup rather than silently clearing history. The current guarantee covers process restarts, not every filesystem failure or power-loss scenario.

An `unknown` submission without a platform ID needs manual reconciliation with platform records. There is currently no UI for attaching a discovered platform ID or abandoning tracking. Do not delete metadata, invent a terminal state or create the same task again before establishing what happened. The plugin retains its duplicate-submission guard.

Each job keeps its provider identity and endpoint. Do not query an old task through another provider. Restore the original region/workspace before recovery; replacement keys must retain access to that task. Migrate input/output files as well as metadata.

## Implement another provider

Implement [server/provider.ts](server/provider.ts): declare `id`, `execution` (`task` or `inline`) and `baseUrl`, then provide `capabilities()` and `submit()`. Task APIs return `{taskId}` and implement `poll()` / `download()`. Inline APIs return `{image}` without inventing a remote ID. Optional `normalizeOutput()` must produce tagged sRGB8 at requested dimensions, with a documented inverse for geometric transforms. See [Bailian](server/bailian.ts), [Gemini](server/gemini.ts) and [OpenAI](server/openai.ts). Register explicitly in [server/main.ts](server/main.ts), without dynamic modules or arbitrary provider URLs. Keep keys on the server.

Errors expose only sanitized `code` and `message`. Never forward raw provider messages, headers, Base64 images, prompts or signed URLs. Distinguish definite rejection from uncertain acceptance; retain unknown outcomes without reposting.

`PSAI_PROVIDER=bailian|gemini|openai` selects one provider per process. Concurrent instances need separate ports and data directories. Bailian uses remote tasks and short polling. Gemini/OpenAI Images run one synchronous call in a local worker, returning the local ID immediately. Disconnects do not stop it; a timeout or crash before raw output persistence can only retain unknown. Results download when the plugin queries the job. Platform records and URLs expire, so reconnect and download promptly. Background polling, cleanup, usage accounting, SDK retries and cross-account routing are not implemented.

## Image and service boundaries

- Plugin inputs are sRGB8 PNG, capped at 10 MiB each. JSON requests: 64 KiB; Bailian JSON: 1 MiB; Gemini inline response: 16 MiB; OpenAI response: 32 MiB; output download: 32 MiB. Existing pixel budgets and strict PNG checks still apply.
- Results must be genuine 8-bit PNG at the requested dimensions. Bailian requires exact dimensions. Gemini explicitly pads source/guide to a 1024 square, crops the same padding and resizes to the requested canvas. Large results can upscale 1K content; subject alignment remains unverified. OpenAI 2.5 plans aligned flexible canvases; 1.5 uses fixed canvases. Source/mask share transforms and inverse cropping. Version 2.5 ratios are limited to 1:3–3:1 and assets explicitly request transparency. Assets require transparent pixels and still need visual inspection.
- Untagged output is rejected by default. Explicit provider-specific `PSAI_BAILIAN_ASSUME_SRGB=1` , `PSAI_GEMINI_ASSUME_SRGB=1` or `PSAI_OPENAI_ASSUME_SRGB=1` permits interpreting untagged output as sRGB; this is not color conversion and cannot accept unknown ICC/HDR metadata. Clients always require tagged sRGB gateway output.
- Bailian downloads only trusted HTTPS OSS URLs without its key. Gemini/OpenAI call their respective fixed official HTTPS APIs and accept inline PNG, not arbitrary response URLs. All three reject redirects.
- The reference service restricts Host, cross-site requests, filenames and job input ownership. Public deployments need separate authentication, account isolation, rate limits and storage permissions; this implementation is not a public multi-tenant service.

## Validation and maintenance

Run `npm test`, `npm run typecheck` and `npm run build`. Provider contracts live in `tests/bailian.test.ts` , `tests/gemini.test.ts` and `tests/openai.test.ts`, real loopback HTTP and persistence tests in `tests/gateway-server.test.ts`, and panel tests in `tests/gateway-panel.test.ts`. Simulated providers cannot prove live access, speed, quality, color, transparency or native host UI compatibility.

Once a key is available, follow `BAILIAN.en.md`, `GEMINI.en.md` and `OPENAI.en.md` for platform and Photoshop acceptance, then update the [compatibility manifest](config/compatibility.json), both language guides and [AGENTS.md](AGENTS.md). Match releases to validated source and packages. Existing v0.4.0 assets do not contain this unpublished work.
