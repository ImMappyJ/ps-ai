# Backend protocol and adapter development

[中文](BACKEND.md) | English

This guide is for rewriting the server, adding providers or changing job storage. See [Bailian](../providers/BAILIAN.en.md), [Gemini / Nano Banana](../providers/GEMINI.en.md) and [OpenAI Images](../providers/OPENAI.en.md) for setup and [COMFYUI.en.md](../setup/COMFYUI.en.md) for the existing local backend.

## Backend paths

<a id="relighting-workbench"></a>

See the [relighting workbench](RELIGHT.en.md) for structured lights, local illustrations and semantic request mapping. Lighting scenes belong to local task metadata; they do not add unknown fields to provider requests.

| Setting | Request contract | Implementation |
| --- | --- | --- |
| Omitted `backend`, or `comfyui` | ComfyUI graph, node schemas and model filenames | [src/infrastructure/backends/client.ts](../../src/infrastructure/backends/client.ts), [src/generation/workflow.ts](../../src/generation/workflow.ts) |
| `backend: gateway` | Semantic `ps-ai/1` requests and model capabilities | [src/infrastructure/backends/gateway-client.ts](../../src/infrastructure/backends/gateway-client.ts), [src/infrastructure/backends/gateway-protocol.ts](../../src/infrastructure/backends/gateway-protocol.ts) |

The new server does not need ComfyUI or pretend GGUF nodes. Photoshop retains capture, selections, protection, previews and safe application. The gateway owns provider authentication, translation, task identities and output files.

Bailian, Gemini and OpenAI Images are implemented, with live platform and host acceptance pending API keys. The plugin understands jobs and capabilities; adapters own provider fields. The FLUX row is a researched extension direction, not an implementation.

| Platform | API shape | Status |
| --- | --- | --- |
| [Bailian Qwen Image](https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference) | Async creation, remote task ID, polling and result URL | BailianProvider; recovery by remote ID |
| [Google Gemini / Nano Banana](https://ai.google.dev/gemini-api/docs/generate-content/image-generation) | Native generateContent, mixed parts and inline image | GeminiProvider; one synchronous call in a local background worker |
| [OpenAI Images](https://developers.openai.com/api/docs/guides/image-generation) | Separate generate/edit endpoints | OpenAIImagesProvider, JSON images and native mask; no Responses integration |
| [Black Forest Labs / FLUX](https://docs.bfl.ai/quick_start/generating_images) | Returned polling URL and async result | Researched, not implemented |

An OpenAI-compatible label, similar endpoint name or accepted model ID does not establish image-editing compatibility. Google Interactions is a separate API, not used by this adapter; do not assign its recovery guarantees to GenerateContent.

<a id="server-architecture"></a>

## Server structure

The server is organized by responsibility, with only its entry point at the root. `npm run gateway` and `dist/gateway/ps-ai-gateway.mjs` remain unchanged.

```text
server/
├── main.ts                   # Arguments, environment, composition, listen/exit
├── runtime/
│   └── managed-relay.ts       # Managed provider listeners and credential identity
├── http/
│   ├── gateway.ts            # Routes, status codes, Host/Origin, connections
│   └── messages.ts           # Bounded request bodies and JSON responses
├── application/
│   └── jobs.ts               # Submit, dedupe, status, recovery and workers
├── persistence/
│   └── job-store.ts          # Durable records, atomic writes, files and lock
├── providers/
│   ├── contract.ts           # Shared task/inline ImageProvider interface
│   ├── bailian.ts
│   ├── gemini.ts
│   └── openai.ts
└── shared/
    ├── errors.ts             # Safe errors and uncertain-outcome marker
    ├── images.ts             # PNG inputs and default output normalization
    └── io.ts                 # Bounded provider-response reading
```

HTTP calls the job service, which depends on persistence and the ImageProvider contract. main.ts injects concrete adapters; jobs never import Bailian, Gemini or OpenAI classes. Adapters neither access job directories nor write incoming HTTP responses. Failures use the shared ServiceError, serialized by HTTP; shared does not import upper layers. UXP and Node continue to use src/infrastructure/backends/gateway-protocol.ts and the existing pixel utilities, without duplicating the protocol or introducing Node modules into the plugin.

Jobs own UUIDs, state and background work. HTTP stops accepting work and drains handlers that may still persist a submission. Shutdown follows **handlers → workers → serialized writes → store lock**. Releasing the lock earlier could let a disconnected handler start work afterwards. gateway.store remains the original instance for diagnostics/fault injection; route operations use the job service.

Add a provider implementation and an explicit factory in main.ts, with capability, request and recovery tests. A single file store does not need a database abstraction, dependency injection container or framework. Moving files does not change HTTP, environment variables, on-disk formats or recovery rules.

## Managed relay and credentials

[Platform setup](../setup/PLATFORMS.en.md) covers panel operation. Optional `platform: bailian|gemini|openai` selects managed mode; `connections` retains independent profiles. Existing `backend: gateway` without platform remains manual, and omitted backend remains direct ComfyUI. Managed URLs pin IPv4 127.0.0.1, matching the listener, at ports 8191/8192/8193 respectively. Managed localhost profiles migrate automatically; ComfyUI/manual normalization is unchanged. Model and nonsecret connection fields are exportable; API keys and the relay token are not.

UXP copies the standalone gateway and static launchers from plugin relay/ into its private data folder. On Windows, shell.openPath opens the .cmd under declared launchProcess permissions and user consent; it cannot spawn Node directly or pass arguments. The launcher starts Node 24 with a fixed entry and data path, hidden, without interpolating credentials, prompts or model names. Other systems use the existing manual entry point. Starting/connect/configure sends no generation request. ComfyUI never launches the relay; switching to it does not terminate an existing relay.

[Managed composition](../../server/runtime/managed-relay.ts) owns three providers and stores under relay/provider. A private relay-session.json contains a Node-generated token and ports. Before sending a bearer or key, [RelayController](../../src/infrastructure/backends/relay-controller.ts) verifies a fresh challenge HMAC bound to provider and nonce. [relay-auth.ts](../../src/infrastructure/backends/relay-auth.ts) uses pinned @noble/hashes in UXP; no Node crypto is imported into the plugin. The handshake requires valid Host/Origin but no bearer, and reveals no token. Other routes require the bearer. All requests reject redirects. This is local pairing, not TLS or protection from software already running with the same OS account and private-file access.

| Managed-only route | Contract |
| --- | --- |
| GET /psai/v1/handshake | X-PSAI-Challenge nonce; returns provider and HMAC proof, no token/key |
| POST /psai/v1/configure | Bearer plus JSON containing only apiKey; empty string clears. Body limited to 2 KiB. Never returns/logs the key |
| POST /psai/v1/shutdown | Bearer; stops all three listeners, drains handlers/workers/writes, then unlocks stores |

Keys are encrypted per platform in UXP secureStorage and held only in relay memory. credential-id.json stores a keyed fingerprint, not a recoverable key; preserve it and the session file with job data. A different/cleared key is rejected for unfinished jobs even after restart. Restoring the original key is allowed. Missing credential identity for an existing unfinished job fails closed. Key storage can disappear; no plaintext fallback. Saved outputs and raw-result conversion remain recoverable without upstream credentials; only further provider queries require them. Shutdown is explicit and can wait for active work. Photoshop exit does not stop this separate process.

Manual mode still reads process environment credentials, uses ~/.ps-ai/provider or --data-dir, and supports the existing explicit endpoint/color options. Managed mode currently uses fixed official defaults and strict tagged output; use manual mode for other regions or an explicit untagged-sRGB policy. A new provider must be registered explicitly in main.ts and runtime/managed-relay.ts, with descriptor, UI and recovery tests.

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

`kind` is `t2i`, `edit` or `asset`; `mode` uses the plugin's eleven modes, including `relight` and `blend` as `edit` operations. Edits require a source. Optional guide and reference follow the source in that order, without empty slots. Platform intents do not assign image numbers; adapters bind roles. Bailian/Gemini use a visual guide. OpenAI converts it to a separate mask (alpha=255-gray), leaving source/reference in images. Photoshop selections and protection enforce the final boundary.

Context assets keep `kind: asset` and add `assetContext: selection-v1`. They require source and guide together, prohibit imported references, and require the model’s optional `assetContexts` capability to contain that version. Missing capability means unsupported and is rejected before upload; unknown versions and use on other kinds reject. Unmarked assets keep text-only semantics and cannot carry images. New context captures preserve native depth separately from sRGB8 model input and save raw selection/protection plus their effective mask. Application retains output alpha, uses the effective native mask once and revalidates the saved UUID without resubmission.

ComfyUI sends source first and guide second with the existing direct inverted-MASK alpha restoration. Bailian 2.1 sends both images with independent-asset semantics; Bailian 3.0 and Gemini do not declare this capability. OpenAI uses its edits endpoint, source in images and guide as a separate native mask with alpha=255-gray, identical transforms and protected padding, transparent output and inverse cropping. Offline tests cover request geometry, raw retention and same-UUID recovery. Real ComfyUI tests retained source content or painted guides and failed visual acceptance; platform live acceptance remains pending API keys. Transparent pixels are necessary but do not prove asset quality.

Six PS27 sRGB synthetic API cases passed RGB8/16 asset capture, native gray planes, one effective mask, alpha/feather/protection, single undo and injected-failure rollback. Both large cases used `edit-analysis` and fully restored after cancellation following two written strips. Outside/protected visible color and alpha differences were zero; hidden RGB under zero alpha is outside this evidence. Saved-UUID reads used in-memory fixtures here, not disk durability, restart or installed asset-control acceptance. Five real Qwen samples (four scenes and one prompt comparison) still failed visually; native API success does not establish output quality.

Capabilities contain `protocol: ps-ai/1`, `provider`, `configured`, `cancellation: none`, `progress: stages` and `models`. Each model defines `id`, `label`, `operations`, `maxInputImages`, `outputDepths`, `seedMax`, `minPixels`, `maxPixels` and `maxAspectRatio`. `seedMax: 0` means no configurable seed; requests use placeholder 0 without sending a provider seed. Unknown parameters are rejected. This protocol revision supports only 8-bit output, stage progress and no guaranteed interruption. Add client support and version the contract before exposing other parameters, step progress or cancellation guarantees.

States are `queued`, `running`, `ready`, `failed`, `cancelled` and `unknown`. Only `ready` supplies:

```json
{"state":"ready","images":[{"filename":"00000000-0000-4000-8000-000000000001.png","subfolder":"","type":"output"}]}
```

## Persistence is part of the contract

See job orchestration in [application/jobs.ts](../../server/application/jobs.ts), durable files in [persistence/job-store.ts](../../server/persistence/job-store.ts) and transport in [http/gateway.ts](../../server/http/gateway.ts). A rewrite in another language or database must preserve this ordering:

1. Validate inputs and hash the normalized request together with `clientId`.
2. **Persist the local UUID, fingerprint, provider identity, endpoint and `submitting` state before creating a platform task.**
3. For task APIs, atomically save `providerTaskId` and `queued`, then query only that ID. Inline APIs make one local background call, without an invented remote ID; preserve raw output before validating and publishing it.
4. The same UUID and request return the existing record. A different request gets 409. Never create the upstream task again.
5. After a lost response, timeout or restart, resume by platform ID when available. A submission window without that ID becomes `unknown`, with no automatic retry or invented terminal state.
6. Download completed output, preserve the raw bytes, validate and save the checked PNG. Validation failures retain raw output and an explicit error. Temporary disk failures remain retryable; saved raw output can be processed again by local UUID even after a provider URL expires.

The default directory is `~/.ps-ai/bailian`, `~/.ps-ai/gemini` or `~/.ps-ai/openai`; override it with `PSAI_GATEWAY_DATA_DIR`. It contains `jobs/`, `inputs/`, `raw/`, `outputs/` and `gateway.lock`. Metadata uses a temporary file, flush and atomic rename. Operations serialize per job; one instance owns the directory. Prompts, inputs and results remain on disk without automatic cleanup.

Normal shutdown releases the lock. After a crash, confirm that the recorded PID has exited before manually removing a stale `gateway.lock`. Never remove a live instance's lock. Corrupt job files block startup rather than silently clearing history. The current guarantee covers process restarts, not every filesystem failure or power-loss scenario.

An `unknown` submission without a platform ID needs manual reconciliation with platform records; server reconciliation and attaching a discovered platform ID remain unimplemented. The plugin History UI permits a two-step, UUID-bound **Stop tracking locally** action only for `unknown` records. It retains state, original ID, endpoint and all data, adding plugin-local `tracking: detached` metadata to remove only that record from the generation guard. It neither changes the server record nor cancels a request, stops billing or proves failure. A separate new generation may duplicate work. Recovery clears the local detachment before querying the original UUID; it never resubmits. Do not delete server metadata or invent a terminal state. Other tracked pending records retain the duplicate-submission guard.

The plugin separately supports confirmed **local history clearing**, including legacy unresolved records while idle. It removes selected plugin records and their owned local source/mask/candidate files, evicts cached candidates, and removes their local generation block. Durable cleared-ID markers prevent late saves or restart from reviving these records; interrupted cleanup remains visible and retryable. Shared or unproven file ownership is retained/reported. This action sends no gateway request and does not alter the server store, cancel upstream work, stop billing, or prove a remote outcome. It leaves Photoshop documents/applied layers, exported images, settings, credentials, access grants and lighting drafts intact. Server reconciliation and remote data cleanup remain separate, unimplemented features.

Each job keeps its provider identity and endpoint. Do not query an old task through another provider. Restore the original region/workspace before recovery; replacement keys must retain access to that task. Migrate input/output files as well as metadata.

## Implement another provider

Implement [server/providers/contract.ts](../../server/providers/contract.ts): declare `id`, `execution` (`task` or `inline`) and `baseUrl`, then provide `capabilities()` and `submit()`. Task APIs return `{taskId}` and implement `poll()` / `download()`. Inline APIs return `{image}` without inventing a remote ID. Optional `normalizeOutput()` must produce tagged sRGB8 at requested dimensions, with a documented inverse for geometric transforms. See [Bailian](../../server/providers/bailian.ts), [Gemini](../../server/providers/gemini.ts) and [OpenAI](../../server/providers/openai.ts). Register explicitly in [server/main.ts](../../server/main.ts), without dynamic modules or arbitrary provider URLs. Keep platform requests and provider SDKs on the server; accept managed keys only through authenticated local configuration.

Errors expose only sanitized `code` and `message`. Never forward raw provider messages, headers, Base64 images, prompts or signed URLs. Distinguish definite rejection from uncertain acceptance; retain unknown outcomes without reposting.

Manual `PSAI_PROVIDER=bailian|gemini|openai` selects one provider per process. Concurrent instances need separate ports and data directories. Bailian uses remote tasks and short polling. Gemini/OpenAI Images run one synchronous call in a local worker, returning the local ID immediately. Disconnects do not stop it; a timeout or crash before raw output persistence can only retain unknown. Results download when the plugin queries the job. Platform records and URLs expire, so reconnect and download promptly. Background polling, cleanup, usage accounting, SDK retries and cross-account routing are not implemented.

## Image and service boundaries

- Plugin inputs are sRGB8 PNG, capped at 10 MiB each. JSON requests: 64 KiB; Bailian JSON: 1 MiB; Gemini inline response: 16 MiB; OpenAI response: 32 MiB; output download: 32 MiB. Existing pixel budgets and strict PNG checks still apply.
- Results must be genuine 8-bit PNG at the requested dimensions. Bailian requires exact dimensions. Gemini explicitly pads source/guide to a 1024 square, crops the same padding and resizes to the requested canvas. Large results can upscale 1K content; subject alignment remains unverified. OpenAI 2.5 plans aligned flexible canvases; 1.5 uses fixed canvases. Source/mask share transforms and inverse cropping. Version 2.5 ratios are limited to 1:3–3:1 and assets explicitly request transparency. Assets require transparent pixels and still need visual inspection.
- Untagged output is rejected by default. Explicit provider-specific `PSAI_BAILIAN_ASSUME_SRGB=1` , `PSAI_GEMINI_ASSUME_SRGB=1` or `PSAI_OPENAI_ASSUME_SRGB=1` permits interpreting untagged output as sRGB; this is not color conversion and cannot accept unknown ICC/HDR metadata. Clients always require tagged sRGB gateway output.
- Bailian downloads only trusted HTTPS OSS URLs without its key. Gemini/OpenAI call their respective fixed official HTTPS APIs and accept inline PNG, not arbitrary response URLs. All three reject redirects.
- The reference service restricts Host, cross-site requests, filenames and job input ownership. Public deployments need separate authentication, account isolation, rate limits and storage permissions; this implementation is not a public multi-tenant service.

## Validation and maintenance

Run `npm test`, `npm run typecheck` and `npm run build`. `tests/application-jobs.test.ts` checks identity persistence before submission, deduplication, draining and raw-result recovery without HTTP. Provider contracts live in `tests/bailian.test.ts` , `tests/gemini.test.ts` and `tests/openai.test.ts`, real loopback HTTP and persistence tests in `tests/gateway-server.test.ts`, and panel tests in `tests/gateway-panel.test.ts`. Simulated providers cannot prove live access, speed, quality, color, transparency or native host UI compatibility.

Once a key is available, follow [Bailian](../providers/BAILIAN.en.md), [Gemini](../providers/GEMINI.en.md) and [OpenAI Images](../providers/OPENAI.en.md) for platform and Photoshop acceptance, then update the [compatibility manifest](../../config/compatibility.json), both language guides and [AGENTS.md](../../AGENTS.md). Match releases to validated source and packages. Existing v0.4.0 assets do not contain this unpublished work.
