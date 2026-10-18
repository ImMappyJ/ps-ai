# Build and release

[简体中文](RELEASING.md) · [Home](../README.en.md)

## The two workflows

[Build packages](../../.github/workflows/build.yml) retains `main` pushes, PRs and manual builds. Only manual runs upload ordinary Actions artifacts; it does not write GitHub Releases. [Release](../../.github/workflows/release.yml) handles `v*` tag pushes or manual requests from the default branch. Automation takes effect after these files and release scripts are deployed to GitHub's default branch. Local uncommitted or unpushed code is absent from remote builds.

The Release build job has `contents: read`: it resolves an existing remote tag, validates source and versions, installs locked dependencies and runs `npm run package` once, including tests, type checking and build. It verifies archives in a dedicated directory and uploads this batch's artifact. Only a non-dry-run publish job gets `contents: write`. It downloads the exact artifact ID from the build, verifies the same bytes, creates a draft, uploads missing assets, verifies remote content and publishes the draft. It does not install dependencies or rebuild.

Both jobs pin control scripts directly to the event's `github.workflow_sha`. Manual requests must select the repository default branch's workflow definition, checked before any checkout. Tag requests use the tag's workflow definition and require its control commit to equal the resolved source commit. The resolver also requires control ancestry in the default branch and source ancestry in `main`; the exact source SHA is built in a separate checkout. Publication rechecks the tag object and source; tag drift fails. Per-tag runs and all publication jobs have concurrency protection that does not cancel running work.

## Prepare a version

Tags strictly use `vX.Y.Z`, for example `v0.5.0`, without leading zeroes, `beta` or `rc` suffixes. Before tagging, align and commit these project fields:

- `package.json` → `version`.
- `package-lock.json` → top-level `version` and `packages[""].version`.
- `plugin/manifest.json` → `version`.

Built, CCX and Portable manifests and asset filenames must also match. Validation identifies a mismatched field and never rewrites versions. Dependency, protocol and workflow-template versions are separate.

[config/release.json](../../config/release.json) comes from the target tag, with `{"schemaVersion":1,"channel":"prerelease"}`. A missing file or omitted `channel` defaults to `prerelease`; invalid configuration fails. Only explicit `stable` selects the stable channel. Prereleases never become Latest, and an older stable version cannot move Latest backward. Both channels retain current `experimental` filenames. Channel selection does not expand host or image-quality acceptance. The published experimental v0.4.0 and its existing assets remain historical facts.

Run `npm ci` and `npm run package` on the intended release source. Inspect all three archives, licenses, hashes and the compatibility manifest, and validate CCX and Portable installation separately. Photoshop color, alpha, 16-bit, undo, controls and real inference require manual acceptance. Ordinary CI does not run Photoshop, GPU inference, model downloads or paid providers. Record passed and unverified items, and maintain the [bilingual notes template](../../config/release-notes.md). Notes and guides come from the target tag; newer `main` documentation does not describe an older release.

Local tests execute the actual PowerShell workflow guards and require PowerShell 7 with `pwsh` on PATH. GitHub's Windows runner already provides it.

## First deployment and subsequent releases

1. Commit and push the workflows, release scripts and guides to the default branch. Confirm Actions and the required built-in token permissions are allowed.
2. Prepare the next version's fields, channel and notes. Complete offline checks and required manual acceptance.
3. Commit and push the complete release source so the intended commit belongs to `main` history.
4. Check that commit, create its explicit version tag and push that tag. A new matching tag push immediately requests a real release.
5. Inspect the build and publish results in Actions, then check the Release source, channel and assets.

These are future maintainer operations. Local merges, version updates and test packages do not create remote tags or Releases. Never move a public tag. Fix code or distribution problems in a new version.

## Manual dry run

In **Actions → Release → Run workflow**, select the default branch, enter an existing remote `tag`, and retain `dry_run=true`. It performs the same source, version and archive checks and saves an Actions artifact. It creates no draft, uploads no Release assets, calls no write-permission generated-notes endpoint and changes no Latest selection. Only explicit `dry_run=false` enters publication.

For the first remote dry run, use an **already existing, trustworthy tag that contains the new tooling and has no published Release**, or an isolated test repository. Pushing a new matching tag for a test first triggers real publication; a local-only tag is not an existing remote tag. Do not test by overwriting old public assets. Manual definitions selected outside the default branch are rejected.

## Assets and integrity

Each version `X.Y.Z` publishes:

| File | Purpose |
| --- | --- |
| `ps-ai-X.Y.Z-experimental.ccx` | CCX plugin installation |
| `ps-ai-X.Y.Z-portable-experimental.zip` | Portable package containing `PS-AI-FOR-ME` |
| `ps-ai-X.Y.Z-environment-experimental.zip` | Environment tools, examples, user guides and standalone gateway |
| A matching `.sha256` for each package | Package SHA256 checksum |
| `release-manifest.json` | Source, control commit, channel, original build batch, file sizes and SHA256 hashes |

The manifest does not hash itself. Its hash is bound by the build output and draft identity. SHA256 files and the manifest provide integrity checks, not signatures or build attestations. Remote verification requires the exact asset set, sizes and digests; an unavailable digest requires downloading that asset and hashing its bytes. The outer Actions artifact ZIP is a transport container.

Local `npm run package` still writes to `release/`. `PSAI_RELEASE_DIR` selects a new dedicated directory; an explicit nonempty directory fails without deleting old packages. Automated releases set `PSAI_SOURCE_REF` to the source SHA so environment-package links to repository development guides stay tied to that source.

## Failure recovery

- Build failure before a draft exists: address the cause and validate again. Changed version source requires a new version.
- Publication interrupted with an owned draft: open the **original run containing the successful build** and rerun only the failed publish job. Preserve its artifact ID, manifest hash and original build attempt. Missing files are uploaded only after identity and existing bytes match.
- Do not resume a draft with Re-run all jobs, another run or newly rebuilt bytes from the same commit. ZIP timestamps can change hashes; a different batch fails.
- Original artifact expired, deleted or inaccessible on rerun: safely fail and retain the draft. The workflow never selects another run or silently rebuilds. A maintainer must investigate the original failure and draft ownership. If the same bytes cannot be recovered, prepare a new version without mixing assets.
- Unknown/manual drafts, unexpected assets or identity/hash conflicts: stop for maintainer investigation. The workflow never takes over, deletes or overwrites them.
- Published Release: with sufficient evidence, report already complete without writes. A conflict fails and requires a new version. The workflow does not edit published notes, channel or assets and never uses `--clobber`.

Only a confirmed 404 from the specific lookup can mean absence. Authentication failures, 403/429 rate limits, network and service errors fail rather than creating another Release. Consult the safe stage classification in logs; do not share tokens, raw responses or signed download URLs.

## Permissions and acceptance records

Use the built-in `GITHUB_TOKEN`, exposed as `GH_TOKEN` only to API steps. Checkouts do not persist credentials; PRs have no publication rights. A PAT or additional service is normally unnecessary. If organization/repository policy blocks write permissions, or target workflow changes trigger GitHub's additional authorization restriction, address repository policy and stop the restricted publication. Do not bypass it with a long-lived PAT. Optional immutable Releases are compatible with preparing all assets in a draft before publication.

Local tests, workflow static checks, a GitHub dry run, a real publication and Photoshop manual acceptance are separate evidence. Before first deployment there is no online execution evidence. Local success does not establish online or host success. Follow the target version's documented limits and test installation, generation, apply and undo on saved copies.
