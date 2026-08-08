import { enhanceProvider } from './discovery.js';
import type { OpenCodeConfig, PluginOptions } from './types.js';

export async function OpenRouterMetadataPlugin(context: unknown, options?: PluginOptions) {
  const explicitProviders = options?.providers;
  const timeoutMs = options?.timeoutMs ?? 10_000;

  return {
    config: async (config: OpenCodeConfig) => {
      const providerNames =
        explicitProviders ??
        Object.entries(config.provider ?? {})
          .filter(([, provider]) => typeof provider?.options?.baseURL === 'string')
          .map(([name]) => name);

      await Promise.all(
        providerNames.map((providerName) =>
          enhanceProvider(config, providerName, timeoutMs, context as { client?: never })
        )
      );
    }
  };
}
