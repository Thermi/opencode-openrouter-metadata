# OpenCode OpenRouter Metadata

OpenCode plugin that discovers models through any OpenAI-compatible `/v1/models` endpoint and preserves OpenRouter-style reasoning metadata, capabilities, limits, modalities, and pricing.

## Development

```powershell
npm install
npm run typecheck
npm run test:run
npm run build
```

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
