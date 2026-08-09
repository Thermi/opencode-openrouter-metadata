import type { OpenCodeModel, RawOpenRouterModel, RawOpenRouterReasoning } from './types.js';

const SUPPORTED_MODALITIES = new Set(['text', 'image', 'audio', 'video', 'pdf']);

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asPositiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function mapModalities(value: unknown): string[] {
  const modalities = asStringArray(value)
    .map((item) => item.toLowerCase())
    .filter((item) => SUPPORTED_MODALITIES.has(item));

  return [...new Set(modalities)];
}

function hasParameter(parameters: string[], ...names: string[]): boolean {
  return names.some((name) => parameters.includes(name));
}

function mapReasoningVariants(reasoning: RawOpenRouterReasoning | undefined): OpenCodeModel['variants'] {
  if (!reasoning || !Array.isArray(reasoning.supported_efforts)) return undefined;

  const variants: NonNullable<OpenCodeModel['variants']> = {};
  for (const effort of reasoning.supported_efforts) {
    if (typeof effort !== 'string' || effort === 'none' && reasoning.mandatory === true) continue;
    variants[effort] = { reasoning: { effort } };
  }

  return Object.keys(variants).length > 0 ? variants : undefined;
}

function mapCost(value: unknown): number | undefined {
  const perToken = asPositiveNumber(value);
  return perToken === undefined ? undefined : perToken * 1_000_000;
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneRawModel(raw: RawOpenRouterModel): RawOpenRouterModel {
  return cloneJsonValue(raw);
}

function normalizeDisplayName(name: string, id: string): string {
  const owner = id.split('/')[0]?.toLowerCase();
  const separator = name.indexOf(':');
  if (!owner || separator < 1) return name;

  const prefix = name.slice(0, separator).trim().toLowerCase();
  return prefix === owner || prefix.replace(/\s+/g, '-') === owner ? name.slice(separator + 1).trim() : name;
}

function releaseDate(raw: RawOpenRouterModel): string | undefined {
  if (typeof raw.release_date === 'string') return raw.release_date;
  const created = asPositiveNumber(raw.created);
  if (created === undefined) return undefined;

  const date = new Date(created * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

export function mapOpenRouterModel(raw: RawOpenRouterModel): OpenCodeModel {
  const id = asString(raw.id);
  if (!id) throw new Error('Model is missing an id');

  const name = normalizeDisplayName(asString(raw.name) ?? id, id);
  const parameters = asStringArray(raw.supported_parameters);
  const inputModalities = mapModalities(raw.architecture?.input_modalities);
  const outputModalities = mapModalities(raw.architecture?.output_modalities);
  const modalities = {
    input: inputModalities.length > 0 ? inputModalities : ['text'],
    output: outputModalities.length > 0 ? outputModalities : ['text']
  };
  const reasoning = raw.reasoning !== undefined || hasParameter(parameters, 'reasoning', 'reasoning_effort');
  const variants = mapReasoningVariants(raw.reasoning);
  const context = asPositiveNumber(raw.context_length);
  const output = asPositiveNumber(raw.top_provider?.max_completion_tokens);
  const inputCost = mapCost(raw.pricing?.prompt);
  const outputCost = mapCost(raw.pricing?.completion);
  const cacheReadCost = mapCost(raw.pricing?.input_cache_read);
  const cacheWriteCost = mapCost(raw.pricing?.input_cache_write);

  const model: OpenCodeModel = {
    id,
    name,
    openrouter: cloneRawModel(raw),
    modalities
  };

  const owner = id.split('/')[0];
  if (id.includes('/') && owner) model.organizationOwner = owner;
  const family = typeof raw.family === 'string' ? raw.family : asString(raw.architecture?.tokenizer)?.toLowerCase();
  if (family) model.family = family;
  const published = releaseDate(raw);
  if (published) model.release_date = published;
  model.status = typeof raw.status === 'string' ? raw.status : 'active';
  if (raw.interleaved !== undefined) model.interleaved = cloneJsonValue(raw.interleaved);

  if (reasoning) model.reasoning = true;
  if (hasParameter(parameters, 'temperature')) model.temperature = true;
  if (hasParameter(parameters, 'tools', 'tool_choice', 'parallel_tool_calls')) model.tool_call = true;
  if (hasParameter(parameters, 'structured_outputs', 'response_format')) model.structured_output = true;
  if (inputModalities.some((modality) => modality !== 'text')) model.attachment = true;
  if (variants) model.variants = variants;

  if (context !== undefined && output !== undefined) {
    model.limit = { context, output };
  }

  if (inputCost !== undefined || outputCost !== undefined || cacheReadCost !== undefined || cacheWriteCost !== undefined) {
    model.cost = {
      ...(inputCost !== undefined ? { input: inputCost } : {}),
      ...(outputCost !== undefined ? { output: outputCost } : {}),
      ...(cacheReadCost !== undefined ? { cache_read: cacheReadCost } : {}),
      ...(cacheWriteCost !== undefined ? { cache_write: cacheWriteCost } : {})
    };
  }

  return model;
}

export function mapOpenRouterModels(rawModels: RawOpenRouterModel[]): Record<string, OpenCodeModel> {
  const models: Record<string, OpenCodeModel> = {};
  for (const raw of rawModels) {
    if (!asString(raw.id)) continue;
    try {
      const model = mapOpenRouterModel(raw);
      models[model.id] = model;
    } catch {
      // Ignore malformed records while retaining valid models from the response.
    }
  }
  return models;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeValues(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = key === 'id' ? result[key] : mergeValues(result[key], value);
  }
  return result;
}

export function deepMergeModel(base: OpenCodeModel, override: Partial<OpenCodeModel>): OpenCodeModel {
  return mergeValues(base, override) as OpenCodeModel;
}
