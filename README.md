# OpenCode OpenRouter Metadata

OpenCode plugin that discovers models through any OpenAI-compatible `/v1/models` endpoint and preserves OpenRouter-style reasoning metadata, capabilities, limits, modalities, and pricing.

## Development

```powershell
npm install
npm run typecheck
npm run test:run
npm run build
```

The build generates the OpenCode model schema from the matching OpenCode Git tag. Specify the target version with a command-line argument or environment variable:

```powershell
npm run build -- --opencode-version=1.18.4
$env:OPENCODE_VERSION = '1.18.4'; npm run build
```

Schema generation requires Git and Bun. Set `BUN_BINARY` when Bun is not on `PATH`.

At runtime, older OpenCode versions are rejected, matching versions use the generated schema, and newer versions use the older schema as a conservative subset with a warning.

## Release Retention

Release automation maintains three release channels:

- `nightly` is a rolling prerelease built from `main`.
- `stable` is a rolling release built from the most recent declared project release.
- `opencode-vX.Y.Z` compatibility releases are built against the matching OpenCode `vX.Y.Z` tag.

Compatibility releases are retained independently of `nightly` and `stable`. The cleanup policy is:

- Compatibility releases older than one year are removed first.
- At least the three newest compatibility releases are always retained.
- If release assets exceed the configured storage threshold, the oldest compatibility releases are removed until storage is below the threshold or only three remain.
- If storage is still above the threshold with three releases remaining, cleanup stops and reports a warning rather than deleting one of the required releases.
- `nightly`, `stable`, and versioned project releases are protected from compatibility cleanup.

The default release-asset threshold is 200 MB (200,000,000 bytes). Override it with the repository variable `RELEASE_STORAGE_THRESHOLD_BYTES` when needed.

## Behavior

- Targets every configured provider that exposes a string `options.baseURL` by default.
- Restrict to a subset with plugin options: `[["opencode-openrouter-metadata", { "providers": ["my-gateway"] }]]`.
- Maps `reasoning.supported_efforts` into OpenCode reasoning variants.
- Omits the `none` variant when upstream marks reasoning as mandatory.
- Preserves the complete upstream model record under the normalized model's `openrouter` field.
- Deep-merges configured model overrides over discovered metadata.
- Leaves existing models unchanged if discovery fails.
- Never logs credentials or request bodies.

## Global Installation

The installed package is loaded by the global OpenCode config. After installation, fully restart OpenCode Desktop and verify with:

```powershell
opencode models my-gateway --refresh --verbose
```

## Provider Configuration

Any provider that exposes an OpenAI-compatible `/v1/models` endpoint is discovered. The plugin reads `provider.<id>.options.baseURL` and `provider.<id>.options.apiKey` when present.
