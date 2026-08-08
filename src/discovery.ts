import { deepMergeModel, mapOpenRouterModels } from './mapper.js';
import type { OpenCodeModel, OpenCodeProvider, RawOpenRouterModel } from './types.js';

const DEFAULT_TIMEOUT_MS = 10_000;

function modelsURL(baseURL: string): string {
  const normalized = baseURL.replace(/\/+$/, '').replace(/\/models$/, '');
  return normalized.endsWith('/v1') ? `${normalized}/models` : `${normalized}/v1/models`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRawModel(value: unknown): value is RawOpenRouterModel {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0;
}

function timeoutSignal(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

export async function fetchModels(
  baseURL: string,
  apiKey?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<RawOpenRouterModel[]> {
  const timeout = timeoutSignal(timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await fetch(modelsURL(baseURL), {
      headers,
      signal: timeout.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      throw new Error('Invalid model response');
    }

    return payload.data.filter(isRawModel);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Model discovery timed out after ${timeoutMs}ms`);
    }
    throw error instanceof Error ? error : new Error('Model discovery failed');
  } finally {
    timeout.cancel();
  }
}

export async function discoverProviderModels(
  provider: OpenCodeProvider,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Record<string, OpenCodeModel>> {
  const baseURL = provider.options?.baseURL;
  if (typeof baseURL !== 'string' || baseURL.length === 0) {
    throw new Error('Provider baseURL is missing');
  }

  const apiKey = typeof provider.options?.apiKey === 'string' ? provider.options.apiKey : undefined;
  return mapOpenRouterModels(await fetchModels(baseURL, apiKey, timeoutMs));
}

export function mergeProviderModels(
  generated: Record<string, OpenCodeModel>,
  explicit: Record<string, Partial<OpenCodeModel>> | undefined
): Record<string, OpenCodeModel> {
  const result: Record<string, OpenCodeModel> = { ...generated };
  for (const [key, override] of Object.entries(explicit ?? {})) {
    const generatedModel = result[key];
    if (generatedModel) {
      result[key] = deepMergeModel(generatedModel, override);
    } else {
      const id = typeof override.id === 'string' ? override.id : key;
      result[key] = {
        ...override,
        id,
        name: typeof override.name === 'string' ? override.name : key
      };
    }
  }
  return result;
}

export interface DiscoveryLogContext {
  client?: {
    app?: {
      log?: (input: { body: { service: string; level: string; message: string; extra?: Record<string, unknown> } }) => Promise<unknown>;
    };
  };
}

export async function enhanceProvider(
  config: { provider?: Record<string, OpenCodeProvider> },
  providerName: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  context?: DiscoveryLogContext
): Promise<void> {
  const provider = config.provider?.[providerName];
  if (!provider) return;

  try {
    const generated = await discoverProviderModels(provider, timeoutMs);
    provider.models = mergeProviderModels(generated, provider.models);
    await context?.client?.app?.log?.({
      body: {
        service: 'opencode-openrouter-metadata',
        level: 'info',
        message: 'Model metadata refreshed',
        extra: { provider: providerName, modelCount: Object.keys(generated).length }
      }
    });
  } catch (error) {
    await context?.client?.app?.log?.({
      body: {
        service: 'opencode-openrouter-metadata',
        level: 'warn',
        message: 'Model metadata refresh failed',
        extra: { provider: providerName, error: error instanceof Error ? error.message : 'unknown error' }
      }
    });
  }
}
